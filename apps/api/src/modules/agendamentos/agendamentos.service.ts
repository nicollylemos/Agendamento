import type { Request } from 'express';
import type { FormaPagamento, Prisma, StatusAgendamento } from '@prisma/client';
import { DateTime } from 'luxon';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { sha256, tokenAleatorio } from '../../lib/crypto.js';
import { enviarEmail } from '../../lib/mailer.js';
import { ehConflitoDeHorario } from '../../lib/travaAgenda.js';
import { env } from '../../config/env.js';
import { obterConfigAgenda } from '../agenda/config.service.js';
import { obterConfigSinal } from '../pagamentos/sinal.service.js';
import { validarRespostasExtras } from '../personalizacao/personalizacao.service.js';
import { garantirDataNoPeriodo, horariosLivresDoFuncionario, zonaDaEmpresa } from '../horarios/horarios.service.js';
import { momentoPermite, podeMudar, proximosStatus } from './status.js';
import * as pagamentos from '../pagamentos/pagamentos.service.js';
import { baixarConsumo } from '../estoque/consumo.service.js';
import { avisarEstoqueBaixo } from '../estoque/estoque.service.js';
import * as fidelidade from '../fidelidade/fidelidade.service.js';
import type { consumoSchema } from '../estoque/estoque.schemas.js';
import type { agendamentoOnlineSchema, agendamentoPainelSchema } from './agendamentos.schemas.js';

const horarioIndisponivel = () =>
  new AppError('HORARIO_INDISPONIVEL', 'Esse horário acabou de ser ocupado ou não está mais disponível. Escolha outro.', 409);

const incluir = {
  cliente: { select: { id: true, nome: true, telefone: true, email: true } },
  servico: { select: { id: true, nome: true } },
  funcionario: { select: { id: true, nome: true } },
  // Fase 6: último pagamento do sinal (sem os dados do Pix, que são pesados)
  pagamentos: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, valorCentavos: true, valorPagoCentavos: true, pagoEm: true } },
} as const;

type AgendamentoCompleto = Prisma.AgendamentoGetPayload<{ include: typeof incluir }>;

const local = (d: Date, zona: string) => DateTime.fromJSDate(d).setZone(zona).toFormat("yyyy-MM-dd'T'HH:mm");

// 9.6: funcionário vê só o necessário do cliente (telefone mascarado, sem e-mail)
function mascararTelefone(t: string) {
  return `(${t.slice(0, 2)}) •••••-${t.slice(-4)}`;
}

export function formatar(a: AgendamentoCompleto, zona: string, visao: 'gestao' | 'funcionario' = 'gestao') {
  return {
    id: a.id,
    inicio: local(a.inicio, zona),
    fim: local(a.fim, zona),
    status: a.status,
    proximosStatus: proximosStatus(a.status),
    valorCentavos: a.valorCentavos,
    duracaoMin: a.duracaoMin,
    origem: a.origem,
    observacao: a.observacao,
    servico: a.servico,
    funcionario: { id: a.funcionario.id, nome: a.funcionario.nome },
    cliente:
      visao === 'gestao'
        ? a.cliente
        : { id: a.cliente.id, nome: a.cliente.nome, telefone: mascararTelefone(a.cliente.telefone), email: null },
    motivoCancelamento: a.motivoCancelamento,
    formaPagamento: a.formaPagamento, // RF47
    respostasExtras: (a.respostasExtras as { rotulo: string; resposta: string }[] | null) ?? [],
    ...resumoSinal(a),
  };
}

// RF33: o sinal pago é abatido do total; o painel mostra quanto falta receber
function resumoSinal(a: AgendamentoCompleto) {
  const p = a.pagamentos[0];
  const pago = p && ['APROVADO', 'RETIDO'].includes(p.status) ? (p.valorPagoCentavos ?? p.valorCentavos) : 0;
  return {
    sinal: p ? { status: p.status, valorCentavos: p.valorCentavos, pagoEm: p.pagoEm?.toISOString() ?? null } : null,
    expiraSinalEm: a.expiraSinalEm?.toISOString() ?? null,
    restanteCentavos: Math.max(0, a.valorCentavos - pago),
  };
}

// ─── Escolha e validação do horário ──────────────────────

interface PedidoHorario {
  servicoId: string;
  funcionarioId?: string | null;
  data: string;
  horario: string;
  encaixe?: boolean; // só no painel
  online?: boolean; // site: só profissionais visíveis para o cliente
  ignorarAgendamentoId?: string;
}

// Descobre quem atende e confirma que o horário está livre (RF20/RF21).
// "Encaixe" pula jornada e antecedência, mas a trava do banco continua valendo.
async function reservarHorario(p: PedidoHorario) {
  const [zona, configBase] = await Promise.all([zonaDaEmpresa(), obterConfigAgenda()]);
  // Antecedência mínima é regra para o cliente online; no balcão dá para encaixar já
  const config = p.online ? configBase : { ...configBase, antecedenciaMinimaMin: 0 };
  if (!p.encaixe) garantirDataNoPeriodo(p.data, zona, config);

  const servico = await prisma.servico.findFirst({
    where: { id: p.servicoId, ativo: true, deletedAt: null },
    include: {
      funcionarios: {
        where: {
          funcionario: { ativo: true, ...(p.online && { exibirNoSite: true }) },
          ...(p.funcionarioId && { funcionarioId: p.funcionarioId }),
        },
        orderBy: { funcionario: { ordem: 'asc' } },
      },
    },
  });
  if (!servico) throw new AppError('NAO_ENCONTRADO', 'Serviço não encontrado', 404);
  if (!servico.funcionarios.length) {
    throw new AppError('PROFISSIONAL_INVALIDO', 'Esse profissional não faz esse serviço', 400);
  }

  for (const sf of servico.funcionarios) {
    const duracaoMin = sf.duracaoMin ?? servico.duracaoMin;
    const limpezaMin = servico.intervaloLimpezaMin;
    const livre =
      p.encaixe ||
      (
        await horariosLivresDoFuncionario(sf.funcionarioId, p.data, { duracaoMin, limpezaMin }, {
          zona,
          config,
          ignorarAgendamentoId: p.ignorarAgendamentoId,
        })
      ).includes(p.horario);

    if (livre) {
      const inicio = DateTime.fromISO(`${p.data}T${p.horario}`, { zone: zona });
      return {
        zona,
        funcionarioId: sf.funcionarioId,
        inicio: inicio.toJSDate(),
        fim: inicio.plus({ minutes: duracaoMin }).toJSDate(),
        fimOcupado: inicio.plus({ minutes: duracaoMin + limpezaMin }).toJSDate(),
        duracaoMin,
        limpezaMin,
        valorCentavos: sf.precoCentavos ?? servico.precoCentavos,
      };
    }
  }
  throw horarioIndisponivel();
}

// A trava do banco é a palavra final: duas pessoas no mesmo segundo, só uma grava.
async function gravar<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (err) {
    if (ehConflitoDeHorario(err)) throw horarioIndisponivel();
    throw err;
  }
}

// RF04: cliente identificado pelo telefone. O site nunca sobrescreve dados de um
// cliente que já existe (senão qualquer um que soubesse o telefone trocaria o e-mail dele).
async function obterCliente(
  tx: Prisma.TransactionClient,
  c: { nome: string; telefone: string; email?: string | null },
  consentimento: boolean,
) {
  const existente = await tx.cliente.findUnique({ where: { telefone: c.telefone } });
  if (!existente) {
    return tx.cliente.create({
      data: { nome: c.nome, telefone: c.telefone, email: c.email ?? null, consentimentoLgpdEm: consentimento ? new Date() : null },
    });
  }
  const preencher: Prisma.ClienteUpdateInput = {};
  if (!existente.email && c.email) preencher.email = c.email;
  if (consentimento && !existente.consentimentoLgpdEm) preencher.consentimentoLgpdEm = new Date();
  return Object.keys(preencher).length ? tx.cliente.update({ where: { id: existente.id }, data: preencher }) : existente;
}

function linkGestao(token: string) {
  return `${env.APP_URL}/meu-agendamento?token=${token}`;
}

async function enviarConfirmacao(a: AgendamentoCompleto, zona: string, token?: string) {
  if (!a.cliente.email) return;
  const quando = DateTime.fromJSDate(a.inicio).setZone(zona).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL 'às' HH:mm");
  await enviarEmail(
    a.cliente.email,
    'Agendamento confirmado',
    [
      `Olá, ${a.cliente.nome.split(' ')[0]}!`,
      '',
      `${a.servico.nome} com ${a.funcionario.nome}`,
      quando,
      '',
      ...(token ? ['Para ver, remarcar ou cancelar:', linkGestao(token)] : []),
    ].join('\n'),
  );
}

// Com sinal: o e-mail avisa que o horário está reservado até o Pix ser pago
async function enviarReserva(a: AgendamentoCompleto, zona: string, token: string, expiraEm: Date) {
  if (!a.cliente.email) return;
  const quando = DateTime.fromJSDate(a.inicio).setZone(zona).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL 'às' HH:mm");
  const prazo = DateTime.fromJSDate(expiraEm).setZone(zona).toFormat('HH:mm');
  await enviarEmail(
    a.cliente.email,
    'Horário reservado: falta pagar o sinal',
    [
      `Olá, ${a.cliente.nome.split(' ')[0]}!`,
      '',
      `${a.servico.nome} com ${a.funcionario.nome}`,
      quando,
      '',
      `Seu horário fica reservado até ${prazo}. Pague o sinal de ${(a.sinalCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por Pix para confirmar.`,
      'Para ver o Pix de novo, remarcar ou cancelar:',
      linkGestao(token),
    ].join('\n'),
  );
}

// ─── RF21, RF23: agendamento pelo site ───────────────────

export async function criarOnline(req: Request, dados: z.infer<typeof agendamentoOnlineSchema>) {
  const slot = await reservarHorario({ ...dados, online: true });
  const token = tokenAleatorio();
  const agora = new Date();
  // RF28: valor e prazo do sinal calculados aqui, nunca vindos do front (9.3)
  const sinal = await pagamentos.planejarSinal(slot.valorCentavos, dados.servicoId, slot.inicio);
  const respostasExtras = await validarRespostasExtras(dados.respostasExtras);

  const a = await gravar(() =>
    prisma.$transaction(async (tx) => {
      const cliente = await obterCliente(tx, dados.cliente, true);
      return tx.agendamento.create({
        data: {
          clienteId: cliente.id,
          funcionarioId: slot.funcionarioId,
          servicoId: dados.servicoId,
          inicio: slot.inicio,
          fim: slot.fim,
          fimOcupado: slot.fimOcupado,
          // RF23: com sinal, o horário fica preso em "aguardando pagamento" até o Pix cair ou o prazo vencer
          status: sinal ? 'AGUARDANDO_PAGAMENTO' : 'CONFIRMADO',
          sinalCentavos: sinal?.sinalCentavos ?? 0,
          ...(respostasExtras && { respostasExtras }),
          expiraSinalEm: sinal?.expiraEm ?? null,
          valorCentavos: slot.valorCentavos,
          duracaoMin: slot.duracaoMin,
          limpezaMin: slot.limpezaMin,
          origem: 'ONLINE',
          observacao: dados.observacao,
          tokenGestaoHash: sha256(token),
          aceitePoliticaEm: agora,
        },
        include: incluir,
      });
    }),
  );

  await auditar('AGENDAMENTO_CRIADO', req, { entidade: 'Agendamento', entidadeId: a.id, detalhes: { origem: 'ONLINE', sinalCentavos: a.sinalCentavos } });

  if (!sinal) {
    await enviarConfirmacao(a, slot.zona, token);
    return { agendamento: formatarParaCliente(a, slot.zona), linkGestao: linkGestao(token), pix: null };
  }
  // RF29: gera o Pix (se falhar, o horário é liberado e o cliente vê o erro)
  const pagamento = await pagamentos.gerarCobranca({
    id: a.id,
    sinalCentavos: sinal.sinalCentavos,
    expiraSinalEm: sinal.expiraEm,
    servicoNome: a.servico.nome,
    email: dados.cliente.email,
  });
  await enviarReserva(a, slot.zona, token, sinal.expiraEm);
  return {
    agendamento: formatarParaCliente(a, slot.zona),
    linkGestao: linkGestao(token),
    pix: { copiaECola: pagamento.pixCopiaECola, qrBase64: pagamento.pixQrBase64, valorCentavos: pagamento.valorCentavos, expiraEm: sinal.expiraEm.toISOString() },
  };
}

// ─── RF24: agendamento manual pelo painel ────────────────

export async function criarPainel(req: Request, dados: z.infer<typeof agendamentoPainelSchema>) {
  const slot = await reservarHorario(dados);
  const a = await gravar(() =>
    prisma.$transaction(async (tx) => {
      const cliente = await obterCliente(tx, dados.cliente, false);
      return tx.agendamento.create({
        data: {
          clienteId: cliente.id,
          funcionarioId: slot.funcionarioId,
          servicoId: dados.servicoId,
          inicio: slot.inicio,
          fim: slot.fim,
          fimOcupado: slot.fimOcupado,
          status: 'CONFIRMADO',
          valorCentavos: slot.valorCentavos,
          duracaoMin: slot.duracaoMin,
          limpezaMin: slot.limpezaMin,
          origem: 'PAINEL',
          observacao: dados.observacao,
          criadoPor: req.usuario!.id,
        },
        include: incluir,
      });
    }),
  );
  await auditar('AGENDAMENTO_CRIADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Agendamento',
    entidadeId: a.id,
    detalhes: { origem: 'PAINEL', encaixe: Boolean(dados.encaixe) },
  });
  await enviarConfirmacao(a, slot.zona);
  return formatar(a, slot.zona);
}

// ─── Agenda da equipe ────────────────────────────────────

export function profissionaisDaAgenda() {
  return prisma.funcionario.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, cargo: true },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
}

export async function listar(p: { de: string; ate: string; funcionarioId?: string }, visao: 'gestao' | 'funcionario') {
  const zona = await zonaDaEmpresa();
  const lista = await prisma.agendamento.findMany({
    where: {
      ...(p.funcionarioId && { funcionarioId: p.funcionarioId }),
      inicio: {
        gte: DateTime.fromISO(p.de, { zone: zona }).startOf('day').toJSDate(),
        lt: DateTime.fromISO(p.ate, { zone: zona }).startOf('day').plus({ days: 1 }).toJSDate(),
      },
    },
    include: incluir,
    orderBy: { inicio: 'asc' },
    take: 1000,
  });
  return lista.map((a) => formatar(a, zona, visao));
}

// 9.2: "dono" = funcionário logado; só altera o que é dele
async function buscar(id: string, dono?: string) {
  const a = await prisma.agendamento.findFirst({ where: { id, ...(dono && { funcionarioId: dono }) }, include: incluir });
  if (!a) throw new AppError('NAO_ENCONTRADO', 'Agendamento não encontrado', 404);
  return a;
}

// RF26
// RF54: % do serviço para aquele profissional, senão o % padrão dele. Base: valor combinado.
export async function calcularComissao(
  tx: Prisma.TransactionClient,
  a: { servicoId: string; funcionarioId: string; valorCentavos: number },
) {
  const [sf, f] = await Promise.all([
    tx.servicoFuncionario.findUnique({
      where: { servicoId_funcionarioId: { servicoId: a.servicoId, funcionarioId: a.funcionarioId } },
      select: { comissaoPct: true },
    }),
    tx.funcionario.findUnique({ where: { id: a.funcionarioId }, select: { comissaoPadraoPct: true } }),
  ]);
  const pct = Number(sf?.comissaoPct ?? f?.comissaoPadraoPct ?? 0);
  return Math.round((a.valorCentavos * pct) / 100);
}

export async function mudarStatus(
  req: Request,
  id: string,
  status: StatusAgendamento,
  opcoes: {
    motivo?: string | null;
    dono?: string; // funcionário logado: só mexe no que é dele (9.2)
    reembolsarSinal?: boolean; // RF32 (só gestão)
    consumo?: z.infer<typeof consumoSchema>; // RF40: quantidade real gasta
    formaPagamento?: FormaPagamento; // RF47
  } = {},
) {
  const { motivo, dono, reembolsarSinal, consumo, formaPagamento } = opcoes;
  const a = await buscar(id, dono);
  if (!podeMudar(a.status, status)) {
    throw new AppError('STATUS_INVALIDO', 'Não é possível fazer essa mudança no status atual', 409);
  }
  if (!momentoPermite(status, a.inicio)) {
    throw new AppError('CEDO_DEMAIS', 'Isso só pode ser marcado a partir do horário do agendamento', 409);
  }

  // Fluxo 6.3: concluir, baixar o estoque e creditar os pontos é tudo ou nada (uma transação só)
  const efeitos = await prisma.$transaction(async (tx) => {
    // Atualização condicional: se outra pessoa mudou o status ao mesmo tempo, não sobrescreve
    const { count } = await tx.agendamento.updateMany({
      where: { id, status: a.status },
      data: {
        status,
        ...(status === 'CANCELADO' && { canceladoEm: new Date(), motivoCancelamento: motivo ?? null }),
        ...(a.status === 'AGUARDANDO_PAGAMENTO' && { expiraSinalEm: null }),
        ...(status === 'CONCLUIDO' && { concluidoEm: new Date(), formaPagamento: formaPagamento ?? null }),
      },
    });
    if (!count) throw new AppError('STATUS_MUDOU', 'O status foi alterado por outra pessoa. Atualize a tela.', 409);
    // RF45: cancelou algo que já tinha gerado pontos → estorna
    if (status === 'CANCELADO') await fidelidade.estornarAtendimento(tx, id, req.usuario!.id);
    if (status !== 'CONCLUIDO') return null;
    // RF40: baixa automática pela ficha técnica (ou pelo que o profissional informou)
    const { cruzaram } = await baixarConsumo(tx, id, req.usuario!.id, consumo);
    // RF54: comissão calculada agora e congelada no atendimento
    await tx.agendamento.update({ where: { id }, data: { comissaoCentavos: await calcularComissao(tx, a) } });
    // RF45: pontos só entram quando o atendimento é concluído
    const pontos = await fidelidade.creditarAtendimento(tx, id);
    return { cruzaram, pontos };
  });
  if (efeitos?.cruzaram.length) avisarEstoqueBaixo(efeitos.cruzaram); // RF41
  if (efeitos?.pontos) await fidelidade.avisarPontos(efeitos.pontos.clienteId, efeitos.pontos.pontos, efeitos.pontos.tipo);

  // RF32 / fluxo 6.4: o que acontece com o sinal
  if (status === 'CANCELADO' || status === 'NAO_COMPARECEU') await pagamentos.aposEncerrar(req, id, status, reembolsarSinal);
  // Confirmado na mão: cancela o Pix pendente (se pagar mesmo assim, o webhook devolve)
  if (status === 'CONFIRMADO') await pagamentos.aposEncerrar(req, id, 'CANCELADO');

  await auditar('AGENDAMENTO_STATUS', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Agendamento',
    entidadeId: id,
    detalhes: { de: a.status, para: status },
  });
  return formatar(await buscar(id), await zonaDaEmpresa(), dono ? 'funcionario' : 'gestao');
}

export async function reagendarPainel(
  req: Request,
  id: string,
  p: { data: string; horario: string; funcionarioId?: string; encaixe?: boolean },
  dono?: string,
) {
  const a = await buscar(id, dono);
  if (!['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(a.status)) {
    throw new AppError('STATUS_INVALIDO', 'Só dá para remarcar agendamentos que ainda vão acontecer', 409);
  }
  const slot = await reservarHorario({
    servicoId: a.servicoId,
    funcionarioId: dono ?? p.funcionarioId ?? a.funcionarioId,
    data: p.data,
    horario: p.horario,
    encaixe: p.encaixe,
    ignorarAgendamentoId: a.id,
  });
  const atualizado = await gravar(() =>
    prisma.agendamento.update({
      where: { id },
      data: { funcionarioId: slot.funcionarioId, inicio: slot.inicio, fim: slot.fim, fimOcupado: slot.fimOcupado, lembrete24hEm: null, lembrete2hEm: null },
      include: incluir,
    }),
  );
  await auditar('AGENDAMENTO_REAGENDADO', req, { usuarioId: req.usuario!.id, entidade: 'Agendamento', entidadeId: id });
  return formatar(atualizado, slot.zona, dono ? 'funcionario' : 'gestao');
}

// ─── RF25: o cliente gerencia pelo link do e-mail ────────

function formatarParaCliente(a: AgendamentoCompleto, zona: string) {
  return {
    id: a.id,
    inicio: local(a.inicio, zona),
    fim: local(a.fim, zona),
    status: a.status,
    valorCentavos: a.valorCentavos,
    servico: { id: a.servico.id, nome: a.servico.nome },
    profissional: { id: a.funcionario.id, nome: a.funcionario.nome },
    sinalCentavos: a.sinalCentavos,
    sinalStatus: a.pagamentos[0]?.status ?? null,
    expiraSinalEm: a.expiraSinalEm?.toISOString() ?? null,
  };
}

async function porToken(token: string) {
  const a = await prisma.agendamento.findUnique({ where: { tokenGestaoHash: sha256(token) }, include: incluir });
  if (!a) throw new AppError('LINK_INVALIDO', 'Link inválido. Confira o e-mail de confirmação.', 404);
  return a;
}

function horasAte(d: Date) {
  return (d.getTime() - Date.now()) / 3_600_000;
}

export async function consultarPorToken(token: string) {
  const [a, zona, config, empresa] = await Promise.all([
    porToken(token),
    zonaDaEmpresa(),
    obterConfigAgenda(),
    prisma.empresa.findUnique({ where: { id: 1 }, select: { politicaCancelamento: true, whatsapp: true, telefone: true } }),
  ]);
  const ativo = ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(a.status);
  return {
    ...formatarParaCliente(a, zona),
    podeCancelar: ativo && horasAte(a.inicio) >= config.prazoCancelamentoHoras,
    podeReagendar: ativo && horasAte(a.inicio) >= config.prazoReagendamentoHoras,
    prazoCancelamentoHoras: config.prazoCancelamentoHoras,
    prazoReagendamentoHoras: config.prazoReagendamentoHoras,
    politicaCancelamento: empresa?.politicaCancelamento ?? null,
    contato: empresa?.whatsapp ?? empresa?.telefone ?? null,
    // RF29: o cliente pode voltar pelo link e pagar o Pix enquanto o prazo não vence
    pix: a.status === 'AGUARDANDO_PAGAMENTO' ? await pagamentos.pixDoAgendamento(a.id) : null,
    reembolsoAteHoras: (await obterConfigSinal()).reembolsoAteHoras,
  };
}

// RF30: resposta mínima para a tela do Pix saber se o pagamento caiu
export async function statusSinalPorToken(token: string) {
  const a = await porToken(token);
  return { status: a.status, sinalStatus: a.pagamentos[0]?.status ?? null };
}

export async function simularPixPorToken(token: string) {
  const a = await porToken(token);
  await pagamentos.simularPagamento(a.id);
  return statusSinalPorToken(token);
}

export async function cancelarPorToken(req: Request, token: string, motivo?: string | null) {
  const a = await porToken(token);
  const config = await obterConfigAgenda();
  if (!['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(a.status)) {
    throw new AppError('STATUS_INVALIDO', 'Esse agendamento não pode mais ser cancelado', 409);
  }
  if (horasAte(a.inicio) < config.prazoCancelamentoHoras) {
    throw new AppError('FORA_DO_PRAZO', `Cancelamentos pelo site só até ${config.prazoCancelamentoHoras} h antes. Fale com a empresa.`, 409);
  }
  const { count } = await prisma.agendamento.updateMany({
    where: { id: a.id, status: a.status },
    data: { status: 'CANCELADO', canceladoEm: new Date(), motivoCancelamento: motivo ?? 'Cancelado pelo cliente', expiraSinalEm: null },
  });
  if (!count) throw new AppError('STATUS_MUDOU', 'O agendamento mudou enquanto isso. Abra o link de novo.', 409);
  await auditar('AGENDAMENTO_CANCELADO_CLIENTE', req, { entidade: 'Agendamento', entidadeId: a.id });
  // RF32: devolve o sinal se cancelou com antecedência suficiente; senão a empresa retém
  return { sinal: await pagamentos.aposEncerrar(req, a.id, 'CANCELADO') };
}

export async function reagendarPorToken(req: Request, token: string, data: string, horario: string) {
  const a = await porToken(token);
  const config = await obterConfigAgenda();
  if (!['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(a.status)) {
    throw new AppError('STATUS_INVALIDO', 'Esse agendamento não pode mais ser remarcado', 409);
  }
  if (horasAte(a.inicio) < config.prazoReagendamentoHoras) {
    throw new AppError('FORA_DO_PRAZO', `Remarcações pelo site só até ${config.prazoReagendamentoHoras} h antes. Fale com a empresa.`, 409);
  }
  // Mesmo serviço e mesmo profissional; só muda o horário
  const slot = await reservarHorario({ servicoId: a.servicoId, funcionarioId: a.funcionarioId, data, horario, ignorarAgendamentoId: a.id, online: true });
  const atualizado = await gravar(() =>
    prisma.agendamento.update({
      where: { id: a.id },
      data: { inicio: slot.inicio, fim: slot.fim, fimOcupado: slot.fimOcupado, lembrete24hEm: null, lembrete2hEm: null },
      include: incluir,
    }),
  );
  await auditar('AGENDAMENTO_REAGENDADO', req, { entidade: 'Agendamento', entidadeId: a.id, detalhes: { por: 'cliente' } });
  return formatarParaCliente(atualizado, slot.zona);
}

// ─── Painel: opções para o formulário de agendamento ─────

// Serviços ativos e quem faz cada um (inclui quem não aparece no site).
// Com "funcionarioId", só os serviços daquela pessoa (visão do funcionário).
export async function opcoes(funcionarioId?: string) {
  const servicos = await prisma.servico.findMany({
    where: { ativo: true, deletedAt: null, ...(funcionarioId && { funcionarios: { some: { funcionarioId } } }) },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    include: {
      funcionarios: {
        where: { funcionario: { ativo: true }, ...(funcionarioId && { funcionarioId }) },
        include: { funcionario: true },
        orderBy: { funcionario: { ordem: 'asc' } },
      },
    },
  });
  return servicos.map((s) => ({
    id: s.id,
    nome: s.nome,
    profissionais: s.funcionarios.map((sf) => ({
      id: sf.funcionarioId,
      nome: sf.funcionario.nome,
      duracaoMin: sf.duracaoMin ?? s.duracaoMin,
      precoCentavos: sf.precoCentavos ?? s.precoCentavos,
    })),
  }));
}

// Horários livres para o painel: mesma conta do site, sem antecedência mínima
export async function horariosLivresPainel(p: { servicoId: string; funcionarioId: string; data: string; ignorarAgendamentoId?: string }) {
  const [zona, config] = await Promise.all([zonaDaEmpresa(), obterConfigAgenda()]);
  const sf = await prisma.servicoFuncionario.findUnique({
    where: { servicoId_funcionarioId: { servicoId: p.servicoId, funcionarioId: p.funcionarioId } },
    include: { servico: true, funcionario: { select: { ativo: true } } },
  });
  if (!sf || !sf.funcionario.ativo || !sf.servico.ativo || sf.servico.deletedAt) throw new AppError('PROFISSIONAL_INVALIDO', 'Esse profissional não faz esse serviço', 400);
  return horariosLivresDoFuncionario(
    p.funcionarioId,
    p.data,
    { duracaoMin: sf.duracaoMin ?? sf.servico.duracaoMin, limpezaMin: sf.servico.intervaloLimpezaMin },
    { zona, config: { ...config, antecedenciaMinimaMin: 0 }, ignorarAgendamentoId: p.ignorarAgendamentoId },
  );
}
