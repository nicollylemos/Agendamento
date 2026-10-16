import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/AppError.js';
import { logger } from '../lib/logger.js';

// Nunca devolve stack trace nem mensagem interna para o cliente.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Dados inválidos', issues: err.flatten().fieldErrors });
    return;
  }
  // Erros do leitor de corpo (express.json/raw): corpo grande demais ou JSON quebrado
  const tipo = (err as { type?: string }).type;
  if (tipo === 'entity.too.large') {
    res.status(413).json({ code: 'MUITO_GRANDE', message: 'Arquivo ou envio grande demais' });
    return;
  }
  if (tipo === 'entity.parse.failed' || tipo === 'encoding.unsupported') {
    res.status(400).json({ code: 'CORPO_INVALIDO', message: 'Dados inválidos' });
    return;
  }
  logger.error({ err }, 'Erro não tratado');
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Erro interno' });
};
