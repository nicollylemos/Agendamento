import express, { Router, type RequestHandler } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { uploadLimiter } from '../../middlewares/rateLimit.js';
import { CHAVE_VALIDA, pastaLocal } from '../../lib/armazenamento.js';
import { env } from '../../config/env.js';
import type { Permissao } from '../auth/permissoes.js';
import { enviar, TAMANHO_MAXIMO } from './arquivos.service.js';

const FINALIDADES = ['LOGO', 'BANNER', 'SERVICO', 'EQUIPE', 'GALERIA', 'POST'] as const;
type Finalidade = (typeof FINALIDADES)[number];

// Quem pode enviar cada tipo de imagem (9.2)
const PERMISSAO: Record<Finalidade, Permissao> = {
  LOGO: 'empresa:gerenciar',
  BANNER: 'empresa:gerenciar',
  GALERIA: 'empresa:gerenciar',
  SERVICO: 'servicos:gerenciar',
  EQUIPE: 'equipe:gerenciar',
  POST: 'marketing:gerenciar',
};

const porFinalidade: RequestHandler = (req, res, next) => {
  const { finalidade } = z.object({ finalidade: z.enum(FINALIDADES) }).parse(req.query);
  return requirePermission(PERMISSAO[finalidade])(req, res, next);
};

// RF07, RF09, RF12: o corpo é a própria imagem (sem multipart), no máximo 5 MB
export const arquivosAdminRoutes = Router();
arquivosAdminRoutes.post(
  '/',
  authenticate,
  porFinalidade,
  uploadLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: TAMANHO_MAXIMO }),
  async (req, res) => {
    const { finalidade } = z.object({ finalidade: z.enum(FINALIDADES) }).parse(req.query);
    res.status(201).json(await enviar(req, finalidade, req.body));
  },
);

// Desenvolvimento (ARMAZENAMENTO=local): a API serve as imagens. Em produção vêm do S3/CDN.
export const arquivosPublicosRoutes = Router();
if (env.ARMAZENAMENTO === 'local') {
  arquivosPublicosRoutes.get('/:chave', (req, res) => {
    const { chave } = req.params;
    if (!CHAVE_VALIDA.test(chave)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Arquivo não encontrado' });
      return;
    }
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    res.sendFile(path.join(pastaLocal, chave), (err) => {
      if (err && !res.headersSent) res.status(404).json({ code: 'NOT_FOUND', message: 'Arquivo não encontrado' });
    });
  });
}
