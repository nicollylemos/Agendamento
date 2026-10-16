import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { validateBody } from '../../middlewares/validate.js';
import * as p from './personalizacao.service.js';
import { personalizacaoSchema } from './personalizacao.schemas.js';

// RF07, RF08, RF10
export const personalizacaoAdminRoutes = Router();
personalizacaoAdminRoutes.use(authenticate, requirePermission('empresa:gerenciar'));
personalizacaoAdminRoutes.get('/', async (_req, res) => {
  res.json(await p.obter());
});
personalizacaoAdminRoutes.put('/rascunho', validateBody(personalizacaoSchema), async (req, res) => {
  res.json(await p.salvarRascunho(req, req.body));
});
personalizacaoAdminRoutes.post('/publicar', async (req, res) => {
  res.json(await p.publicar(req));
});
personalizacaoAdminRoutes.post('/descartar', async (_req, res) => {
  res.json(await p.descartarRascunho());
});
