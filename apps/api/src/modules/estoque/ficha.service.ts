import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import type { fichaSchema } from './estoque.schemas.js';

// RF14: ficha técnica (produtos por atendimento + custos extras)
// RF15: custo e margem do serviço = preço − (Σ quantidade × custo médio + extras)

const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);

export const incluirFicha = {
  fichaTecnica: { include: { produto: { select: { id: true, nome: true, unidade: true, custoMedio: true, deletedAt: true, ativo: true } } } },
  custosExtras: { orderBy: { descricao: 'asc' as const } },
} satisfies Prisma.ServicoInclude;

type ComFicha = Prisma.ServicoGetPayload<{ include: typeof incluirFicha }>;

export function custoDaFicha(s: Pick<ComFicha, 'fichaTecnica' | 'custosExtras'>) {
  const produtos = s.fichaTecnica.reduce((t, i) => t.plus(D(i.quantidade).mul(i.produto.custoMedio)), D(0));
  const extras = s.custosExtras.reduce((t, e) => t + e.valorCentavos, 0);
  return Math.round(produtos.toNumber()) + extras;
}

export function margem(precoCentavos: number, custoCentavos: number) {
  const margemCentavos = precoCentavos - custoCentavos;
  return { margemCentavos, margemPct: precoCentavos > 0 ? Math.round((margemCentavos / precoCentavos) * 1000) / 10 : null };
}

export function formatarFicha(s: ComFicha) {
  const custoCentavos = custoDaFicha(s);
  return {
    itens: s.fichaTecnica.map((i) => ({
      produtoId: i.produtoId,
      nome: i.produto.nome,
      unidade: i.produto.unidade,
      quantidade: Number(i.quantidade),
      custoCentavos: Math.round(D(i.quantidade).mul(i.produto.custoMedio).toNumber()),
      produtoInativo: Boolean(i.produto.deletedAt) || !i.produto.ativo,
    })),
    extras: s.custosExtras.map((e) => ({ id: e.id, descricao: e.descricao, valorCentavos: e.valorCentavos })),
    custoCentavos,
    ...margem(s.precoCentavos, custoCentavos),
  };
}

export async function obterFicha(servicoId: string) {
  const s = await prisma.servico.findFirst({ where: { id: servicoId, deletedAt: null }, include: incluirFicha });
  if (!s) throw new AppError('NAO_ENCONTRADO', 'Serviço não encontrado', 404);
  return formatarFicha(s);
}

export async function salvarFicha(req: Request, servicoId: string, dados: z.infer<typeof fichaSchema>) {
  const s = await prisma.servico.findFirst({ where: { id: servicoId, deletedAt: null } });
  if (!s) throw new AppError('NAO_ENCONTRADO', 'Serviço não encontrado', 404);
  const ids = dados.itens.map((i) => i.produtoId);
  const validos = await prisma.produto.count({ where: { id: { in: ids }, deletedAt: null } });
  if (validos !== ids.length) throw new AppError('PRODUTO_INVALIDO', 'Algum produto da ficha não existe mais', 400);

  await prisma.$transaction([
    prisma.fichaTecnicaItem.deleteMany({ where: { servicoId } }),
    prisma.custoExtraServico.deleteMany({ where: { servicoId } }),
    prisma.fichaTecnicaItem.createMany({ data: dados.itens.map((i) => ({ servicoId, produtoId: i.produtoId, quantidade: D(i.quantidade) })) }),
    prisma.custoExtraServico.createMany({ data: dados.extras.map((e) => ({ servicoId, ...e })) }),
  ]);
  await auditar('FICHA_TECNICA_ALTERADA', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Servico',
    entidadeId: servicoId,
    detalhes: { itens: dados.itens.length, extras: dados.extras.length },
  });
  return obterFicha(servicoId);
}
