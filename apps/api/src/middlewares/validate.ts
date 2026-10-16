import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

// Valida o body com Zod e troca req.body pela versão limpa (só os campos do schema).
// Isso já bloqueia mass assignment: campo que não está no schema é descartado.
export const validateBody =
  (schema: ZodSchema): RequestHandler =>
  (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
