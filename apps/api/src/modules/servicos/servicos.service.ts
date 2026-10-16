import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { custoDaFicha, incluirFicha, margem } from '../estoque/ficha.service.js';
import type {
  categoriaSchema,
  criarServicoSchema,
  definirEquipeSchema,
  editarCategoriaSchema,
  editarServicoSchema,
} from './servicos.schemas.js';

const incluir = {
  categoria: { select: { id: true, nome: true } },
  funcionarios: {
    select: {
      funcionarioId: true,
      precoCentavos: true,
      duracaoMin: true,
      comissaoPct: true,
      funcionario: { select: { nome: true, ativo: true, exibirNoSite: true } },
    },
  },
  // RF15: custo e margem a partir da ficha técnica
  ...incluirFicha,
} as const;

type ServicoCompleto = Prisma.ServicoGetPayload<{ include: typeof incluir }>;

// RF11/RF12: explica para o admin por que um serviço não aparece em /agendar
// (mesmas regras do catálogo público em publico.service.ts)
function motivoForaDoSite(s: ServicoCompleto): string | null {
  if (!s.ativo) return 'Serviço inativo';
  if (!s.funcionarios.length) return 'Nenhum profissional faz esse serviço';
  const ativos = s.funcionarios.filter((f) => f.funcionario.ativo);
  if (!ativos.length) return 'Os profissionais desse serviço estão inativos';
  if (!ativos.some((f) => f.funcionario.exibirNoSite)) return 'Nenhum profissional dele aparece no site';
  return null;
}

function formatar(s: ServicoCompleto) {
  const { funcionarios, deletedAt: _d, fichaTecnica, custosExtras, ...resto } = s;
  const motivo = motivoForaDoSite(s);
  const custoCentavos = custoDaFicha({ fichaTecnica, custosExtras });
  return {
    ...resto,
    // RF15: custo dos produtos + extras, e a margem sobre o preço do serviço
    custoCentavos,
    temFicha: fichaTecnica.length + custosExtras.length > 0,
    ...margem(s.precoCentavos, custoCentavos),
    noSite: motivo === null,
    motivoForaDoSite: motivo,
    equipe: funcionarios.map((f) => ({
      funcionarioId: f.funcionarioId,
      nome: f.funcionario.nome,
      ativo: f.funcionario.ativo,
      precoCentavos: f.precoCentavos,
      duracaoMin: f.duracaoMin,
      comissaoPct: f.comissaoPct === null ? null : Number(f.comissaoPct), // RF54
    })),
  };
}

async function buscarAtivo(id: string) {
  const s = await prisma.servico.findFirst({ where: { id, deletedAt: null }, include: incluir });
  if (!s) throw new AppError('NAO_ENCONTRADO', 'Serviço não encontrado', 404);
  return s;
}

async function garantirNomeLivre(nome: string, ignorarId?: string) {
  const igual = await prisma.servico.findFirst({
    where: { deletedAt: null, nome: { equals: nome, mode: 'insensitive' }, ...(ignorarId && { id: { not: ignorarId } }) },
  });
  if (igual) throw new AppError('NOME_EM_USO', 'Já existe um serviço com esse nome', 409);
}

async function garantirCategoria(categoriaId: string | null | undefined) {
  if (categoriaId && !(await prisma.categoriaServico.findUnique({ where: { id: categoriaId } }))) {
    throw new AppError('CATEGORIA_INVALIDA', 'Categoria não encontrada', 400);
  }
}

// ─── RF12 ────────────────────────────────────────────────

export async function listar(incluirInativos: boolean) {
  const lista = await prisma.servico.findMany({
    where: { deletedAt: null, ...(!incluirInativos && { ativo: true }) },
    include: incluir,
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
  return lista.map(formatar);
}

export async function obter(id: string) {
  return formatar(await buscarAtivo(id));
}

export async function criar(req: Request, dados: z.infer<typeof criarServicoSchema>) {
  await garantirNomeLivre(dados.nome);
  await garantirCategoria(dados.categoriaId);
  const s = await prisma.servico.create({ data: dados, include: incluir });
  await auditar('SERVICO_CRIADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Servico',
    entidadeId: s.id,
    detalhes: { nome: s.nome, precoCentavos: s.precoCentavos },
  });
  return formatar(s);
}

export async function editar(req: Request, id: string, dados: z.infer<typeof editarServicoSchema>) {
  const anterior = await buscarAtivo(id);
  if (dados.nome) await garantirNomeLivre(dados.nome, id);
  await garantirCategoria(dados.categoriaId);

  const s = await prisma.servico.update({ where: { id }, data: dados, include: incluir });

  // 9.7: mudança de preço sempre fica registrada com o valor anterior
  const detalhes: Record<string, unknown> = { campos: Object.keys(dados) };
  if (dados.precoCentavos !== undefined && dados.precoCentavos !== anterior.precoCentavos) {
    detalhes.preco = { de: anterior.precoCentavos, para: dados.precoCentavos };
  }
  await auditar('SERVICO_ALTERADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Servico',
    entidadeId: id,
    detalhes: detalhes as Prisma.InputJsonValue,
  });
  return formatar(s);
}

// Exclusão lógica: some das telas, mas agendamentos antigos continuam apontando para ele
export async function remover(req: Request, id: string) {
  await buscarAtivo(id);
  await prisma.servico.update({ where: { id }, data: { deletedAt: new Date(), ativo: false } });
  await auditar('SERVICO_REMOVIDO', req, { usuarioId: req.usuario!.id, entidade: 'Servico', entidadeId: id });
}

// ─── RF13: quem executa o serviço ────────────────────────

export async function definirEquipe(req: Request, id: string, equipe: z.infer<typeof definirEquipeSchema>) {
  await buscarAtivo(id);

  const ids = equipe.map((e) => e.funcionarioId);
  const encontrados = await prisma.funcionario.count({ where: { id: { in: ids } } });
  if (encontrados !== ids.length) throw new AppError('FUNCIONARIO_INVALIDO', 'Algum funcionário não existe', 400);

  // Tudo ou nada: apaga a lista antiga e grava a nova na mesma transação
  await prisma.$transaction([
    prisma.servicoFuncionario.deleteMany({ where: { servicoId: id } }),
    prisma.servicoFuncionario.createMany({
      data: equipe.map((e) => ({
        servicoId: id,
        funcionarioId: e.funcionarioId,
        precoCentavos: e.precoCentavos ?? null,
        duracaoMin: e.duracaoMin ?? null,
        comissaoPct: e.comissaoPct ?? null,
      })),
    }),
  ]);

  await auditar('SERVICO_EQUIPE_ALTERADA', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Servico',
    entidadeId: id,
    detalhes: { funcionarios: ids.length },
  });
  return obter(id);
}

// ─── Categorias ──────────────────────────────────────────

export function listarCategorias() {
  return prisma.categoriaServico.findMany({ orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
}

function tratarNomeDuplicado(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError('NOME_EM_USO', 'Já existe uma categoria com esse nome', 409);
  }
  throw err;
}

export async function criarCategoria(dados: z.infer<typeof categoriaSchema>) {
  return prisma.categoriaServico.create({ data: dados }).catch(tratarNomeDuplicado);
}

export async function editarCategoria(id: string, dados: z.infer<typeof editarCategoriaSchema>) {
  if (!(await prisma.categoriaServico.findUnique({ where: { id } }))) {
    throw new AppError('NAO_ENCONTRADO', 'Categoria não encontrada', 404);
  }
  return prisma.categoriaServico.update({ where: { id }, data: dados }).catch(tratarNomeDuplicado);
}

// Os serviços da categoria ficam "sem categoria" (não são apagados)
export async function removerCategoria(id: string) {
  const { count } = await prisma.categoriaServico.deleteMany({ where: { id } });
  if (count === 0) throw new AppError('NAO_ENCONTRADO', 'Categoria não encontrada', 404);
}
