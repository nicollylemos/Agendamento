import type { Request, RequestHandler } from 'express';
import type { Perfil } from '@prisma/client';
import { verificar } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/AppError.js';

export interface UsuarioAutenticado {
  id: string;
  perfil: Perfil;
  familiaId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

// Seção 9.1/9.2: valida o access token E confere no banco se a sessão
// continua viva e o usuário continua ativo. Assim, desativar um funcionário
// (RF05) ou fazer logout derruba o acesso na hora, sem esperar o token vencer.
export async function autenticarRequisicao(req: Request): Promise<UsuarioAutenticado> {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new AppError('NAO_AUTENTICADO', 'Faça login para continuar', 401);

  let payload;
  try {
    payload = await verificar<{ fam: string }>('access', token);
  } catch {
    throw new AppError('TOKEN_INVALIDO', 'Sessão expirada, faça login novamente', 401);
  }

  const sessao = await prisma.sessao.findFirst({
    where: { familiaId: payload.fam, usuarioId: payload.sub, revogadaEm: null, expiraEm: { gt: new Date() } },
    select: { usuario: { select: { id: true, perfil: true, ativo: true } } },
  });

  if (!sessao || !sessao.usuario.ativo) {
    throw new AppError('SESSAO_ENCERRADA', 'Sessão encerrada, faça login novamente', 401);
  }

  // O perfil vem do banco, não do token: mudar o perfil vale na próxima requisição.
  return { id: sessao.usuario.id, perfil: sessao.usuario.perfil, familiaId: payload.fam };
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  req.usuario = await autenticarRequisicao(req);
  next();
};
