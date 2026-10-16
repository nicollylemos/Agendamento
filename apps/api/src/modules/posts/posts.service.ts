import type { Request } from 'express';
import type { Prisma, PostInstagram } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import type { editarPostSchema, postSchema } from './posts.schemas.js';

const MAXIMO = 500; // posts guardados (rascunhos antigos podem ser apagados)

const dataDb = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : iso === null ? null : undefined);

function formatar(p: PostInstagram) {
  return {
    id: p.id,
    titulo: p.titulo,
    modelo: p.modelo,
    formato: p.formato,
    conteudo: p.conteudo,
    legenda: p.legenda,
    status: p.status,
    agendadoPara: p.agendadoPara ? p.agendadoPara.toISOString().slice(0, 10) : null,
    atualizadoEm: p.updatedAt.toISOString(),
  };
}

export async function listar(status?: 'RASCUNHO' | 'PRONTO' | 'PUBLICADO') {
  const posts = await prisma.postInstagram.findMany({
    where: status ? { status } : {},
    orderBy: [{ agendadoPara: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: MAXIMO,
  });
  return posts.map(formatar);
}

export async function obter(id: string) {
  const p = await prisma.postInstagram.findUnique({ where: { id } });
  if (!p) throw new AppError('NAO_ENCONTRADO', 'Post não encontrado', 404);
  return formatar(p);
}

export async function criar(req: Request, dados: z.infer<typeof postSchema>) {
  if ((await prisma.postInstagram.count()) >= MAXIMO) {
    throw new AppError('LIMITE', `Você já tem ${MAXIMO} posts guardados. Apague alguns antigos para criar novos.`, 409);
  }
  const { agendadoPara, conteudo, ...resto } = dados;
  const p = await prisma.postInstagram.create({
    data: { ...resto, conteudo: conteudo as Prisma.InputJsonValue, agendadoPara: dataDb(agendadoPara), criadoPor: req.usuario!.id },
  });
  await auditar('POST_SALVO', req, { usuarioId: req.usuario!.id, entidade: 'PostInstagram', entidadeId: p.id });
  return formatar(p);
}

export async function editar(req: Request, id: string, dados: z.infer<typeof editarPostSchema>) {
  await obter(id);
  const { agendadoPara, conteudo, ...resto } = dados;
  const p = await prisma.postInstagram.update({
    where: { id },
    data: { ...resto, ...(conteudo && { conteudo: conteudo as Prisma.InputJsonValue }), agendadoPara: dataDb(agendadoPara) },
  });
  await auditar('POST_SALVO', req, { usuarioId: req.usuario!.id, entidade: 'PostInstagram', entidadeId: id });
  return formatar(p);
}

export async function remover(req: Request, id: string) {
  const { count } = await prisma.postInstagram.deleteMany({ where: { id } });
  if (!count) throw new AppError('NAO_ENCONTRADO', 'Post não encontrado', 404);
  await auditar('POST_REMOVIDO', req, { usuarioId: req.usuario!.id, entidade: 'PostInstagram', entidadeId: id });
}
