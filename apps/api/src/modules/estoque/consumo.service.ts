import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { lancar } from './estoque.service.js';
import type { consumoSchema } from './estoque.schemas.js';

// RF40 / fluxo 6.3: baixa dos produtos ao concluir o atendimento.
// Roda DENTRO da mesma transação que muda o status para CONCLUIDO:
// ou conclui e baixa tudo, ou nada acontece.

const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);

// O que a ficha técnica sugere (a tela de concluir mostra para o profissional ajustar)
export async function sugestao(agendamentoId: string, dono?: string) {
  const a = await prisma.agendamento.findFirst({
    where: { id: agendamentoId, ...(dono && { funcionarioId: dono }) },
    select: { servico: { select: { fichaTecnica: { include: { produto: { select: { id: true, nome: true, unidade: true, estoqueAtual: true, deletedAt: true } } } } } } },
  });
  if (!a) throw new AppError('NAO_ENCONTRADO', 'Agendamento não encontrado', 404);
  return a.servico.fichaTecnica
    .filter((i) => !i.produto.deletedAt)
    .map((i) => ({ produtoId: i.produtoId, nome: i.produto.nome, unidade: i.produto.unidade, quantidade: Number(i.quantidade), estoqueAtual: Number(i.produto.estoqueAtual) }));
}

export async function baixarConsumo(
  tx: Prisma.TransactionClient,
  agendamentoId: string,
  usuarioId: string,
  informado?: z.infer<typeof consumoSchema>,
) {
  const a = await tx.agendamento.findUniqueOrThrow({
    where: { id: agendamentoId },
    select: { servico: { select: { fichaTecnica: true, custosExtras: true } } },
  });
  const itens = informado ?? a.servico.fichaTecnica.map((i) => ({ produtoId: i.produtoId, quantidade: Number(i.quantidade) }));

  if (informado?.length) {
    const ids = informado.map((i) => i.produtoId);
    const existem = await tx.produto.count({ where: { id: { in: ids }, deletedAt: null } });
    if (existem !== ids.length) throw new AppError('PRODUTO_INVALIDO', 'Algum produto informado não existe', 400);
  }

  let custo = D(0);
  const cruzaram: string[] = [];
  // Ordem fixa de trava (por id) evita deadlock entre dois fechamentos simultâneos
  for (const item of [...itens].sort((x, y) => x.produtoId.localeCompare(y.produtoId))) {
    if (item.quantidade <= 0) continue;
    const r = await lancar(tx, {
      produtoId: item.produtoId,
      tipo: 'CONSUMO',
      delta: D(item.quantidade).neg(),
      usuarioId,
      agendamentoId,
      motivo: informado ? 'Atendimento concluído (quantidade ajustada)' : 'Atendimento concluído',
      // Não trava o fechamento por causa de saldo errado no sistema; o alerta avisa
      permitirNegativo: true,
    });
    custo = custo.plus(r.custoUnitario.mul(item.quantidade));
    if (r.cruzouMinimo) cruzaram.push(item.produtoId);
  }
  const extras = a.servico.custosExtras.reduce((t, e) => t + e.valorCentavos, 0);
  const custoCentavos = Math.round(custo.toNumber()) + extras;
  await tx.agendamento.update({ where: { id: agendamentoId }, data: { custoCentavos } });
  return { custoCentavos, cruzaram };
}
