import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import * as c from './servicos.controller.js';
import { requireReauth } from '../../middlewares/requireReauth.js';
import { validateBody } from '../../middlewares/validate.js';
import { idParamSchema } from '../../lib/zod.js';
import { sinalServicoSchema } from '../pagamentos/sinal.service.js';
import { salvarSinalServico } from '../pagamentos/sinalServico.js';
import { fichaSchema } from '../estoque/estoque.schemas.js';
import { ordemServicosSchema } from './servicos.schemas.js';
import { prisma } from '../../lib/prisma.js';
import { obterFicha, salvarFicha } from '../estoque/ficha.service.js';

export const servicosRoutes = Router();
servicosRoutes.use(authenticate, requirePermission('servicos:gerenciar'));

// Categorias antes de "/:id" para não confundir as rotas
servicosRoutes.get('/categorias', c.listarCategorias);
servicosRoutes.post('/categorias', c.criarCategoria);
servicosRoutes.patch('/categorias/:id', c.editarCategoria);
servicosRoutes.delete('/categorias/:id', c.removerCategoria);

// RF07: reordenar (antes de "/:id")
servicosRoutes.put('/ordem', validateBody(ordemServicosSchema), async (req, res) => {
  await prisma.$transaction(req.body.ids.map((id: string, ordem: number) => prisma.servico.updateMany({ where: { id, deletedAt: null }, data: { ordem } })));
  res.status(204).end();
});

// RF12
servicosRoutes.get('/', c.listar);
servicosRoutes.post('/', c.criar);
servicosRoutes.get('/:id', c.obter);
servicosRoutes.patch('/:id', c.editar);
servicosRoutes.delete('/:id', c.remover);

// RF13
servicosRoutes.put('/:id/equipe', c.definirEquipe);

// RF14, RF15: ficha técnica e custo/margem
servicosRoutes.get('/:id/ficha', async (req, res) => {
  res.json(await obterFicha(idParamSchema.parse(req.params).id));
});
servicosRoutes.put('/:id/ficha', validateBody(fichaSchema), async (req, res) => {
  res.json(await salvarFicha(req, idParamSchema.parse(req.params).id, req.body));
});

// RF28: sinal do serviço (mexe com dinheiro: pede senha de novo, 9.1)
servicosRoutes.put('/:id/sinal', requirePermission('sinal:gerenciar'), requireReauth, validateBody(sinalServicoSchema), async (req, res) => {
  res.json(await salvarSinalServico(req, idParamSchema.parse(req.params).id, req.body));
});
