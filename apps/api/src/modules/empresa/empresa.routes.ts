import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import * as c from './empresa.controller.js';

// RF06
export const empresaRoutes = Router();
empresaRoutes.use(authenticate, requirePermission('empresa:gerenciar'));
empresaRoutes.get('/', c.obter);
empresaRoutes.put('/', c.salvar);
