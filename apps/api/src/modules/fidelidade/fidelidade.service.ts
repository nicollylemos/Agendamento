import type { Request } from 'express';
import { Prisma, type ProgramaFidelidade, type TipoTransacaoFidelidade } from '@prisma/client';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { enviarEmail } from '../../lib/mailer.js';
import type { ajusteSchema, programaSchema, recompensaSchema } from './fidelidade.schemas.js';

// Fase 8: fidelidade (RF43–RF46).
//
// Saldo = soma do "disponível" dos créditos que ainda não venceram. Quem gasta (resgate,
// ajuste negativo, estorno) consome primeiro o que vence antes (FIFO). Toda operação que
// mexe no saldo trava o cliente (SELECT ... FOR UPDATE): dois resgates ao mesmo tempo
// nunca gastam o mesmo ponto. O extrato é só de inserção (trigger no banco).

type Tx = Prisma.TransactionClient;

// ─── RF43: programa ──────────────────────────────────────

export async function obterPrograma(db: Tx | typeof prisma = prisma) {
  return db.programaFidelidade.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function salvarPrograma(req: Request, dados: z.infer<typeof programaSchema>) {
  if (dados.servicosElegiveis.length) {
    const n = await prisma.servico.count({ where: { id: { in: dados.servicosElegiveis }, deletedAt: null } });
    if (n !== dados.servicosElegiveis.length) throw new AppError('SERVICO_INVALIDO', 'Algum serviço escolhido não existe', 400);
  }
  if (dados.tipo === 'PONTOS' && dados.ativo && !dados.pontosPorReal && !dados.pontosPorAtendimento) {
    throw new AppError('VALIDACAO', 'Defina quantos pontos o cliente ganha', 400);
  }
  const p = await prisma.programaFidelidade.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
  await auditar('FIDELIDADE_PROGRAMA_ALTERADO', req, { usuarioId: req.usuario!.id, entidade: 'ProgramaFidelidade', detalhes: dados });
  return p;
}

// Quanto um atendimento rende (RF43). Zero se o programa está desligado ou o serviço não participa.
export function pontosDoAtendimento(p: ProgramaFidelidade, a: { valorCentavos: number; servicoId: string }) {
  if (!p.ativo) return 0;
  if (p.servicosElegiveis.length && !p.servicosElegiveis.includes(a.servicoId)) return 0;
  if (p.tipo === 'SELOS') return 1;
  return Math.floor(a.valorCentavos / 100) * p.pontosPorReal + p.pontosPorAtendimento;
}

const expiraEm = (p: ProgramaFidelidade, agora = new Date()) => (p.validadeDias ? new Date(agora.getTime() + p.validadeDias * 86_400_000) : null);

// ─── Núcleo: saldo, crédito e débito ─────────────────────

async function travarCliente(tx: Tx, clienteId: string) {
  const r = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clientes WHERE id = ${clienteId}::uuid FOR UPDATE`;
  if (!r.length) throw new AppError('NAO_ENCONTRADO', 'Cliente não encontrado', 404);
}

const filtroValidos = (agora: Date) => ({ pontos: { gt: 0 }, disponivel: { gt: 0 }, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] });

export async function saldo(db: Tx | typeof prisma, clienteId: string, agora = new Date()) {
  const r = await db.transacaoFidelidade.aggregate({ where: { clienteId, ...filtroValidos(agora) }, _sum: { disponivel: true } });
  return r._sum.disponivel ?? 0;
}

interface Movimento {
  clienteId: string;
  tipo: TipoTransacaoFidelidade;
  pontos: number; // sempre positivo aqui; o sinal sai do tipo
  agendamentoId?: string | null;
  resgateId?: string | null;
  motivo?: string | null;
  usuarioId?: string | null;
}

async function creditar(tx: Tx, m: Movimento, programa: ProgramaFidelidade) {
  return tx.transacaoFidelidade.create({
    data: { ...m, pontos: m.pontos, disponivel: m.pontos, expiraEm: expiraEm(programa) },
  });
}

// Gasta FIFO. "parcial": gasta o que tiver (estorno), sem dar erro.
async function debitar(tx: Tx, m: Movimento, parcial = false) {
  const agora = new Date();
  const atual = await saldo(tx, m.clienteId, agora);
  if (atual < m.pontos && !parcial) throw new AppError('PONTOS_INSUFICIENTES', `Saldo insuficiente: ${atual} disponível`, 409);
  let falta = Math.min(m.pontos, atual);
  const valor = falta;
  const creditos = await tx.transacaoFidelidade.findMany({
    where: { clienteId: m.clienteId, ...filtroValidos(agora) },
    orderBy: [{ expiraEm: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });
  for (const c of creditos) {
    if (!falta) break;
    const usar = Math.min(falta, c.disponivel);
    await tx.transacaoFidelidade.update({ where: { id: c.id }, data: { disponivel: c.disponivel - usar } });
    falta -= usar;
  }
  if (!valor) return null;
  return tx.transacaoFidelidade.create({ data: { ...m, pontos: -valor } });
}

// ─── RF45: atendimento concluído / cancelado ─────────────

// Chamado DENTRO da transação que conclui o atendimento (fluxo 6.3)
export async function creditarAtendimento(tx: Tx, agendamentoId: string) {
  const programa = await obterPrograma(tx);
  const a = await tx.agendamento.findUniqueOrThrow({ where: { id: agendamentoId }, select: { clienteId: true, valorCentavos: true, servicoId: true } });
  const pontos = pontosDoAtendimento(programa, a);
  if (!pontos) return null;
  await travarCliente(tx, a.clienteId);
  // Unique (agendamento, CREDITO): o mesmo atendimento nunca credita duas vezes
  await creditar(tx, { clienteId: a.clienteId, tipo: 'CREDITO', pontos, agendamentoId, motivo: 'Atendimento concluído' }, programa);
  return { clienteId: a.clienteId, pontos, tipo: programa.tipo };
}

// RF45: se o atendimento que gerou pontos for cancelado, os pontos saem (o que ainda houver)
export async function estornarAtendimento(tx: Tx, agendamentoId: string, usuarioId?: string | null) {
  const credito = await tx.transacaoFidelidade.findUnique({ where: { agendamentoId_tipo: { agendamentoId, tipo: 'CREDITO' } } });
  if (!credito) return null;
  await travarCliente(tx, credito.clienteId);
  const ja = await tx.transacaoFidelidade.findUnique({ where: { agendamentoId_tipo: { agendamentoId, tipo: 'ESTORNO' } } });
  if (ja) return null;
  return debitar(tx, { clienteId: credito.clienteId, tipo: 'ESTORNO', pontos: credito.pontos, agendamentoId, usuarioId, motivo: 'Atendimento cancelado' }, true);
}

export async function avisarPontos(clienteId: string, pontos: number, tipo: 'PONTOS' | 'SELOS') {
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, email: true } });
  if (!c?.email) return;
  const total = await saldo(prisma, clienteId);
  const nome = tipo === 'SELOS' ? ['selo', 'selos'] : ['ponto', 'pontos'];
  const plural = (n: number) => `${n} ${n === 1 ? nome[0] : nome[1]}`;
  await enviarEmail(
    c.email,
    tipo === 'SELOS' ? 'Você ganhou um selo' : `Você ganhou ${plural(pontos)}`,
    `Olá, ${c.nome.split(' ')[0]}!\n\nObrigado pela visita. Você ganhou ${plural(pontos)} e agora tem ${plural(total)}.\nVeja as recompensas em "Meus agendamentos" no site.`,
  );
}

// ─── RF44: recompensas e vouchers ────────────────────────

function formatarRecompensa(r: Prisma.RecompensaGetPayload<object>) {
  const { deletedAt: _d, createdAt: _c, updatedAt: _u, ...resto } = r;
  return resto;
}

export async function listarRecompensas(incluirInativas: boolean) {
  const l = await prisma.recompensa.findMany({
    where: { deletedAt: null, ...(!incluirInativas && { ativo: true }) },
    orderBy: [{ custoPontos: 'asc' }, { nome: 'asc' }],
  });
  return l.map(formatarRecompensa);
}

async function garantirServico(id: string | null | undefined) {
  if (id && !(await prisma.servico.findFirst({ where: { id, deletedAt: null } }))) throw new AppError('SERVICO_INVALIDO', 'Serviço não encontrado', 400);
}

export async function salvarRecompensa(req: Request, id: string | null, dados: z.infer<typeof recompensaSchema>) {
  await garantirServico(dados.servicoId);
  const data = { ...dados, valorCentavos: dados.tipo === 'DESCONTO' ? dados.valorCentavos : null, servicoId: dados.tipo === 'SERVICO' ? dados.servicoId : null };
  let r;
  if (id) {
    if (!(await prisma.recompensa.findFirst({ where: { id, deletedAt: null } }))) throw new AppError('NAO_ENCONTRADO', 'Recompensa não encontrada', 404);
    r = await prisma.recompensa.update({ where: { id }, data });
  } else {
    r = await prisma.recompensa.create({ data });
  }
  await auditar('RECOMPENSA_SALVA', req, { usuarioId: req.usuario!.id, entidade: 'Recompensa', entidadeId: r.id, detalhes: { custoPontos: r.custoPontos } });
  return formatarRecompensa(r);
}

export async function removerRecompensa(req: Request, id: string) {
  const { count } = await prisma.recompensa.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), ativo: false } });
  if (!count) throw new AppError('NAO_ENCONTRADO', 'Recompensa não encontrada', 404);
  await auditar('RECOMPENSA_REMOVIDA', req, { usuarioId: req.usuario!.id, entidade: 'Recompensa', entidadeId: id });
}

// Código curto, fácil de ditar no balcão (sem 0/O, 1/I)
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const novoCodigo = () => Array.from({ length: 8 }, () => ALFABETO[randomInt(0, ALFABETO.length)]).join('');

export async function resgatar(clienteId: string, recompensaId: string, usuarioId: string | null) {
  const voucher = await prisma.$transaction(async (tx) => {
    await travarCliente(tx, clienteId);
    const r = await tx.recompensa.findFirst({ where: { id: recompensaId, ativo: true, deletedAt: null } });
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Recompensa indisponível', 404);
    const v = await tx.resgateFidelidade.create({
      data: { clienteId, recompensaId, pontos: r.custoPontos, codigo: novoCodigo(), expiraEm: new Date(Date.now() + r.validadeDias * 86_400_000) },
      include: { recompensa: true },
    });
    await debitar(tx, { clienteId, tipo: 'RESGATE', pontos: r.custoPontos, resgateId: v.id, usuarioId, motivo: r.nome });
    return v;
  });
  await auditar('PONTOS_RESGATADOS', null, { usuarioId, entidade: 'ResgateFidelidade', entidadeId: voucher.id, detalhes: { pontos: voucher.pontos } });
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, email: true } });
  if (c?.email) {
    await enviarEmail(
      c.email,
      `Seu voucher: ${voucher.recompensa.nome}`,
      `Olá, ${c.nome.split(' ')[0]}!\n\nVocê trocou ${voucher.pontos} pontos por: ${voucher.recompensa.nome}.\nCódigo: ${voucher.codigo}\nVale até ${voucher.expiraEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. É só mostrar o código no atendimento.`,
    );
  }
  return formatarVoucher(voucher);
}

function formatarVoucher(v: Prisma.ResgateFidelidadeGetPayload<{ include: { recompensa: true } }>) {
  return {
    id: v.id,
    codigo: v.codigo,
    status: v.status === 'DISPONIVEL' && v.expiraEm <= new Date() ? ('EXPIRADO' as const) : v.status,
    pontos: v.pontos,
    expiraEm: v.expiraEm.toISOString(),
    usadoEm: v.usadoEm?.toISOString() ?? null,
    criadoEm: v.createdAt.toISOString(),
    recompensa: { id: v.recompensa.id, nome: v.recompensa.nome, tipo: v.recompensa.tipo, valorCentavos: v.recompensa.valorCentavos },
  };
}

export async function buscarVoucher(codigo: string) {
  const v = await prisma.resgateFidelidade.findUnique({
    where: { codigo: codigo.toUpperCase().replace(/[^A-Z0-9]/g, '') },
    include: { recompensa: true, cliente: { select: { id: true, nome: true, telefone: true } } },
  });
  if (!v) throw new AppError('NAO_ENCONTRADO', 'Voucher não encontrado', 404);
  return { ...formatarVoucher(v), cliente: v.cliente };
}

export async function usarVoucher(req: Request, id: string) {
  // Condicional: duas pessoas clicando "usar" ao mesmo tempo, só uma vale
  const { count } = await prisma.resgateFidelidade.updateMany({
    where: { id, status: 'DISPONIVEL', expiraEm: { gt: new Date() } },
    data: { status: 'USADO', usadoEm: new Date(), usadoPor: req.usuario!.id },
  });
  if (!count) throw new AppError('VOUCHER_INVALIDO', 'Esse voucher já foi usado, cancelado ou venceu', 409);
  await auditar('VOUCHER_USADO', req, { usuarioId: req.usuario!.id, entidade: 'ResgateFidelidade', entidadeId: id });
}

// Cancelar devolve os pontos (com validade nova)
export async function cancelarVoucher(req: Request, id: string) {
  await prisma.$transaction(async (tx) => {
    const v = await tx.resgateFidelidade.findUnique({ where: { id } });
    if (!v) throw new AppError('NAO_ENCONTRADO', 'Voucher não encontrado', 404);
    const { count } = await tx.resgateFidelidade.updateMany({ where: { id, status: 'DISPONIVEL' }, data: { status: 'CANCELADO' } });
    if (!count) throw new AppError('VOUCHER_INVALIDO', 'Só dá para cancelar voucher ainda não usado', 409);
    await travarCliente(tx, v.clienteId);
    await creditar(tx, { clienteId: v.clienteId, tipo: 'DEVOLUCAO', pontos: v.pontos, resgateId: id, usuarioId: req.usuario!.id, motivo: 'Voucher cancelado' }, await obterPrograma(tx));
  });
  await auditar('VOUCHER_CANCELADO', req, { usuarioId: req.usuario!.id, entidade: 'ResgateFidelidade', entidadeId: id });
}

// ─── RF46: ajuste manual com justificativa ───────────────

export async function ajustar(req: Request, clienteId: string, dados: z.infer<typeof ajusteSchema>) {
  await prisma.$transaction(async (tx) => {
    await travarCliente(tx, clienteId);
    const m = { clienteId, tipo: 'AJUSTE' as const, pontos: Math.abs(dados.pontos), motivo: dados.motivo, usuarioId: req.usuario!.id };
    if (dados.pontos > 0) await creditar(tx, m, await obterPrograma(tx));
    else await debitar(tx, m);
  });
  // 9.7: ajuste de pontos sempre na auditoria
  await auditar('PONTOS_AJUSTADOS', req, { usuarioId: req.usuario!.id, entidade: 'Cliente', entidadeId: clienteId, detalhes: dados });
  return resumoCliente(clienteId);
}

// ─── Expiração (roda pela fila uma vez por dia) ──────────

export async function expirar(agora = new Date()) {
  const vencidos = await prisma.transacaoFidelidade.findMany({
    where: { pontos: { gt: 0 }, disponivel: { gt: 0 }, expiraEm: { lte: agora } },
    select: { clienteId: true },
    distinct: ['clienteId'],
    take: 500,
  });
  let pontos = 0;
  for (const { clienteId } of vencidos) {
    pontos += await prisma.$transaction(async (tx) => {
      await travarCliente(tx, clienteId);
      const creditos = await tx.transacaoFidelidade.findMany({ where: { clienteId, pontos: { gt: 0 }, disponivel: { gt: 0 }, expiraEm: { lte: agora } } });
      const total = creditos.reduce((t, c) => t + c.disponivel, 0);
      if (!total) return 0;
      for (const c of creditos) await tx.transacaoFidelidade.update({ where: { id: c.id }, data: { disponivel: 0 } });
      await tx.transacaoFidelidade.create({ data: { clienteId, tipo: 'EXPIRACAO', pontos: -total, motivo: 'Pontos vencidos' } });
      return total;
    });
  }
  // Voucher vencido não devolve pontos (regra comum; a validade aparece no resgate)
  const vouchers = await prisma.resgateFidelidade.updateMany({ where: { status: 'DISPONIVEL', expiraEm: { lte: agora } }, data: { status: 'EXPIRADO' } });
  return { pontos, vouchers: vouchers.count };
}

// ─── Consultas ───────────────────────────────────────────

const NOME_TIPO: Record<TipoTransacaoFidelidade, string> = {
  CREDITO: 'Atendimento',
  ESTORNO: 'Estorno',
  RESGATE: 'Resgate',
  DEVOLUCAO: 'Voucher cancelado',
  AJUSTE: 'Ajuste',
  EXPIRACAO: 'Venceram',
};

export async function resumoCliente(clienteId: string, visao: 'gestao' | 'cliente' = 'gestao') {
  const agora = new Date();
  const [cliente, total, extrato, resgates, proximo] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nome: true, telefone: true, email: true } }),
    saldo(prisma, clienteId, agora),
    prisma.transacaoFidelidade.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { agendamento: { select: { servico: { select: { nome: true } } } } },
    }),
    prisma.resgateFidelidade.findMany({ where: { clienteId }, orderBy: { createdAt: 'desc' }, take: 50, include: { recompensa: true } }),
    // O que vence primeiro (para avisar "X pontos vencem em DD/MM")
    prisma.transacaoFidelidade.findFirst({ where: { clienteId, ...filtroValidos(agora), expiraEm: { gt: agora } }, orderBy: { expiraEm: 'asc' } }),
  ]);
  if (!cliente) throw new AppError('NAO_ENCONTRADO', 'Cliente não encontrado', 404);
  const nomes = visao === 'gestao' ? await nomesUsuarios(extrato.map((e) => e.usuarioId)) : new Map<string, string>();
  return {
    cliente: visao === 'gestao' ? cliente : { id: cliente.id, nome: cliente.nome },
    saldo: total,
    proximoVencimento: proximo ? { pontos: proximo.disponivel, em: proximo.expiraEm!.toISOString() } : null,
    extrato: extrato.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      descricao: [NOME_TIPO[e.tipo], e.agendamento?.servico.nome ?? (e.tipo !== 'CREDITO' ? e.motivo : null)].filter(Boolean).join(': '),
      pontos: e.pontos,
      criadoEm: e.createdAt.toISOString(),
      ...(visao === 'gestao' && { motivo: e.motivo, usuario: e.usuarioId ? (nomes.get(e.usuarioId) ?? null) : null }),
    })),
    vouchers: resgates.map(formatarVoucher),
  };
}

async function nomesUsuarios(ids: (string | null)[]) {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unicos.length) return new Map<string, string>();
  const u = await prisma.usuario.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
  return new Map(u.map((x) => [x.id, x.nome]));
}

// Busca de clientes com saldo (tela Fidelidade → Clientes)
export async function buscarClientes(busca?: string) {
  const digitos = busca?.replace(/\D/g, '') ?? '';
  const clientes = await prisma.cliente.findMany({
    where: busca
      ? {
          OR: [
            { nome: { contains: busca, mode: 'insensitive' } },
            { email: { contains: busca.toLowerCase() } },
            ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
          ],
        }
      : {},
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, nome: true, telefone: true, email: true },
  });
  const agora = new Date();
  const saldos = await prisma.transacaoFidelidade.groupBy({
    by: ['clienteId'],
    where: { clienteId: { in: clientes.map((c) => c.id) }, ...filtroValidos(agora) },
    _sum: { disponivel: true },
  });
  const porCliente = new Map(saldos.map((s) => [s.clienteId, s._sum.disponivel ?? 0]));
  return clientes.map((c) => ({ ...c, saldo: porCliente.get(c.id) ?? 0 }));
}

// ─── RF46: o cliente vê pelo site (sessão por código no e-mail) ──

export async function programaPublico() {
  const p = await obterPrograma();
  if (!p.ativo) return null;
  const servicos = p.servicosElegiveis.length
    ? (await prisma.servico.findMany({ where: { id: { in: p.servicosElegiveis } }, select: { nome: true } })).map((s) => s.nome)
    : null;
  return { tipo: p.tipo, pontosPorReal: p.pontosPorReal, pontosPorAtendimento: p.pontosPorAtendimento, validadeDias: p.validadeDias, servicos };
}

async function clientesDoEmail(email: string) {
  return prisma.cliente.findMany({ where: { email }, select: { id: true } });
}

export async function fidelidadeDoEmail(email: string) {
  const programa = await programaPublico();
  const clientes = await clientesDoEmail(email);
  if (!programa || !clientes.length) return { programa, contas: [], recompensas: [] };
  const contas = await Promise.all(clientes.map((c) => resumoCliente(c.id, 'cliente')));
  return { programa, contas, recompensas: await listarRecompensas(false) };
}

// O cliente troca pelo site: usa o cadastro (desse e-mail) com mais pontos
export async function resgatarPorEmail(email: string, recompensaId: string) {
  if (!(await programaPublico())) throw new AppError('PROGRAMA_INATIVO', 'O programa de fidelidade está desligado', 409);
  const clientes = await clientesDoEmail(email);
  const comSaldo = await Promise.all(clientes.map(async (c) => ({ id: c.id, saldo: await saldo(prisma, c.id) })));
  const melhor = comSaldo.sort((a, b) => b.saldo - a.saldo)[0];
  if (!melhor) throw new AppError('NAO_ENCONTRADO', 'Cadastro não encontrado', 404);
  return resgatar(melhor.id, recompensaId, null);
}

