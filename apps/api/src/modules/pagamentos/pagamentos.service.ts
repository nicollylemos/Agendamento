import type { Request } from 'express';
import { Prisma, type GatewayPagamento, type Pagamento, type StatusPagamento } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { enviarEmail } from '../../lib/mailer.js';
import { logger } from '../../lib/logger.js';
import { apiUrl, isProd } from '../../config/env.js';
import { agendarExpiracao } from '../../jobs/fila.js';
import { calcularSinal, obterConfigSinal } from './sinal.service.js';
import { gatewayAtivo, gatewayDoTipo } from './recebedor.service.js';
import { Simulado } from './gateway/simulado.js';
import type { NotificacaoRecebida } from './gateway/tipos.js';

// Fase 6: sinal via Pix (RF29–RF33), fluxos 6.1, 6.2 e 6.4 da documentação.
//
// Regras que garantem consistência mesmo com webhook, expiração e cancelamento
// acontecendo ao mesmo tempo:
// - toda mudança de status é condicional (UPDATE ... WHERE status = esperado);
// - quem confirma é o webhook, e só depois de consultar o pagamento no gateway (9.3);
// - pagamento que chega tarde nunca reativa o agendamento: vira "recebido após expirar".

const STATUS_REEMBOLSAVEL: StatusPagamento[] = ['APROVADO', 'RECEBIDO_APOS_EXPIRAR', 'REEMBOLSO_PENDENTE'];

const zonaEmpresa = async () =>
  (await prisma.empresa.findUnique({ where: { id: 1 }, select: { fusoHorario: true } }))?.fusoHorario ?? 'America/Sao_Paulo';

// ─── 6.1: cobrança do sinal ──────────────────────────────

// Decide se este agendamento online vai cobrar sinal. Chamado antes de gravar.
export async function planejarSinal(valorCentavos: number, servicoId: string, inicio: Date) {
  const [servico, config, ativo] = await Promise.all([
    prisma.servico.findUniqueOrThrow({ where: { id: servicoId }, select: { sinalModo: true, sinalTipo: true, sinalValor: true, sinalPrazoMin: true } }),
    obterConfigSinal(),
    gatewayAtivo(),
  ]);
  // Sem recebedor ativo não há como cobrar: o agendamento entra confirmado (o painel avisa)
  if (!ativo) return null;
  const { sinalCentavos, prazoMin } = calcularSinal(valorCentavos, servico, config);
  if (!sinalCentavos) return null;
  // O prazo nunca passa do horário do atendimento
  const expiraEm = new Date(Math.min(Date.now() + prazoMin * 60_000, inicio.getTime()));
  return { sinalCentavos, expiraEm };
}

// RF29: gera o Pix. Se o gateway falhar, o horário é liberado na hora.
export async function gerarCobranca(a: { id: string; sinalCentavos: number; expiraSinalEm: Date; servicoNome: string; email: string }) {
  const ativo = await gatewayAtivo();
  const falhar = async () => {
    await prisma.agendamento.updateMany({
      where: { id: a.id, status: 'AGUARDANDO_PAGAMENTO' },
      data: { status: 'CANCELADO', canceladoEm: new Date(), motivoCancelamento: 'Não foi possível gerar o Pix' },
    });
    throw new AppError('PAGAMENTO_INDISPONIVEL', 'Não conseguimos gerar o Pix agora. Tente de novo em instantes.', 503);
  };
  if (!ativo) return falhar();

  // Registro antes da chamada: a chave de idempotência evita cobrança duplicada se repetir
  const pagamento = await prisma.pagamento.create({
    data: {
      agendamentoId: a.id,
      valorCentavos: a.sinalCentavos,
      gateway: ativo.tipo,
      idempotencyKey: `sinal-${a.id}`,
      expiraEm: a.expiraSinalEm,
    },
  });
  try {
    const c = await ativo.gateway.criarCobranca({
      valorCentavos: a.sinalCentavos,
      descricao: `Sinal: ${a.servicoNome}`,
      emailPagador: a.email,
      expiraEm: a.expiraSinalEm,
      idempotencyKey: pagamento.idempotencyKey,
      referencia: a.id,
      // O gateway só aceita endereço público com https
      ...(apiUrl.startsWith('https://') && { urlNotificacao: `${apiUrl}/api/v1/webhooks/pagamentos/${ativo.tipo.toLowerCase()}` }),
    });
    const atualizado = await prisma.pagamento.update({
      where: { id: pagamento.id },
      data: { gatewayPaymentId: c.gatewayPaymentId, pixCopiaECola: c.copiaECola, pixQrBase64: c.qrBase64 },
    });
    agendarExpiracao(a.id, a.expiraSinalEm);
    return atualizado;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, agendamentoId: a.id }, 'Falha ao gerar o Pix');
    await prisma.pagamento.update({ where: { id: pagamento.id }, data: { status: 'CANCELADO' } });
    return falhar();
  }
}

// Dados do Pix para a tela do cliente (só enquanto está pendente)
export async function pixDoAgendamento(agendamentoId: string) {
  const p = await prisma.pagamento.findFirst({ where: { agendamentoId }, orderBy: { createdAt: 'desc' } });
  if (!p) return null;
  return {
    status: p.status,
    valorCentavos: p.valorCentavos,
    ...(p.status === 'PENDENTE' && { copiaECola: p.pixCopiaECola, qrBase64: p.pixQrBase64, expiraEm: p.expiraEm.toISOString() }),
  };
}

// ─── RF30: webhook ───────────────────────────────────────

export async function processarWebhook(tipo: GatewayPagamento, n: NotificacaoRecebida): Promise<{ status: number; resultado: string }> {
  const gateway = await gatewayDoTipo(tipo);
  if (!gateway) return { status: 404, resultado: 'sem_recebedor' };

  const v = gateway.validarNotificacao(n);
  if (!v.ok) {
    // Só log (sem auditoria): qualquer um pode bater nessa rota, não dá para encher o banco
    logger.warn({ motivo: v.motivo, gateway: tipo }, 'Webhook recusado');
    return { status: 401, resultado: v.motivo };
  }
  if (v.tipo && !v.tipo.startsWith('payment')) return { status: 200, resultado: 'ignorado' };

  // 9.3: idempotência — cada evento é processado uma vez só
  let evento;
  try {
    evento = await prisma.webhookEvento.create({ data: { gateway: tipo, eventoId: v.eventoId, gatewayPaymentId: v.gatewayPaymentId, tipo: v.tipo } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    evento = await prisma.webhookEvento.findUniqueOrThrow({ where: { gateway_eventoId: { gateway: tipo, eventoId: v.eventoId } } });
    if (evento.processadoEm) return { status: 200, resultado: 'duplicado' };
  }

  const resultado = await aplicarStatusDoGateway(tipo, v.gatewayPaymentId);
  await prisma.webhookEvento.update({ where: { id: evento.id }, data: { processadoEm: new Date(), resultado } });
  return { status: 200, resultado };
}

// Consulta o pagamento direto no gateway (nunca confia só no corpo do webhook) e aplica
async function aplicarStatusDoGateway(tipo: GatewayPagamento, gatewayPaymentId: string | null): Promise<string> {
  if (!gatewayPaymentId) return 'sem_pagamento';
  const pagamento = await prisma.pagamento.findUnique({ where: { gatewayPaymentId } });
  if (!pagamento || pagamento.gateway !== tipo) return 'desconhecido';

  const gateway = await gatewayDoTipo(tipo);
  if (!gateway) return 'sem_recebedor';
  const real = await gateway.consultar(gatewayPaymentId);

  if (real.status === 'aprovado') {
    // 9.3: conferência de valor e moeda; pagamento menor que o sinal não confirma
    if (real.moeda !== 'BRL' || real.valorCentavos < pagamento.valorCentavos) {
      logger.warn({ pagamentoId: pagamento.id }, 'Pagamento com valor ou moeda diferente do sinal');
      return 'valor_divergente';
    }
    return confirmar(pagamento, real.valorCentavos);
  }
  if (real.status === 'reembolsado' && pagamento.status !== 'REEMBOLSADO') {
    await prisma.pagamento.update({ where: { id: pagamento.id }, data: { status: 'REEMBOLSADO', reembolsadoEm: new Date() } });
    return 'reembolsado';
  }
  return real.status;
}

async function confirmar(pagamento: Pagamento, valorPago: number): Promise<string> {
  const agora = new Date();
  const resultado = await prisma.$transaction(async (tx) => {
    // Mesma ordem de trava da expiração (agendamento, depois pagamento): evita deadlock
    const a = await tx.agendamento.updateMany({
      where: { id: pagamento.agendamentoId, status: 'AGUARDANDO_PAGAMENTO' },
      data: { status: 'CONFIRMADO', expiraSinalEm: null },
    });
    if (a.count) {
      await tx.pagamento.updateMany({ where: { id: pagamento.id, status: 'PENDENTE' }, data: { status: 'APROVADO', pagoEm: agora, valorPagoCentavos: valorPago } });
      return 'confirmado';
    }
    // Fluxo 6.2: chegou depois de expirar/cancelar. Não reativa o agendamento.
    const p = await tx.pagamento.updateMany({
      where: { id: pagamento.id, status: { in: ['PENDENTE', 'CANCELADO'] } },
      data: { status: 'RECEBIDO_APOS_EXPIRAR', pagoEm: agora, valorPagoCentavos: valorPago },
    });
    return p.count ? 'apos_expirar' : 'ja_processado';
  });

  if (resultado === 'confirmado') {
    await auditar('SINAL_CONFIRMADO', null, { entidade: 'Agendamento', entidadeId: pagamento.agendamentoId, detalhes: { valorCentavos: valorPago } });
    await avisarConfirmacao(pagamento.agendamentoId);
  } else if (resultado === 'apos_expirar') {
    await auditar('SINAL_RECEBIDO_APOS_EXPIRAR', null, { entidade: 'Pagamento', entidadeId: pagamento.id });
    const config = await obterConfigSinal();
    if (config.reembolsoAutomaticoAposExpirar) await reembolsar(null, pagamento.id);
  }
  return resultado;
}

async function avisarConfirmacao(agendamentoId: string) {
  const a = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    include: { cliente: true, servico: { select: { nome: true } }, funcionario: { select: { nome: true, email: true } } },
  });
  if (!a) return;
  const quando = DateTime.fromJSDate(a.inicio).setZone(await zonaEmpresa()).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL 'às' HH:mm");
  if (a.cliente.email) {
    await enviarEmail(
      a.cliente.email,
      'Sinal recebido: agendamento confirmado',
      `Olá, ${a.cliente.nome.split(' ')[0]}!\n\nRecebemos o sinal. Seu horário está confirmado:\n${a.servico.nome} com ${a.funcionario.nome}\n${quando}\n\nPara ver, remarcar ou cancelar, use o link do primeiro e-mail.`,
    );
  }
  // 6.1: o profissional também fica sabendo
  if (a.funcionario.email) {
    await enviarEmail(a.funcionario.email, 'Novo agendamento confirmado', `${a.cliente.nome.split(' ')[0]} — ${a.servico.nome}\n${quando}`);
  }
}

// ─── RF31 / 6.2: expiração ───────────────────────────────

// Idempotente: pode rodar em várias instâncias ao mesmo tempo
export async function expirarVencidos(agora = new Date()) {
  const vencidos = await prisma.agendamento.findMany({
    where: { status: 'AGUARDANDO_PAGAMENTO', expiraSinalEm: { lte: agora } },
    select: { id: true },
    take: 200,
  });
  let expirados = 0;
  for (const { id } of vencidos) {
    const ok = await prisma.$transaction(async (tx) => {
      const a = await tx.agendamento.updateMany({
        where: { id, status: 'AGUARDANDO_PAGAMENTO', expiraSinalEm: { lte: agora } },
        data: { status: 'EXPIRADO', canceladoEm: agora, motivoCancelamento: 'Sinal não pago no prazo' },
      });
      if (!a.count) return false;
      await tx.pagamento.updateMany({ where: { agendamentoId: id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
      return true;
    });
    if (!ok) continue;
    expirados++;
    await cancelarNoGateway(id);
    await auditar('SINAL_EXPIRADO', null, { entidade: 'Agendamento', entidadeId: id });
    await avisarExpiracao(id);
  }
  return expirados;
}

async function cancelarNoGateway(agendamentoId: string) {
  const p = await prisma.pagamento.findFirst({ where: { agendamentoId, status: 'CANCELADO', gatewayPaymentId: { not: null } }, orderBy: { createdAt: 'desc' } });
  if (!p?.gatewayPaymentId) return;
  try {
    await (await gatewayDoTipo(p.gateway))?.cancelar(p.gatewayPaymentId);
  } catch (err) {
    // Se o cliente pagar mesmo assim, o webhook trata como "recebido após expirar"
    logger.warn({ err: err instanceof Error ? err.message : err, pagamentoId: p.id }, 'Não foi possível cancelar a cobrança no gateway');
  }
}

async function avisarExpiracao(agendamentoId: string) {
  const a = await prisma.agendamento.findUnique({ where: { id: agendamentoId }, include: { cliente: true, servico: { select: { nome: true } } } });
  if (!a?.cliente.email) return;
  await enviarEmail(
    a.cliente.email,
    'Reserva expirada',
    `Olá, ${a.cliente.nome.split(' ')[0]}.\n\nO sinal de ${a.servico.nome} não foi pago no prazo e o horário foi liberado.\nSe ainda quiser, é só agendar de novo pelo site.`,
  );
}

// ─── RF32 / 6.4: cancelamento, falta e reembolso ─────────

// Chamado depois que o agendamento já foi marcado como cancelado ou falta.
// "reembolsar" vem do painel; sem ele, vale a política (devolve se faltar X horas ou mais).
export async function aposEncerrar(req: Request | null, agendamentoId: string, motivo: 'CANCELADO' | 'NAO_COMPARECEU', reembolsarForcado?: boolean) {
  const p = await prisma.pagamento.findFirst({ where: { agendamentoId }, orderBy: { createdAt: 'desc' } });
  if (!p) return null;

  if (p.status === 'PENDENTE') {
    const { count } = await prisma.pagamento.updateMany({ where: { id: p.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
    if (count) await cancelarNoGateway(agendamentoId);
    return 'cancelado';
  }
  if (p.status !== 'APROVADO') return null;

  let devolver = false;
  if (motivo === 'CANCELADO') {
    if (reembolsarForcado !== undefined) devolver = reembolsarForcado;
    else {
      const [a, config] = await Promise.all([prisma.agendamento.findUniqueOrThrow({ where: { id: agendamentoId }, select: { inicio: true } }), obterConfigSinal()]);
      devolver = (a.inicio.getTime() - Date.now()) / 3_600_000 >= config.reembolsoAteHoras;
    }
  }
  if (devolver) return reembolsar(req, p.id);

  const { count } = await prisma.pagamento.updateMany({ where: { id: p.id, status: 'APROVADO' }, data: { status: 'RETIDO' } });
  if (count) await auditar('SINAL_RETIDO', req, { usuarioId: req?.usuario?.id, entidade: 'Pagamento', entidadeId: p.id, detalhes: { motivo } });
  return 'retido';
}

// Devolve o sinal pelo gateway. Se o gateway falhar, fica "reembolso pendente" para tentar de novo.
export async function reembolsar(req: Request | null, pagamentoId: string) {
  // Reserva o reembolso: duas chamadas ao mesmo tempo, só uma segue
  const p = await prisma.pagamento.findUnique({ where: { id: pagamentoId } });
  if (!p) throw new AppError('NAO_ENCONTRADO', 'Pagamento não encontrado', 404);
  if (!STATUS_REEMBOLSAVEL.includes(p.status)) throw new AppError('STATUS_INVALIDO', 'Esse pagamento não pode ser reembolsado', 409);
  const { count } = await prisma.pagamento.updateMany({ where: { id: p.id, status: p.status }, data: { status: 'REEMBOLSO_PENDENTE' } });
  if (!count) throw new AppError('STATUS_MUDOU', 'O pagamento mudou enquanto isso. Atualize a tela.', 409);

  try {
    const gateway = await gatewayDoTipo(p.gateway);
    if (!gateway || !p.gatewayPaymentId) throw new Error('gateway indisponível');
    await gateway.reembolsar(p.gatewayPaymentId, `reembolso-${p.id}`);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, pagamentoId: p.id }, 'Falha no reembolso');
    return 'reembolso_pendente';
  }
  await prisma.pagamento.update({ where: { id: p.id }, data: { status: 'REEMBOLSADO', reembolsadoEm: new Date() } });
  await auditar('SINAL_REEMBOLSADO', req, { usuarioId: req?.usuario?.id, entidade: 'Pagamento', entidadeId: p.id, detalhes: { valorCentavos: p.valorPagoCentavos ?? p.valorCentavos } });
  return 'reembolsado';
}

// ─── Painel ──────────────────────────────────────────────

// Pagamentos que precisam de atenção (chegou tarde, reembolso falhou) e os últimos movimentos
export async function listar(filtro: 'atencao' | 'todos') {
  const lista = await prisma.pagamento.findMany({
    where: filtro === 'atencao' ? { status: { in: ['RECEBIDO_APOS_EXPIRAR', 'REEMBOLSO_PENDENTE'] } } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { agendamento: { select: { id: true, inicio: true, status: true, cliente: { select: { nome: true } }, servico: { select: { nome: true } } } } },
  });
  const zona = await zonaEmpresa();
  return lista.map((p) => ({
    id: p.id,
    status: p.status,
    valorCentavos: p.valorCentavos,
    valorPagoCentavos: p.valorPagoCentavos,
    gateway: p.gateway,
    criadoEm: p.createdAt.toISOString(),
    pagoEm: p.pagoEm?.toISOString() ?? null,
    agendamento: {
      id: p.agendamento.id,
      inicio: DateTime.fromJSDate(p.agendamento.inicio).setZone(zona).toFormat("yyyy-MM-dd'T'HH:mm"),
      status: p.agendamento.status,
      cliente: p.agendamento.cliente.nome,
      servico: p.agendamento.servico.nome,
    },
  }));
}

// Situação do recebimento, para avisos no painel
export async function situacao() {
  const [config, ativo, atencao] = await Promise.all([
    obterConfigSinal(),
    prisma.recebedor.findUnique({ where: { id: 1 }, select: { ativo: true } }),
    prisma.pagamento.count({ where: { status: { in: ['RECEBIDO_APOS_EXPIRAR', 'REEMBOLSO_PENDENTE'] } } }),
  ]);
  const servicosExigem = await prisma.servico.count({ where: { deletedAt: null, ativo: true, sinalModo: 'EXIGIR' } });
  const exigeAlgum = config.sinalExige || servicosExigem > 0;
  return {
    recebedorAtivo: Boolean(ativo?.ativo),
    exigeAlgum,
    semCobrar: exigeAlgum && !ativo?.ativo,
    precisamAtencao: atencao,
    // Endereço para cadastrar no painel do Mercado Pago (precisa ser público e https)
    urlWebhook: `${apiUrl}/api/v1/webhooks/pagamentos/mercado_pago`,
  };
}

// ─── Só desenvolvimento: simular o cliente pagando o Pix ─

export async function simularPagamento(agendamentoId: string) {
  if (isProd) throw new AppError('NAO_ENCONTRADO', 'Rota não encontrada', 404);
  const p = await prisma.pagamento.findFirst({ where: { agendamentoId, gateway: 'SIMULADO' }, orderBy: { createdAt: 'desc' } });
  if (!p?.gatewayPaymentId) throw new AppError('NAO_ENCONTRADO', 'Não há Pix simulado para esse agendamento', 404);
  const gateway = await gatewayDoTipo('SIMULADO');
  if (!(gateway instanceof Simulado)) throw new AppError('NAO_ENCONTRADO', 'Gateway simulado não está configurado', 404);
  gateway.pagar(p.gatewayPaymentId);
  // Passa pelo mesmo caminho do webhook de verdade, com assinatura
  return processarWebhook('SIMULADO', gateway.notificacaoAssinada(p.gatewayPaymentId));
}
