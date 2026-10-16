import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { requireReauth } from '../../middlewares/requireReauth.js';
import { validateBody } from '../../middlewares/validate.js';
import { resetLimiter, webhookLimiter } from '../../middlewares/rateLimit.js';
import { idParamSchema } from '../../lib/zod.js';
import * as pagamentos from './pagamentos.service.js';
import * as recebedor from './recebedor.service.js';
import { configSinalSchema, obterConfigSinal, salvarConfigSinal } from './sinal.service.js';

// ─── Painel: sinal (RF28, RF32) e recebedor (RF34–RF37) ──

export const pagamentosAdminRoutes = Router();
pagamentosAdminRoutes.use(authenticate);

pagamentosAdminRoutes.get('/situacao', requirePermission('sinal:gerenciar'), async (_req, res) => {
  res.json(await pagamentos.situacao());
});

// RF28, RF32. Mudar a regra do sinal mexe com dinheiro: pede senha (+2FA) de novo (9.1)
pagamentosAdminRoutes.get('/config', requirePermission('sinal:gerenciar'), async (_req, res) => {
  res.json(await obterConfigSinal());
});
pagamentosAdminRoutes.put('/config', requirePermission('sinal:gerenciar'), requireReauth, validateBody(configSinalSchema), async (req, res) => {
  res.json(await salvarConfigSinal(req, req.body));
});

// RF34, RF35: a tela só recebe os 4 últimos caracteres
pagamentosAdminRoutes.get('/recebedor', requirePermission('recebedor:gerenciar'), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await recebedor.obter());
});
// RF36: senha + 2FA, auditoria e e-mail de alerta
pagamentosAdminRoutes.put('/recebedor', requirePermission('recebedor:gerenciar'), requireReauth, validateBody(recebedor.salvarRecebedorSchema), async (req, res) => {
  res.json(await recebedor.salvar(req, req.body));
});
// RF37
pagamentosAdminRoutes.post('/recebedor/testar', requirePermission('recebedor:gerenciar'), async (req, res) => {
  res.json(await recebedor.testar(req));
});
pagamentosAdminRoutes.post(
  '/recebedor/ativo',
  requirePermission('recebedor:gerenciar'),
  requireReauth,
  validateBody(z.object({ ativo: z.boolean() })),
  async (req, res) => {
    res.json(await recebedor.definirAtivo(req, req.body.ativo));
  },
);

// Pagamentos que precisam de atenção (chegou depois de expirar, reembolso falhou)
pagamentosAdminRoutes.get('/', requirePermission('sinal:gerenciar'), async (req, res) => {
  const { filtro } = z.object({ filtro: z.enum(['atencao', 'todos']).default('atencao') }).parse(req.query);
  res.json(await pagamentos.listar(filtro));
});
// RF32: devolver o sinal na mão (dinheiro saindo: reautenticação)
pagamentosAdminRoutes.post('/:id/reembolsar', requirePermission('sinal:gerenciar'), requireReauth, async (req, res) => {
  res.json({ resultado: await pagamentos.reembolsar(req, idParamSchema.parse(req.params).id) });
});

// ─── Webhook do gateway (RF30, 9.3) ──────────────────────

const GATEWAYS = { mercado_pago: 'MERCADO_PAGO', simulado: 'SIMULADO' } as const;

function cabecalhos(req: Request) {
  return { 'x-signature': req.get('x-signature'), 'x-request-id': req.get('x-request-id') };
}

export const webhookRoutes = Router();
webhookRoutes.post('/pagamentos/:gateway', webhookLimiter, async (req, res) => {
  const tipo = GATEWAYS[req.params.gateway as keyof typeof GATEWAYS];
  if (!tipo) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Rota não encontrada' });
    return;
  }
  const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
  const r = await pagamentos.processarWebhook(tipo, { headers: cabecalhos(req), query, body: req.body });
  // Não devolve detalhes para quem chamou (só o status)
  res.status(r.status).json({ ok: r.status === 200 });
});

// ─── Público: link "não fui eu" do e-mail de alerta (fluxo 6.5) ──

export const segurancaPublicaRoutes = Router();
segurancaPublicaRoutes.post('/nao-fui-eu', resetLimiter, validateBody(z.object({ token: z.string().min(20).max(200) })), async (req, res) => {
  await recebedor.naoFuiEu(req, req.body.token);
  res.status(204).end();
});
