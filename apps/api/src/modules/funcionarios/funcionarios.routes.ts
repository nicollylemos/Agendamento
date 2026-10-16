import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import * as c from './funcionarios.controller.js';

export const funcionariosRoutes = Router();
funcionariosRoutes.use(authenticate, requirePermission('equipe:gerenciar'));
funcionariosRoutes.get('/', c.listar);
funcionariosRoutes.post('/', c.criar);
funcionariosRoutes.patch('/:id', c.editar);
funcionariosRoutes.post('/:id/acesso', c.darAcesso); // RF02: link de acesso ao painel (opcional)
