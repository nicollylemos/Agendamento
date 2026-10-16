import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { idParamSchema } from '../../lib/zod.js';
import * as posts from './posts.service.js';
import { editarPostSchema, listarPostsQuery, postSchema } from './posts.schemas.js';

// Posts para o Instagram: admin e gerente (permissão marketing:gerenciar)
export const postsRoutes = Router();
postsRoutes.use(authenticate, requirePermission('marketing:gerenciar'));

postsRoutes.get('/', async (req, res) => {
  res.json(await posts.listar(listarPostsQuery.parse(req.query).status));
});
postsRoutes.get('/:id', async (req, res) => {
  res.json(await posts.obter(idParamSchema.parse(req.params).id));
});
postsRoutes.post('/', async (req, res) => {
  res.status(201).json(await posts.criar(req, postSchema.parse(req.body)));
});
postsRoutes.patch('/:id', async (req, res) => {
  res.json(await posts.editar(req, idParamSchema.parse(req.params).id, editarPostSchema.parse(req.body)));
});
postsRoutes.delete('/:id', async (req, res) => {
  await posts.remover(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});
