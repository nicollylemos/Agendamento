import type { Request, Response } from 'express';
import { idParamSchema } from '../../lib/zod.js';
import * as service from './funcionarios.service.js';
import { criarFuncionarioSchema, darAcessoSchema, editarFuncionarioSchema } from './funcionarios.schemas.js';

export async function listar(_req: Request, res: Response) {
  res.json(await service.listar());
}

export async function criar(req: Request, res: Response) {
  res.status(201).json(await service.criar(req, criarFuncionarioSchema.parse(req.body)));
}

export async function editar(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await service.editar(req, id, editarFuncionarioSchema.parse(req.body)));
}

export async function darAcesso(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.status(201).json(await service.darAcesso(req, id, darAcessoSchema.parse(req.body)));
}
