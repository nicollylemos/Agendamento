import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/audit.js';

// RF22 (antecedência), RF25 (prazos do cliente) e o passo da agenda
export const configAgendaSchema = z.object({
  antecedenciaMinimaMin: z.number().int().min(0).max(7 * 24 * 60),
  diasAFrente: z.number().int().min(1).max(365),
  passoMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  prazoCancelamentoHoras: z.number().int().min(0).max(168),
  prazoReagendamentoHoras: z.number().int().min(0).max(168),
});

export type ConfigAgenda = z.infer<typeof configAgendaSchema>;

export async function obterConfigAgenda(): Promise<ConfigAgenda> {
  const c = await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  return {
    antecedenciaMinimaMin: c.antecedenciaMinimaMin,
    diasAFrente: c.diasAFrente,
    passoMin: c.passoMin as ConfigAgenda['passoMin'],
    prazoCancelamentoHoras: c.prazoCancelamentoHoras,
    prazoReagendamentoHoras: c.prazoReagendamentoHoras,
  };
}

export async function salvarConfigAgenda(req: Request, dados: ConfigAgenda) {
  await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
  await auditar('CONFIG_AGENDA_ALTERADA', req, { usuarioId: req.usuario!.id, detalhes: dados });
  return obterConfigAgenda();
}

// ─── Visual da agenda ────────────────────────────────────
// Cada situação do agendamento tem uma cor (o admin pode trocar). A cor nunca é a única
// pista: a tela sempre escreve a situação junto.

export const SITUACOES = ['AGUARDANDO', 'SINAL_PAGO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'FALTA', 'CANCELADO'] as const;
export type Situacao = (typeof SITUACOES)[number];

export const CORES_PADRAO: Record<Situacao, string> = {
  AGUARDANDO: '#d9a21b',
  SINAL_PAGO: '#2f9e6e',
  CONFIRMADO: '#4a6fb0',
  EM_ATENDIMENTO: '#7c5cc4',
  CONCLUIDO: '#8f928f',
  FALTA: '#d0453f',
  CANCELADO: '#c9c8c3',
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB').transform((v) => v.toLowerCase());
export const coresSchema = z.object(Object.fromEntries(SITUACOES.map((s) => [s, hex])) as Record<Situacao, typeof hex>);
export const metaSchema = z.object({ metaMensalCentavos: z.number().int().min(100).max(100_000_000).nullable() });

function lerCores(json: unknown): Record<Situacao, string> {
  const r = coresSchema.partial().safeParse(json ?? {});
  return { ...CORES_PADRAO, ...(r.success ? r.data : {}) };
}

export async function obterVisual() {
  const c = await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  return { cores: lerCores(c.coresAgenda), coresPadrao: CORES_PADRAO, metaMensalCentavos: c.metaMensalCentavos };
}

export async function salvarCores(req: Request, cores: Record<Situacao, string>) {
  await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1, coresAgenda: cores }, update: { coresAgenda: cores } });
  await auditar('CONFIG_AGENDA_ALTERADA', req, { usuarioId: req.usuario!.id, detalhes: { cores } });
  return obterVisual();
}

export async function salvarMeta(req: Request, metaMensalCentavos: number | null) {
  await prisma.configAgenda.upsert({ where: { id: 1 }, create: { id: 1, metaMensalCentavos }, update: { metaMensalCentavos } });
  await auditar('CONFIG_AGENDA_ALTERADA', req, { usuarioId: req.usuario!.id, detalhes: { metaMensalCentavos } });
  return obterVisual();
}
