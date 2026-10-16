import type { Request, Response } from 'express';
import { AppError } from '../../lib/AppError.js';
import * as service from './empresa.service.js';
import { empresaSchema } from './empresa.schemas.js';

export async function obter(_req: Request, res: Response) {
  const empresa = await service.obter();
  if (!empresa) throw new AppError('NAO_CONFIGURADA', 'Dados da empresa ainda não foram cadastrados', 404);
  res.json(empresa);
}

export async function salvar(req: Request, res: Response) {
  res.json(await service.salvar(req, empresaSchema.parse(req.body)));
}
