import type { Request } from 'express';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import type { sinalServicoSchema } from './sinal.service.js';

// RF28: sinal próprio do serviço (ou herdar o padrão da empresa)
export async function salvarSinalServico(req: Request, id: string, dados: z.infer<typeof sinalServicoSchema>) {
  const s = await prisma.servico.findFirst({ where: { id, deletedAt: null } });
  if (!s) throw new AppError('NAO_ENCONTRADO', 'Serviço não encontrado', 404);
  if (dados.sinalModo === 'EXIGIR' && (!dados.sinalTipo || !dados.sinalValor)) {
    // Exigir sem valor próprio = usa tipo e valor do padrão, só força a cobrança
    dados = { ...dados, sinalTipo: null, sinalValor: null };
  }
  const proprio = dados.sinalModo === 'EXIGIR';
  const atualizado = await prisma.servico.update({
    where: { id },
    data: {
      sinalModo: dados.sinalModo,
      sinalTipo: proprio ? (dados.sinalTipo ?? null) : null,
      sinalValor: proprio ? (dados.sinalValor ?? null) : null,
      sinalPrazoMin: proprio ? (dados.sinalPrazoMin ?? null) : null,
    },
    select: { id: true, sinalModo: true, sinalTipo: true, sinalValor: true, sinalPrazoMin: true },
  });
  await auditar('CONFIG_SINAL_ALTERADA', req, { usuarioId: req.usuario!.id, entidade: 'Servico', entidadeId: id, detalhes: { ...dados } });
  return atualizado;
}
