import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { validateBody } from '../../middlewares/validate.js';
import { gestaoLimiter } from '../../middlewares/rateLimit.js';
import { idParamSchema } from '../../lib/zod.js';
import { emailDoToken } from '../clientes/clientes.service.js';
import * as f from './fidelidade.service.js';
import { ajusteSchema, buscaClientesQuery, programaSchema, recompensaSchema, resgatarSchema } from './fidelidade.schemas.js';

// ─── Painel (admin): RF43, RF44, RF46 ────────────────────

export const fidelidadeAdminRoutes = Router();
fidelidadeAdminRoutes.use(authenticate, requirePermission('fidelidade:gerenciar'));

fidelidadeAdminRoutes.get('/programa', async (_req, res) => {
  res.json(await f.obterPrograma());
});
fidelidadeAdminRoutes.put('/programa', validateBody(programaSchema), async (req, res) => {
  res.json(await f.salvarPrograma(req, req.body));
});

fidelidadeAdminRoutes.get('/recompensas', async (req, res) => {
  res.json(await f.listarRecompensas(req.query.incluirInativas === 'true'));
});
fidelidadeAdminRoutes.post('/recompensas', validateBody(recompensaSchema), async (req, res) => {
  res.status(201).json(await f.salvarRecompensa(req, null, req.body));
});
fidelidadeAdminRoutes.put('/recompensas/:id', validateBody(recompensaSchema), async (req, res) => {
  res.json(await f.salvarRecompensa(req, idParamSchema.parse(req.params).id, req.body));
});
fidelidadeAdminRoutes.delete('/recompensas/:id', async (req, res) => {
  await f.removerRecompensa(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});

fidelidadeAdminRoutes.get('/clientes', async (req, res) => {
  res.json(await f.buscarClientes(buscaClientesQuery.parse(req.query).busca));
});
fidelidadeAdminRoutes.get('/clientes/:id', async (req, res) => {
  res.json(await f.resumoCliente(idParamSchema.parse(req.params).id));
});
// RF46: ajuste com justificativa (vai para a auditoria)
fidelidadeAdminRoutes.post('/clientes/:id/ajuste', validateBody(ajusteSchema), async (req, res) => {
  res.json(await f.ajustar(req, idParamSchema.parse(req.params).id, req.body));
});
fidelidadeAdminRoutes.post('/clientes/:id/resgates', validateBody(resgatarSchema), async (req, res) => {
  res.status(201).json(await f.resgatar(idParamSchema.parse(req.params).id, req.body.recompensaId, req.usuario!.id));
});

fidelidadeAdminRoutes.get('/vouchers/:codigo', async (req, res) => {
  const { codigo } = z.object({ codigo: z.string().trim().min(4).max(20) }).parse(req.params);
  res.json(await f.buscarVoucher(codigo));
});
fidelidadeAdminRoutes.post('/vouchers/:id/usar', async (req, res) => {
  await f.usarVoucher(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});
fidelidadeAdminRoutes.post('/vouchers/:id/cancelar', async (req, res) => {
  await f.cancelarVoucher(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});

// ─── Cliente pelo site (RF46), com a sessão do código por e-mail ──

export const fidelidadePublicaRoutes = Router();
fidelidadePublicaRoutes.get('/clientes/fidelidade', gestaoLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await f.fidelidadeDoEmail(await emailDoToken(req.get('authorization'))));
});
fidelidadePublicaRoutes.post('/clientes/fidelidade/resgatar', gestaoLimiter, validateBody(resgatarSchema), async (req, res) => {
  const email = await emailDoToken(req.get('authorization'));
  res.status(201).json(await f.resgatarPorEmail(email, req.body.recompensaId));
});
// Regras do programa (para mostrar no site)
fidelidadePublicaRoutes.get('/fidelidade', async (_req, res) => {
  res.json({ programa: await f.programaPublico(), recompensas: (await f.programaPublico()) ? await f.listarRecompensas(false) : [] });
});
