import type { RequestHandler } from 'express';
import { AppError } from '../lib/AppError.js';
import { temPermissao, type Permissao } from '../modules/auth/permissoes.js';

// Seção 9.2: negar por padrão. Use sempre depois do authenticate.
export const requirePermission =
  (permissao: Permissao): RequestHandler =>
  (req, _res, next) => {
    if (!req.usuario) throw new AppError('NAO_AUTENTICADO', 'Faça login para continuar', 401);
    if (!temPermissao(req.usuario.perfil, permissao)) {
      throw new AppError('SEM_PERMISSAO', 'Você não tem permissão para isso', 403);
    }
    next();
  };
