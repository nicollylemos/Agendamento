import type { RequestHandler } from 'express';
import { AppError } from '../lib/AppError.js';

// Seção 9.4: rotas que usam o cookie de refresh exigem um header customizado.
// Um site malicioso não consegue mandar esse header numa requisição entre sites.
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.get('x-requested-with') !== 'agendamento') {
    throw new AppError('CSRF', 'Requisição recusada', 403);
  }
  next();
};
