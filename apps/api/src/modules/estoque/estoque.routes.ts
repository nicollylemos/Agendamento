import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { validateBody } from '../../middlewares/validate.js';
import { idParamSchema } from '../../lib/zod.js';
import * as estoque from './estoque.service.js';
import { criarProdutoSchema, editarProdutoSchema, listarProdutosQuery, movimentoSchema } from './estoque.schemas.js';

// Fase 7: estoque (RF38–RF42). Admin e gerente (seção 1: gerente cuida do estoque).

export const estoqueRoutes = Router();
estoqueRoutes.use(authenticate);

// RF38
estoqueRoutes.get('/produtos', requirePermission('estoque:ver'), async (req, res) => {
  res.json(await estoque.listar(listarProdutosQuery.parse(req.query)));
});
estoqueRoutes.post('/produtos', requirePermission('estoque:editar'), validateBody(criarProdutoSchema), async (req, res) => {
  res.status(201).json(await estoque.criar(req, req.body));
});
estoqueRoutes.patch('/produtos/:id', requirePermission('estoque:editar'), validateBody(editarProdutoSchema), async (req, res) => {
  res.json(await estoque.editar(req, idParamSchema.parse(req.params).id, req.body));
});
estoqueRoutes.delete('/produtos/:id', requirePermission('estoque:editar'), async (req, res) => {
  await estoque.remover(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});

// RF39
estoqueRoutes.get('/produtos/:id/movimentos', requirePermission('estoque:ver'), async (req, res) => {
  res.json(await estoque.historico(idParamSchema.parse(req.params).id));
});
estoqueRoutes.post('/movimentos', requirePermission('estoque:editar'), validateBody(movimentoSchema), async (req, res) => {
  res.status(201).json(await estoque.movimentar(req, req.body));
});

// RF41
estoqueRoutes.get('/alertas', requirePermission('estoque:ver'), async (_req, res) => {
  res.json(await estoque.resumoAlertas());
});
