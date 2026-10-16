import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { requireReauth } from '../../middlewares/requireReauth.js';
import * as c from './usuarios.controller.js';

export const usuariosRoutes = Router();

// Seção 9.2: tudo aqui exige login + permissão
usuariosRoutes.use(authenticate, requirePermission('usuarios:gerenciar'));

usuariosRoutes.get('/', c.listar);
usuariosRoutes.post('/convites', c.convidar); // RF02
usuariosRoutes.patch('/:id/status', c.alterarStatus); // RF05
usuariosRoutes.patch('/:id/perfil', requireReauth, c.alterarPerfil); // 9.2 + reautenticação
