import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { validateBody } from '../../middlewares/validate.js';
import {
  agendamentoLimiter,
  codigoEmailLimiter,
  codigoIpLimiter,
  entrarClienteLimiter,
  gestaoLimiter,
  statusSinalLimiter,
} from '../../middlewares/rateLimit.js';
import { isProd } from '../../config/env.js';
import { idParamSchema } from '../../lib/zod.js';
import { meuPerfil } from '../funcionarios/meuPerfil.js';
import { configAgendaSchema, coresSchema, metaSchema, obterConfigAgenda, obterVisual, salvarConfigAgenda, salvarCores, salvarMeta } from '../agenda/config.service.js';
import * as clientes from '../clientes/clientes.service.js';
import * as service from './agendamentos.service.js';
import * as consumoSvc from '../estoque/consumo.service.js';
import * as s from './agendamentos.schemas.js';

// ─── Admin e gerente ─────────────────────────────────────

export const agendaAdminRoutes = Router();
agendaAdminRoutes.use(authenticate);

// RF22, RF25: regras da agenda
agendaAdminRoutes.get('/config', requirePermission('empresa:gerenciar'), async (_req, res) => {
  res.json(await obterConfigAgenda());
});
agendaAdminRoutes.put('/config', requirePermission('empresa:gerenciar'), async (req, res) => {
  res.json(await salvarConfigAgenda(req, configAgendaSchema.parse(req.body)));
});

// Visual da agenda: cores por situação e meta do mês (Início)
agendaAdminRoutes.get('/visual', requirePermission('agenda:ver_todas'), async (_req, res) => {
  res.json(await obterVisual());
});
agendaAdminRoutes.put('/cores', requirePermission('empresa:gerenciar'), async (req, res) => {
  res.json(await salvarCores(req, coresSchema.parse(req.body)));
});
agendaAdminRoutes.put('/meta', requirePermission('empresa:gerenciar'), async (req, res) => {
  res.json(await salvarMeta(req, metaSchema.parse(req.body).metaMensalCentavos));
});

// Opções do formulário de agendamento no painel
agendaAdminRoutes.get('/opcoes', requirePermission('agenda:gerenciar'), async (_req, res) => {
  res.json(await service.opcoes());
});
agendaAdminRoutes.get('/horarios-livres', requirePermission('agenda:gerenciar'), async (req, res) => {
  res.json(await service.horariosLivresPainel(s.horariosPainelQuery.parse(req.query)));
});

// Grade do dia (agenda da equipe, RF24/RF26): colunas (profissionais ativos, sem dados de contato)
agendaAdminRoutes.get('/profissionais', requirePermission('agenda:ver_todas'), async (_req, res) => {
  res.json(await service.profissionaisDaAgenda());
});

agendaAdminRoutes.get('/', requirePermission('agenda:ver_todas'), async (req, res) => {
  res.json(await service.listar(s.agendaQuery.parse(req.query), 'gestao'));
});
// RF24
agendaAdminRoutes.post('/', requirePermission('agenda:gerenciar'), async (req, res) => {
  res.status(201).json(await service.criarPainel(req, s.agendamentoPainelSchema.parse(req.body)));
});
// RF26
agendaAdminRoutes.patch('/:id/status', requirePermission('agenda:gerenciar'), async (req, res) => {
  const { status, motivo, reembolsarSinal, consumo, formaPagamento } = s.mudarStatusSchema.parse(req.body);
  res.json(await service.mudarStatus(req, idParamSchema.parse(req.params).id, status, { motivo, reembolsarSinal, consumo, formaPagamento }));
});
// RF40: produtos da ficha técnica, para a tela de concluir
agendaAdminRoutes.get('/:id/consumo', requirePermission('agenda:gerenciar'), async (req, res) => {
  res.json(await consumoSvc.sugestao(idParamSchema.parse(req.params).id));
});
// RF25
agendaAdminRoutes.patch('/:id/reagendar', requirePermission('agenda:gerenciar'), async (req, res) => {
  res.json(await service.reagendarPainel(req, idParamSchema.parse(req.params).id, s.reagendarPainelSchema.parse(req.body)));
});

// ─── Funcionário: a própria agenda ───────────────────────

export const agendaStaffRoutes = Router();
agendaStaffRoutes.use(authenticate);

// Só as cores (a meta é da gestão)
agendaStaffRoutes.get('/visual', requirePermission('agenda:ver_propria'), async (_req, res) => {
  const { cores, coresPadrao } = await obterVisual();
  res.json({ cores, coresPadrao, metaMensalCentavos: null });
});

agendaStaffRoutes.get('/', requirePermission('agenda:ver_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  const { de, ate } = s.agendaQuery.parse(req.query);
  res.json(await service.listar({ de, ate, funcionarioId: f.id }, 'funcionario'));
});
// Coluna da grade do dia: sempre o profissional do login (9.2)
agendaStaffRoutes.get('/profissionais', requirePermission('agenda:ver_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  res.json([{ id: f.id, nome: f.nome, cargo: f.cargo }]);
});
agendaStaffRoutes.get('/opcoes', requirePermission('agenda:gerenciar_propria'), async (req, res) => {
  res.json(await service.opcoes((await meuPerfil(req)).id));
});
agendaStaffRoutes.get('/horarios-livres', requirePermission('agenda:gerenciar_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  // Sempre os horários do próprio funcionário
  res.json(await service.horariosLivresPainel(s.horariosPainelQuery.parse({ ...req.query, funcionarioId: f.id })));
});
agendaStaffRoutes.post('/', requirePermission('agenda:gerenciar_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  // O funcionário só agenda para si mesmo, ignorando qualquer funcionarioId enviado
  const dados = s.agendamentoPainelSchema.parse({ ...req.body, funcionarioId: f.id });
  res.status(201).json(await service.criarPainel(req, dados));
});
agendaStaffRoutes.patch('/:id/status', requirePermission('agenda:gerenciar_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  const { status, motivo, consumo, formaPagamento } = s.mudarStatusSchema.parse(req.body);
  res.json(await service.mudarStatus(req, idParamSchema.parse(req.params).id, status, { motivo, dono: f.id, consumo, formaPagamento }));
});
agendaStaffRoutes.get('/:id/consumo', requirePermission('agenda:gerenciar_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  res.json(await consumoSvc.sugestao(idParamSchema.parse(req.params).id, f.id));
});
agendaStaffRoutes.patch('/:id/reagendar', requirePermission('agenda:gerenciar_propria'), async (req, res) => {
  const f = await meuPerfil(req);
  const p = s.reagendarPainelSchema.parse(req.body);
  res.json(await service.reagendarPainel(req, idParamSchema.parse(req.params).id, p, f.id));
});

// ─── Público: cliente ────────────────────────────────────

export const agendamentoPublicoRoutes = Router();

// RF21, RF23
agendamentoPublicoRoutes.post('/agendamentos', agendamentoLimiter, validateBody(s.agendamentoOnlineSchema), async (req, res) => {
  res.status(201).json(await service.criarOnline(req, req.body));
});

// RF25: link de gestão (token no corpo, nunca na URL)
agendamentoPublicoRoutes.post('/agendamentos/consultar', gestaoLimiter, validateBody(s.tokenGestaoSchema), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await service.consultarPorToken(req.body.token));
});
// RF30: a tela do Pix pergunta se o pagamento caiu (resposta mínima, sem dados pessoais)
agendamentoPublicoRoutes.post('/agendamentos/status-sinal', statusSinalLimiter, validateBody(s.tokenGestaoSchema), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await service.statusSinalPorToken(req.body.token));
});
// Só fora de produção: simula o cliente pagando o Pix (gateway simulado)
if (!isProd) {
  agendamentoPublicoRoutes.post('/agendamentos/simular-pix', gestaoLimiter, validateBody(s.simularPixSchema), async (req, res) => {
    res.json(await service.simularPixPorToken(req.body.token));
  });
}
agendamentoPublicoRoutes.post('/agendamentos/cancelar', gestaoLimiter, validateBody(s.cancelarClienteSchema), async (req, res) => {
  res.json(await service.cancelarPorToken(req, req.body.token, req.body.motivo));
});
agendamentoPublicoRoutes.post('/agendamentos/reagendar', gestaoLimiter, validateBody(s.reagendarClienteSchema), async (req, res) => {
  res.json(await service.reagendarPorToken(req, req.body.token, req.body.data, req.body.horario));
});

// RF04: cliente vê os agendamentos com código enviado por e-mail
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const entrarSchema = emailSchema.extend({ codigo: z.string().trim().regex(/^\d{6}$/, 'Código de 6 dígitos') });

agendamentoPublicoRoutes.post('/clientes/codigo', codigoIpLimiter, validateBody(emailSchema), codigoEmailLimiter, async (req, res) => {
  await clientes.solicitarCodigo(req.body.email);
  res.status(202).json({ message: 'Se houver agendamentos com esse e-mail, o código chega em instantes.' });
});
agendamentoPublicoRoutes.post('/clientes/entrar', entrarClienteLimiter, validateBody(entrarSchema), async (req, res) => {
  res.json(await clientes.entrar(req, req.body.email, req.body.codigo));
});
agendamentoPublicoRoutes.get('/clientes/agendamentos', gestaoLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await clientes.meusAgendamentos(await clientes.emailDoToken(req.get('authorization'))));
});
agendamentoPublicoRoutes.post('/clientes/agendamentos/:id/cancelar', gestaoLimiter, async (req, res) => {
  const email = await clientes.emailDoToken(req.get('authorization'));
  res.json(await clientes.cancelar(req, email, idParamSchema.parse(req.params).id));
});
