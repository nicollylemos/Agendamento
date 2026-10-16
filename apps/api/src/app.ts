import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { generalLimiter } from './middlewares/rateLimit.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usuariosRoutes } from './modules/usuarios/usuarios.routes.js';
import { empresaRoutes } from './modules/empresa/empresa.routes.js';
import { funcionariosRoutes } from './modules/funcionarios/funcionarios.routes.js';
import { servicosRoutes } from './modules/servicos/servicos.routes.js';
import { publicoRoutes } from './modules/publico/publico.routes.js';
import { horariosAdminRoutes, horariosStaffRoutes } from './modules/horarios/horarios.routes.js';
import { agendaAdminRoutes, agendaStaffRoutes, agendamentoPublicoRoutes } from './modules/agendamentos/agendamentos.routes.js';
import { estoqueRoutes } from './modules/estoque/estoque.routes.js';
import { arquivosAdminRoutes, arquivosPublicosRoutes } from './modules/arquivos/arquivos.routes.js';
import { personalizacaoAdminRoutes } from './modules/personalizacao/personalizacao.routes.js';
import { fidelidadeAdminRoutes, fidelidadePublicaRoutes } from './modules/fidelidade/fidelidade.routes.js';
import { relatoriosAdminRoutes, relatoriosStaffRoutes } from './modules/relatorios/relatorios.routes.js';
import { postsRoutes } from './modules/posts/posts.routes.js';
import { pagamentosAdminRoutes, segurancaPublicaRoutes, webhookRoutes } from './modules/pagamentos/pagamentos.routes.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // atrás do Nginx/Cloudflare, para o rate limit ver o IP real

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
// Imagens servidas pela API em desenvolvimento (antes do limite geral: uma página tem várias)
app.use('/api/v1/arquivos', arquivosPublicosRoutes);
app.use(generalLimiter);

app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin/usuarios', usuariosRoutes);
app.use('/api/v1/admin/empresa', empresaRoutes); // RF06
app.use('/api/v1/admin/funcionarios', funcionariosRoutes);
app.use('/api/v1/admin/servicos', servicosRoutes); // RF12, RF13
app.use('/api/v1/admin/horarios', horariosAdminRoutes); // RF16–RF18, RF20
app.use('/api/v1/staff/horarios', horariosStaffRoutes); // RF19
app.use('/api/v1/admin/agenda', agendaAdminRoutes); // RF22, RF24–RF26
app.use('/api/v1/staff/agenda', agendaStaffRoutes);
app.use('/api/v1/public', publicoRoutes);
app.use('/api/v1/public', agendamentoPublicoRoutes); // RF04, RF21, RF23, RF25, RF29, RF30
app.use('/api/v1/public/seguranca', segurancaPublicaRoutes); // RF36 (fluxo 6.5)
app.use('/api/v1/admin/pagamentos', pagamentosAdminRoutes); // RF28, RF32, RF34–RF37
app.use('/api/v1/webhooks', webhookRoutes); // RF30
app.use('/api/v1/admin/estoque', estoqueRoutes); // RF38–RF42
app.use('/api/v1/admin/fidelidade', fidelidadeAdminRoutes); // RF43, RF44, RF46
app.use('/api/v1/public', fidelidadePublicaRoutes); // RF46
app.use('/api/v1/admin/arquivos', arquivosAdminRoutes); // RF07, RF09, RF12 (9.4)
app.use('/api/v1/admin/personalizacao', personalizacaoAdminRoutes); // RF07, RF08, RF10
app.use('/api/v1/admin/relatorios', relatoriosAdminRoutes); // RF47–RF55
app.use('/api/v1/admin/posts', postsRoutes); // posts para o Instagram
app.use('/api/v1/staff/relatorios', relatoriosStaffRoutes); // RF47, RF49, RF54 (só os próprios)

// Rota inexistente
app.use((_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: 'Rota não encontrada' });
});

app.use(errorHandler);
