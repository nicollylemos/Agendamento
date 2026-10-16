import { z } from 'zod';
import { centavos, idSchema, textoOpcional } from '../../lib/zod.js';

// RF43
export const programaSchema = z.object({
  ativo: z.boolean(),
  tipo: z.enum(['PONTOS', 'SELOS']),
  pontosPorReal: z.number().int().min(0).max(100),
  pontosPorAtendimento: z.number().int().min(0).max(10_000),
  servicosElegiveis: z.array(idSchema).max(200), // vazio = todos
  validadeDias: z.number().int().min(30).max(3650).nullable(), // null = não expira
});

// RF44
const camposRecompensa = {
  nome: z.string().trim().min(2).max(80),
  descricao: textoOpcional(300),
  tipo: z.enum(['DESCONTO', 'SERVICO', 'PRODUTO']),
  custoPontos: z.number().int().min(1).max(1_000_000),
  valorCentavos: centavos.nullable().optional(),
  servicoId: idSchema.nullable().optional(),
  validadeDias: z.number().int().min(1).max(365),
  ativo: z.boolean().optional(),
};
const coerente = (r: { tipo?: string; valorCentavos?: number | null; servicoId?: string | null }) =>
  (r.tipo !== 'DESCONTO' || Boolean(r.valorCentavos)) && (r.tipo !== 'SERVICO' || Boolean(r.servicoId));
const msg = { message: 'Desconto precisa de valor; serviço grátis precisa do serviço', path: ['tipo'] };

export const recompensaSchema = z.object(camposRecompensa).refine(coerente, msg);

// RF46: ajuste manual sempre com justificativa
export const ajusteSchema = z.object({
  pontos: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, 'Informe quantos pontos somar ou tirar'),
  motivo: z.string().trim().min(5, 'Explique o motivo (mínimo 5 letras)').max(200),
});

export const resgatarSchema = z.object({ recompensaId: idSchema });
export const buscaClientesQuery = z.object({ busca: z.string().trim().max(60).optional() });
