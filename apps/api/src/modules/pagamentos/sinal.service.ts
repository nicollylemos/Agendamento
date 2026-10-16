import type { Request } from 'express';
import type { ConfigAgenda as ConfigAgendaDb, Servico } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/audit.js';

// RF28: regra do sinal. Padrão da empresa + personalização por serviço.
// 9.3: o valor é sempre calculado aqui, a partir do preço salvo; o front nunca manda preço.

export const PRAZO_MIN = 5;
export const PRAZO_MAX = 24 * 60;

const regra = {
  sinalTipo: z.enum(['FIXO', 'PERCENTUAL']),
  // FIXO: centavos. PERCENTUAL: centésimos de % (3000 = 30%), de 1% a 100%.
  sinalValor: z.number().int().min(1).max(100_000_000),
  sinalPrazoMin: z.number().int().min(PRAZO_MIN).max(PRAZO_MAX),
};

const percentualValido = (d: { sinalTipo?: string | null; sinalValor?: number | null }) =>
  d.sinalTipo !== 'PERCENTUAL' || d.sinalValor == null || (d.sinalValor >= 100 && d.sinalValor <= 10_000);
const msgPercentual = { message: 'Percentual entre 1% e 100%', path: ['sinalValor'] };

export const configSinalSchema = z
  .object({
    sinalExige: z.boolean(),
    ...regra,
    reembolsoAteHoras: z.number().int().min(0).max(720), // RF32
    reembolsoAutomaticoAposExpirar: z.boolean(), // fluxo 6.2
  })
  .refine(percentualValido, msgPercentual);

export const sinalServicoSchema = z
  .object({
    sinalModo: z.enum(['HERDAR', 'EXIGIR', 'NAO_EXIGIR']),
    sinalTipo: regra.sinalTipo.nullable().optional(),
    sinalValor: regra.sinalValor.nullable().optional(),
    sinalPrazoMin: regra.sinalPrazoMin.nullable().optional(),
  })
  .refine(percentualValido, msgPercentual);

export type ConfigSinal = z.infer<typeof configSinalSchema>;

function deDb(c: ConfigAgendaDb): ConfigSinal {
  return {
    sinalExige: c.sinalExige,
    sinalTipo: c.sinalTipo,
    sinalValor: c.sinalValor,
    sinalPrazoMin: c.sinalPrazoMin,
    reembolsoAteHoras: c.reembolsoAteHoras,
    reembolsoAutomaticoAposExpirar: c.reembolsoAutomaticoAposExpirar,
  };
}

export async function obterConfigSinal(): Promise<ConfigSinal> {
  return deDb(await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }));
}

export async function salvarConfigSinal(req: Request, dados: ConfigSinal) {
  const c = await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
  await auditar('CONFIG_SINAL_ALTERADA', req, { usuarioId: req.usuario!.id, entidade: 'ConfigSinal', detalhes: dados });
  return deDb(c);
}

type ServicoSinal = Pick<Servico, 'sinalModo' | 'sinalTipo' | 'sinalValor' | 'sinalPrazoMin'>;

// Quanto cobrar de sinal e em quanto tempo. 0 = não exige.
export function calcularSinal(valorCentavos: number, servico: ServicoSinal, config: ConfigSinal) {
  const exige = servico.sinalModo === 'EXIGIR' || (servico.sinalModo === 'HERDAR' && config.sinalExige);
  if (!exige || valorCentavos <= 0) return { sinalCentavos: 0, prazoMin: 0 };

  const proprio = servico.sinalModo === 'EXIGIR' && servico.sinalTipo && servico.sinalValor;
  const tipo = proprio ? servico.sinalTipo! : config.sinalTipo;
  const valor = proprio ? servico.sinalValor! : config.sinalValor;
  const prazoMin = (servico.sinalModo === 'EXIGIR' && servico.sinalPrazoMin) || config.sinalPrazoMin;

  const bruto = tipo === 'FIXO' ? valor : Math.round((valorCentavos * valor) / 10_000);
  // Nunca mais que o próprio serviço; Pix abaixo de R$ 1 não compensa
  const sinalCentavos = Math.min(valorCentavos, Math.max(bruto, 100));
  return { sinalCentavos, prazoMin };
}
