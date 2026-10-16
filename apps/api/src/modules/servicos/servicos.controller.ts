import type { Request, Response } from 'express';
import { idParamSchema } from '../../lib/zod.js';
import * as service from './servicos.service.js';
import * as s from './servicos.schemas.js';

export async function listar(req: Request, res: Response) {
  const { incluirInativos } = s.listarServicosQuery.parse(req.query);
  res.json(await service.listar(incluirInativos));
}

export async function obter(req: Request, res: Response) {
  res.json(await service.obter(idParamSchema.parse(req.params).id));
}

export async function criar(req: Request, res: Response) {
  res.status(201).json(await service.criar(req, s.criarServicoSchema.parse(req.body)));
}

export async function editar(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await service.editar(req, id, s.editarServicoSchema.parse(req.body)));
}

export async function remover(req: Request, res: Response) {
  await service.remover(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
}

export async function definirEquipe(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await service.definirEquipe(req, id, s.definirEquipeSchema.parse(req.body)));
}

export async function listarCategorias(_req: Request, res: Response) {
  res.json(await service.listarCategorias());
}

export async function criarCategoria(req: Request, res: Response) {
  res.status(201).json(await service.criarCategoria(s.categoriaSchema.parse(req.body)));
}

export async function editarCategoria(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await service.editarCategoria(id, s.editarCategoriaSchema.parse(req.body)));
}

export async function removerCategoria(req: Request, res: Response) {
  await service.removerCategoria(idParamSchema.parse(req.params).id);
  res.status(204).end();
}
