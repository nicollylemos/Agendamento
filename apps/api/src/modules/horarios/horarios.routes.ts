import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { AppError } from '../../lib/AppError.js';
import { idParamSchema, idSchema } from '../../lib/zod.js';
import { meuPerfil } from '../funcionarios/meuPerfil.js';
import * as service from './horarios.service.js';
import * as s from './horarios.schemas.js';

// ─── Admin e gerente ─────────────────────────────────────

export const horariosAdminRoutes = Router();
horariosAdminRoutes.use(authenticate, requirePermission('horarios:gerenciar'));

// RF16
horariosAdminRoutes.get('/modelos', async (_req, res) => {
  res.json(await service.listarModelos());
});
horariosAdminRoutes.post('/modelos', async (req, res) => {
  res.status(201).json(await service.criarModelo(req, s.modeloSchema.parse(req.body)));
});
horariosAdminRoutes.patch('/modelos/:id', async (req, res) => {
  await service.editarModelo(req, idParamSchema.parse(req.params).id, s.editarModeloSchema.parse(req.body));
  res.status(204).end();
});
horariosAdminRoutes.delete('/modelos/:id', async (req, res) => {
  await service.removerModelo(idParamSchema.parse(req.params).id);
  res.status(204).end();
});

// RF17
horariosAdminRoutes.get('/funcionarios/:id/jornada', async (req, res) => {
  res.json(await service.obterJornada(idParamSchema.parse(req.params).id));
});
horariosAdminRoutes.put('/funcionarios/:id/jornada', async (req, res) => {
  const { semana } = s.jornadaSchema.parse(req.body);
  res.json(await service.definirJornada(req, idParamSchema.parse(req.params).id, semana));
});
horariosAdminRoutes.post('/funcionarios/:id/jornada/aplicar-modelo', async (req, res) => {
  const { modeloId } = s.aplicarModeloSchema.parse(req.body);
  res.json(await service.aplicarModelo(req, idParamSchema.parse(req.params).id, modeloId));
});

horariosAdminRoutes.get('/excecoes', async (req, res) => {
  res.json(await service.listarExcecoes(s.periodoQuery.parse(req.query)));
});
horariosAdminRoutes.post('/excecoes', async (req, res) => {
  res.status(201).json(await service.criarExcecao(req, s.excecaoSchema.parse(req.body)));
});
horariosAdminRoutes.delete('/excecoes/:id', async (req, res) => {
  await service.removerExcecao(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});

// RF18
horariosAdminRoutes.get('/bloqueios', async (req, res) => {
  res.json(await service.listarBloqueios(s.periodoQuery.parse(req.query)));
});
horariosAdminRoutes.post('/bloqueios', async (req, res) => {
  res.status(201).json(await service.criarBloqueio(req, s.bloqueioSchema.parse(req.body)));
});
horariosAdminRoutes.delete('/bloqueios/:id', async (req, res) => {
  await service.removerBloqueio(req, idParamSchema.parse(req.params).id);
  res.status(204).end();
});

// Quem atende e ainda não tem horário (aviso no Início)
horariosAdminRoutes.get('/diagnostico', async (_req, res) => {
  res.json(await service.diagnostico());
});

// RF20: prévia dos horários livres no painel
horariosAdminRoutes.get('/disponibilidade', async (req, res) => {
  res.json(await service.disponibilidade(s.disponibilidadeQuery.parse(req.query)));
});

// ─── Funcionário: os próprios horários (RF19) ────────────

export const horariosStaffRoutes = Router();
horariosStaffRoutes.use(authenticate);

async function exigirEdicao(req: Request) {
  const f = await meuPerfil(req);
  if (!f.podeEditarHorario) throw new AppError('SEM_PERMISSAO', 'Peça ao administrador para ajustar seus horários', 403);
  return f;
}

horariosStaffRoutes.get('/', async (req, res) => {
  const f = await meuPerfil(req);
  const zona = await service.zonaDaEmpresa();
  const hoje = DateTime.now().setZone(zona).toISODate()!;
  const ate = DateTime.now().setZone(zona).plus({ days: 90 }).toISODate()!;
  const [jornada, excecoes, bloqueios] = await Promise.all([
    service.obterJornada(f.id),
    service.listarExcecoes({ de: hoje, ate, funcionarioId: f.id }),
    service.listarBloqueios({ de: hoje, ate, funcionarioId: f.id }),
  ]);
  res.json({ funcionarioId: f.id, podeEditar: f.podeEditarHorario, jornada, excecoes, bloqueios });
});

horariosStaffRoutes.put('/jornada', async (req, res) => {
  const f = await exigirEdicao(req);
  res.json(await service.definirJornada(req, f.id, s.jornadaSchema.parse(req.body).semana));
});

horariosStaffRoutes.post('/excecoes', async (req, res) => {
  const f = await exigirEdicao(req);
  // Ignora qualquer funcionarioId enviado: só pode criar para si (e nunca feriado geral)
  const dados = s.excecaoSchema.parse({ ...req.body, funcionarioId: f.id });
  res.status(201).json(await service.criarExcecao(req, dados));
});

horariosStaffRoutes.delete('/excecoes/:id', async (req, res) => {
  const f = await exigirEdicao(req);
  await service.removerExcecao(req, idParamSchema.parse(req.params).id, f.id);
  res.status(204).end();
});

horariosStaffRoutes.post('/bloqueios', async (req, res) => {
  const f = await exigirEdicao(req);
  const dados = s.bloqueioSchema.parse({ ...req.body, funcionarioId: f.id });
  res.status(201).json(await service.criarBloqueio(req, dados));
});

horariosStaffRoutes.delete('/bloqueios/:id', async (req, res) => {
  const f = await exigirEdicao(req);
  await service.removerBloqueio(req, idParamSchema.parse(req.params).id, f.id);
  res.status(204).end();
});

// ─── Público ─────────────────────────────────────────────

export async function disponibilidadePublica(req: Request) {
  const q = s.disponibilidadeQuery.parse(req.query);
  idSchema.parse(q.servicoId);
  return service.disponibilidade(q);
}
