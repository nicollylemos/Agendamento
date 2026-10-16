import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/requirePermission.js';
import { requireReauth } from '../../middlewares/requireReauth.js';
import { exportacaoLimiter, relatorioLimiter } from '../../middlewares/rateLimit.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { meuPerfil } from '../funcionarios/meuPerfil.js';
import * as relatorios from './relatorios.service.js';
import { paraCsv, paraPdf } from './exportar.js';
import { exportarQuery, relatorioQuery, tipoParam, TIPOS_PROPRIOS, type Filtro, type TipoRelatorio } from './relatorios.schemas.js';

// Fase 10: relatórios (RF47–RF55)

// RF55 + 9.1/9.7: exportar tira dados do sistema, então pede a senha de novo e fica na auditoria
async function exportar(req: Request, res: Response, tipo: TipoRelatorio, filtro: Filtro) {
  const { formato } = exportarQuery.parse(req.query);
  const r = await relatorios.gerar(tipo, filtro);
  await auditar('RELATORIO_EXPORTADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Relatorio',
    detalhes: { tipo, formato, de: filtro.de, ate: filtro.ate, funcionarioId: filtro.funcionarioId ?? null },
  });
  const nome = `relatorio-${tipo}-${filtro.de}-a-${filtro.ate}.${formato}`;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  if (formato === 'csv') {
    res.type('text/csv; charset=utf-8').send(paraCsv(r));
    return;
  }
  const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { nome: true } });
  res.type('application/pdf').send(await paraPdf(r, empresa?.nome ?? 'Agendamento'));
}

// ─── Admin e gerente: tudo ───────────────────────────────

export const relatoriosAdminRoutes = Router();
relatoriosAdminRoutes.use(authenticate, requirePermission('relatorios:ver'), relatorioLimiter);

relatoriosAdminRoutes.get('/profissionais', async (_req, res) => {
  res.json(await relatorios.profissionais());
});
relatoriosAdminRoutes.get('/:tipo', async (req, res) => {
  const { tipo } = tipoParam.parse(req.params);
  res.json(await relatorios.gerar(tipo, relatorioQuery.parse(req.query)));
});
relatoriosAdminRoutes.get('/:tipo/exportar', exportacaoLimiter, requireReauth, async (req, res) => {
  const { tipo } = tipoParam.parse(req.params);
  await exportar(req, res, tipo, relatorioQuery.parse(req.query));
});

// ─── Profissional: só a própria produção (9.2) ───────────

export const relatoriosStaffRoutes = Router();
relatoriosStaffRoutes.use(authenticate, requirePermission('relatorios:ver_proprios'), relatorioLimiter);

async function filtroProprio(req: Request) {
  const { tipo } = tipoParam.parse(req.params);
  if (!TIPOS_PROPRIOS.includes(tipo)) throw new AppError('SEM_PERMISSAO', 'Você não tem acesso a este relatório', 403);
  const f = await meuPerfil(req);
  // Ignora qualquer funcionarioId vindo da URL
  return { tipo, filtro: relatorioQuery.parse({ ...req.query, funcionarioId: f.id }) };
}

relatoriosStaffRoutes.get('/:tipo', async (req, res) => {
  const { tipo, filtro } = await filtroProprio(req);
  res.json(await relatorios.gerar(tipo, filtro));
});
relatoriosStaffRoutes.get('/:tipo/exportar', exportacaoLimiter, requireReauth, async (req, res) => {
  const { tipo, filtro } = await filtroProprio(req);
  await exportar(req, res, tipo, filtro);
});
