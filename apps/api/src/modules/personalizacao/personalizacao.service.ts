import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { PADRAO, personalizacaoSchema, type Personalizacao } from './personalizacao.schemas.js';

// RF07, RF08, RF10: rascunho → prévia → publicar.
// O que vem do banco é validado de novo antes de usar: se o schema mudar, nada quebrado chega ao site.

// Se uma parte não passar na validação (ex.: o schema mudou), só ela volta ao padrão;
// o resto do que o admin publicou continua valendo. Antes, um campo inválido derrubava tudo.
function ler(json: Prisma.JsonValue | null | undefined): Personalizacao | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const r = personalizacaoSchema.safeParse(json);
  if (r.success) return r.data;
  const bruto = json as Record<string, unknown>;
  const forma = personalizacaoSchema.shape;
  const saida = { ...PADRAO } as Record<string, unknown>;
  const invalidos: string[] = [];
  for (const chave of Object.keys(forma) as (keyof typeof forma)[]) {
    const parte = forma[chave].safeParse(bruto[chave]);
    if (parte.success) saida[chave] = parte.data;
    else invalidos.push(chave);
  }
  logger.warn({ invalidos }, 'Personalização com partes inválidas: essas partes voltaram ao padrão');
  return saida as Personalizacao;
}

export async function obter() {
  const p = await prisma.personalizacao.findUnique({ where: { id: 1 } });
  const rascunho = ler(p?.rascunho) ?? ler(p?.publicado) ?? PADRAO;
  const publicado = ler(p?.publicado);
  return {
    rascunho,
    publicado,
    publicadoEm: p?.publicadoEm?.toISOString() ?? null,
    temAlteracoes: JSON.stringify(rascunho) !== JSON.stringify(publicado ?? PADRAO),
  };
}

export async function salvarRascunho(req: Request, dados: Personalizacao) {
  const json = dados as unknown as Prisma.InputJsonValue;
  await prisma.personalizacao.upsert({ where: { id: 1 }, create: { id: 1, rascunho: json }, update: { rascunho: json } });
  await auditar('PERSONALIZACAO_SALVA', req, { usuarioId: req.usuario!.id, entidade: 'Personalizacao' });
  return obter();
}

// RF08: só o que foi revisado na prévia vai para o ar
export async function publicar(req: Request) {
  const p = await prisma.personalizacao.findUnique({ where: { id: 1 } });
  const rascunho = ler(p?.rascunho);
  if (!rascunho) throw new AppError('SEM_RASCUNHO', 'Salve as alterações antes de publicar', 409);
  await prisma.personalizacao.update({
    where: { id: 1 },
    data: { publicado: rascunho as unknown as Prisma.InputJsonValue, publicadoEm: new Date(), publicadoPor: req.usuario!.id },
  });
  await auditar('PERSONALIZACAO_PUBLICADA', req, { usuarioId: req.usuario!.id, entidade: 'Personalizacao' });
  return obter();
}

export async function descartarRascunho() {
  const p = await prisma.personalizacao.findUnique({ where: { id: 1 } });
  if (p) await prisma.personalizacao.update({ where: { id: 1 }, data: { rascunho: p.publicado ?? (PADRAO as unknown as Prisma.InputJsonValue) } });
  return obter();
}

// Para o site: só o publicado (o rascunho nunca vaza)
export async function publicada(): Promise<Personalizacao> {
  const p = await prisma.personalizacao.findUnique({ where: { id: 1 }, select: { publicado: true } });
  return ler(p?.publicado) ?? PADRAO;
}

// RF07: confere as respostas dos campos extras contra o que está publicado
export async function validarRespostasExtras(respostas: Record<string, string | boolean> | undefined) {
  const { camposExtras } = await publicada();
  const saida: { rotulo: string; resposta: string }[] = [];
  for (const campo of camposExtras) {
    const v = respostas?.[campo.id];
    const vazio = v === undefined || v === null || (typeof v === 'string' && !v.trim());
    if (vazio) {
      if (campo.obrigatorio && campo.tipo === 'TEXTO') throw new AppError('VALIDACAO', `Responda: ${campo.rotulo}`, 400);
      if (campo.tipo === 'SIM_NAO') saida.push({ rotulo: campo.rotulo, resposta: 'Não' });
      continue;
    }
    if (campo.tipo === 'SIM_NAO') {
      if (typeof v !== 'boolean') throw new AppError('VALIDACAO', `Resposta inválida: ${campo.rotulo}`, 400);
      if (campo.obrigatorio && !v) throw new AppError('VALIDACAO', `É preciso marcar: ${campo.rotulo}`, 400);
      saida.push({ rotulo: campo.rotulo, resposta: v ? 'Sim' : 'Não' });
    } else {
      if (typeof v !== 'string') throw new AppError('VALIDACAO', `Resposta inválida: ${campo.rotulo}`, 400);
      saida.push({ rotulo: campo.rotulo, resposta: v.replace(/<[^>]*>/g, '').trim().slice(0, 300) });
    }
  }
  // Perguntas que não existem são ignoradas (não guarda nada que não pedimos, 9.6)
  return saida.length ? saida : null;
}
