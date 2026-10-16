import type { Request } from 'express';
import { Prisma, type Produto, type TipoMovimentacao } from '@prisma/client';
import { DateTime } from 'luxon';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { enviarEmail } from '../../lib/mailer.js';
import { enfileirar } from '../../jobs/fila.js';
import type { criarProdutoSchema, editarProdutoSchema, listarProdutosQuery, movimentoSchema } from './estoque.schemas.js';

// Fase 7: estoque (RF38–RF42).
// Todo movimento trava a linha do produto (SELECT ... FOR UPDATE) antes de mexer no saldo:
// duas baixas ao mesmo tempo nunca leem o mesmo saldo, e o custo médio fica certo.

const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);
const ZERO = D(0);
export const DIAS_AVISO_VALIDADE = 30;

const dataDb = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : iso === null ? null : undefined);
const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function hojeIso() {
  return DateTime.now().setZone('America/Sao_Paulo').toISODate()!;
}

// RF41: situação do produto para a tela
export function situacao(p: Pick<Produto, 'estoqueAtual' | 'estoqueMinimo' | 'validade'>) {
  const hoje = hojeIso();
  const validade = dataIso(p.validade);
  const diasParaVencer = validade ? Math.round(DateTime.fromISO(validade).diff(DateTime.fromISO(hoje), 'days').days) : null;
  return {
    abaixoDoMinimo: D(p.estoqueAtual).lt(p.estoqueMinimo) && D(p.estoqueMinimo).gt(0),
    semEstoque: D(p.estoqueAtual).lte(0),
    vencido: diasParaVencer !== null && diasParaVencer < 0,
    venceEmBreve: diasParaVencer !== null && diasParaVencer >= 0 && diasParaVencer <= DIAS_AVISO_VALIDADE,
    diasParaVencer,
  };
}

export function formatar(p: Produto) {
  return {
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    categoria: p.categoria,
    unidade: p.unidade,
    custoMedioCentavos: Number(p.custoMedio), // por unidade (ml, g, un), com fração
    estoqueAtual: Number(p.estoqueAtual),
    estoqueMinimo: Number(p.estoqueMinimo),
    valorEmEstoqueCentavos: Math.round(Math.max(0, Number(p.estoqueAtual)) * Number(p.custoMedio)),
    fornecedor: p.fornecedor,
    validade: dataIso(p.validade),
    ativo: p.ativo,
    ...situacao(p),
  };
}

// ─── RF38: produtos ──────────────────────────────────────

export async function listar(q: z.infer<typeof listarProdutosQuery>) {
  const lista = await prisma.produto.findMany({
    where: {
      deletedAt: null,
      ...(!q.incluirInativos && { ativo: true }),
      ...(q.busca && {
        OR: [
          { nome: { contains: q.busca, mode: 'insensitive' } },
          { sku: { contains: q.busca, mode: 'insensitive' } },
          { categoria: { contains: q.busca, mode: 'insensitive' } },
        ],
      }),
    },
    orderBy: [{ categoria: 'asc' }, { nome: 'asc' }],
    take: 500,
  });
  const formatados = lista.map(formatar);
  return q.alertas ? formatados.filter((p) => p.abaixoDoMinimo || p.vencido || p.venceEmBreve) : formatados;
}

async function buscar(id: string) {
  const p = await prisma.produto.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new AppError('NAO_ENCONTRADO', 'Produto não encontrado', 404);
  return p;
}

function tratarSkuDuplicado(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError('SKU_EM_USO', 'Já existe um produto com esse SKU', 409);
  }
  throw err;
}

export async function criar(req: Request, dados: z.infer<typeof criarProdutoSchema>) {
  const { estoqueInicial, custoTotalInicialCentavos, validade, estoqueMinimo, ...resto } = dados;
  if (estoqueInicial && custoTotalInicialCentavos === undefined) {
    throw new AppError('VALIDACAO', 'Informe quanto pagou pelo estoque inicial', 400);
  }
  let produto: Produto;
  try {
    produto = await prisma.produto.create({
      data: { ...resto, estoqueMinimo: D(estoqueMinimo ?? 0), validade: dataDb(validade) },
    });
  } catch (err) {
    tratarSkuDuplicado(err);
  }
  await auditar('PRODUTO_CRIADO', req, { usuarioId: req.usuario!.id, entidade: 'Produto', entidadeId: produto.id, detalhes: { nome: produto.nome } });
  if (estoqueInicial) {
    await movimentar(req, { tipo: 'ENTRADA', produtoId: produto.id, quantidade: estoqueInicial, custoTotalCentavos: custoTotalInicialCentavos!, motivo: 'Estoque inicial' });
  }
  return formatar(await buscar(produto.id));
}

export async function editar(req: Request, id: string, dados: z.infer<typeof editarProdutoSchema>) {
  const anterior = await buscar(id);
  const { validade, estoqueMinimo, ...resto } = dados;
  let p: Produto;
  try {
    p = await prisma.produto.update({
      where: { id },
      data: {
        ...resto,
        ...(estoqueMinimo !== undefined && { estoqueMinimo: D(estoqueMinimo), alertaMinimoEm: null }),
        ...(validade !== undefined && { validade: dataDb(validade), alertaValidadeEm: null }),
      },
    });
  } catch (err) {
    tratarSkuDuplicado(err);
  }
  await auditar('PRODUTO_ALTERADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Produto',
    entidadeId: id,
    detalhes: { campos: Object.keys(dados), ...(estoqueMinimo !== undefined && { minimo: { de: Number(anterior.estoqueMinimo), para: estoqueMinimo } }) },
  });
  return formatar(p);
}

// Exclusão lógica: o histórico continua apontando para ele
export async function remover(req: Request, id: string) {
  await buscar(id);
  const emUso = await prisma.fichaTecnicaItem.findMany({ where: { produtoId: id }, include: { servico: { select: { nome: true, deletedAt: true } } } });
  const servicos = emUso.filter((f) => !f.servico.deletedAt).map((f) => f.servico.nome);
  if (servicos.length) {
    throw new AppError('EM_USO', `Esse produto está na ficha técnica de: ${servicos.join(', ')}. Tire de lá antes.`, 409);
  }
  await prisma.produto.update({ where: { id }, data: { deletedAt: new Date(), ativo: false } });
  await auditar('PRODUTO_REMOVIDO', req, { usuarioId: req.usuario!.id, entidade: 'Produto', entidadeId: id });
}

// ─── RF39, RF42: movimentações ───────────────────────────

interface Lancamento {
  produtoId: string;
  tipo: TipoMovimentacao;
  delta: Prisma.Decimal; // com sinal
  custoTotalCentavos?: number; // só ENTRADA
  validade?: string | null;
  motivo?: string | null;
  usuarioId?: string | null;
  agendamentoId?: string | null;
  permitirNegativo?: boolean; // baixa automática não trava o fechamento do atendimento
}

// Coração do estoque. Precisa rodar dentro de uma transação.
export async function lancar(tx: Prisma.TransactionClient, l: Lancamento) {
  // Trava a linha: quem chegar depois espera esta transação terminar
  const [linha] = await tx.$queryRaw<{ estoque_atual: Prisma.Decimal; custo_medio: Prisma.Decimal; estoque_minimo: Prisma.Decimal; alerta_minimo_em: Date | null; ativo: boolean; deleted_at: Date | null }[]>`
    SELECT estoque_atual, custo_medio, estoque_minimo, alerta_minimo_em, ativo, deleted_at
    FROM produtos WHERE id = ${l.produtoId}::uuid FOR UPDATE`;
  if (!linha || linha.deleted_at) throw new AppError('NAO_ENCONTRADO', 'Produto não encontrado', 404);

  const saldo = D(linha.estoque_atual);
  const novoSaldo = saldo.plus(l.delta);
  if (novoSaldo.lt(0) && !l.permitirNegativo) {
    throw new AppError('ESTOQUE_INSUFICIENTE', `Só há ${saldo.toString()} em estoque`, 409);
  }

  let custoMedio = D(linha.custo_medio);
  let custoUnitario = custoMedio;
  if (l.tipo === 'ENTRADA') {
    custoUnitario = D(l.custoTotalCentavos!).div(l.delta).toDecimalPlaces(4);
    // RF42: média ponderada pelo que já havia. Saldo zerado/negativo = vale o preço da compra.
    custoMedio = saldo.lte(0) ? custoUnitario : saldo.mul(custoMedio).plus(l.custoTotalCentavos!).div(novoSaldo).toDecimalPlaces(4);
  }

  const minimo = D(linha.estoque_minimo);
  const ficouAbaixo = minimo.gt(0) && novoSaldo.lt(minimo);
  const cruzouMinimo = ficouAbaixo && !linha.alerta_minimo_em;

  await tx.produto.update({
    where: { id: l.produtoId },
    data: {
      estoqueAtual: novoSaldo,
      custoMedio,
      // RF41: marca quando cruzou o mínimo (um aviso só); volta a zerar quando repõe
      alertaMinimoEm: ficouAbaixo ? (linha.alerta_minimo_em ?? new Date()) : null,
      ...(l.validade !== undefined && { validade: dataDb(l.validade), alertaValidadeEm: null }),
    },
  });
  await tx.movimentacaoEstoque.create({
    data: {
      produtoId: l.produtoId,
      tipo: l.tipo,
      quantidade: l.delta,
      custoUnitario,
      saldoApos: novoSaldo,
      motivo: l.motivo ?? null,
      usuarioId: l.usuarioId ?? null,
      agendamentoId: l.agendamentoId ?? null,
    },
  });
  return { custoUnitario, novoSaldo, cruzouMinimo };
}

export async function movimentar(req: Request, m: z.infer<typeof movimentoSchema>) {
  const resultado = await prisma.$transaction(async (tx) => {
    if (m.tipo === 'AJUSTE') {
      // Trava e lê o saldo para calcular a diferença (o lançamento trava de novo, na mesma transação)
      const [travado] = await tx.$queryRaw<{ estoque_atual: Prisma.Decimal }[]>`SELECT estoque_atual FROM produtos WHERE id = ${m.produtoId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!travado) throw new AppError('NAO_ENCONTRADO', 'Produto não encontrado', 404);
      const delta = D(m.saldoContado).minus(D(travado.estoque_atual));
      if (delta.isZero()) throw new AppError('SEM_DIFERENCA', 'O saldo contado é igual ao do sistema', 400);
      return lancar(tx, { produtoId: m.produtoId, tipo: 'AJUSTE', delta, motivo: m.motivo, usuarioId: req.usuario!.id });
    }
    const delta = m.tipo === 'ENTRADA' ? D(m.quantidade) : D(m.quantidade).neg();
    return lancar(tx, {
      produtoId: m.produtoId,
      tipo: m.tipo,
      delta,
      custoTotalCentavos: m.tipo === 'ENTRADA' ? m.custoTotalCentavos : undefined,
      validade: m.tipo === 'ENTRADA' ? m.validade : undefined,
      motivo: m.motivo,
      usuarioId: req.usuario!.id,
    });
  });

  // 9.7: ajuste de estoque fica na auditoria
  await auditar('ESTOQUE_MOVIMENTADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Produto',
    entidadeId: m.produtoId,
    detalhes: { tipo: m.tipo, saldoApos: Number(resultado.novoSaldo) },
  });
  if (resultado.cruzouMinimo) avisarEstoqueBaixo([m.produtoId]);
  return formatar(await buscar(m.produtoId));
}

export async function historico(produtoId: string) {
  await buscar(produtoId);
  const lista = await prisma.movimentacaoEstoque.findMany({
    where: { produtoId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { agendamento: { select: { id: true, cliente: { select: { nome: true } }, servico: { select: { nome: true } } } } },
  });
  const nomes = new Map(
    (await prisma.usuario.findMany({ where: { id: { in: [...new Set(lista.map((m) => m.usuarioId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]),
  );
  return lista.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    quantidade: Number(m.quantidade),
    custoUnitarioCentavos: Number(m.custoUnitario),
    saldoApos: Number(m.saldoApos),
    motivo: m.motivo,
    usuario: m.usuarioId ? (nomes.get(m.usuarioId) ?? null) : null,
    atendimento: m.agendamento ? `${m.agendamento.servico.nome} · ${m.agendamento.cliente.nome}` : null,
    criadoEm: m.createdAt.toISOString(),
  }));
}

// ─── RF41: alertas ───────────────────────────────────────

export async function resumoAlertas() {
  const lista = await listar({ alertas: true, incluirInativos: false });
  return {
    abaixoDoMinimo: lista.filter((p) => p.abaixoDoMinimo).length,
    vencidos: lista.filter((p) => p.vencido).length,
    vencendo: lista.filter((p) => p.venceEmBreve).length,
  };
}

async function destinatariosAlerta() {
  const u = await prisma.usuario.findMany({ where: { ativo: true, perfil: { in: ['ADMIN', 'GERENTE'] } }, select: { email: true } });
  return u.map((x) => x.email);
}

const unidadeTexto = { ML: 'ml', G: 'g', UN: 'un' } as const;

export async function enviarAlertaEstoqueBaixo(produtoIds: string[]) {
  const produtos = await prisma.produto.findMany({ where: { id: { in: produtoIds }, deletedAt: null } });
  const abaixo = produtos.filter((p) => D(p.estoqueAtual).lt(p.estoqueMinimo));
  if (!abaixo.length) return 0;
  const linhas = abaixo.map((p) => `• ${p.nome}: ${Number(p.estoqueAtual)} ${unidadeTexto[p.unidade]} (mínimo ${Number(p.estoqueMinimo)})`);
  for (const email of await destinatariosAlerta()) {
    await enviarEmail(email, 'Estoque abaixo do mínimo', ['Estes produtos precisam de reposição:', '', ...linhas].join('\n'));
  }
  return abaixo.length;
}

// Agenda o aviso na fila (fluxo 6.3); sem fila (testes), envia direto
export function avisarEstoqueBaixo(produtoIds: string[]) {
  if (!produtoIds.length) return;
  if (!enfileirar('alerta-estoque', { produtoIds })) {
    void enviarAlertaEstoqueBaixo(produtoIds).catch(() => undefined);
  }
}

// RF41: roda pela fila uma vez por dia; avisa cada produto uma vez (até mudar a validade)
export async function enviarAlertaValidade(agora = new Date()) {
  const limite = DateTime.fromJSDate(agora).setZone('America/Sao_Paulo').plus({ days: 15 }).toISODate()!;
  const produtos = await prisma.produto.findMany({
    where: { deletedAt: null, ativo: true, validade: { lte: new Date(`${limite}T00:00:00Z`) }, alertaValidadeEm: null },
  });
  if (!produtos.length) return 0;
  const linhas = produtos.map((p) => {
    const s = situacao(p);
    return `• ${p.nome}: ${s.vencido ? `venceu há ${-s.diasParaVencer!} dia(s)` : s.diasParaVencer === 0 ? 'vence hoje' : `vence em ${s.diasParaVencer} dia(s)`}`;
  });
  for (const email of await destinatariosAlerta()) {
    await enviarEmail(email, 'Produtos perto da validade', ['Confira estes produtos:', '', ...linhas].join('\n'));
  }
  await prisma.produto.updateMany({ where: { id: { in: produtos.map((p) => p.id) } }, data: { alertaValidadeEm: agora } });
  return produtos.length;
}
