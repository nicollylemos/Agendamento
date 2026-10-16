import type { Request, Response } from 'express';
import * as service from './usuarios.service.js';
import { alterarPerfilSchema, alterarStatusSchema, convidarSchema, idParamSchema } from './usuarios.schemas.js';

export async function listar(_req: Request, res: Response) {
  res.json(await service.listar());
}

export async function convidar(req: Request, res: Response) {
  res.status(201).json(await service.convidar(req, convidarSchema.parse(req.body)));
}

export async function alterarStatus(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { ativo } = alterarStatusSchema.parse(req.body);
  await service.alterarStatus(req, id, ativo);
  res.status(204).end();
}

export async function alterarPerfil(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { perfil } = alterarPerfilSchema.parse(req.body);
  await service.alterarPerfil(req, id, perfil);
  res.status(204).end();
}
