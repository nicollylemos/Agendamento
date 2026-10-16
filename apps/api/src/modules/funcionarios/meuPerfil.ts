import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';

// 9.2: nas rotas /staff o funcionário é sempre o do login, nunca um id vindo da requisição
export async function meuPerfil(req: Request) {
  const f = await prisma.funcionario.findUnique({ where: { usuarioId: req.usuario!.id } });
  if (!f) throw new AppError('SEM_PERFIL_ATENDIMENTO', 'Você não tem perfil de atendimento', 404);
  return f;
}
