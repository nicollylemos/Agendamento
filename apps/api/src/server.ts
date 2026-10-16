import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { verificarTravaAgenda } from './lib/travaAgenda.js';
import { iniciarWorker } from './jobs/worker.js';

await verificarTravaAgenda();

app.listen(env.PORT, () => {
  logger.info(`API rodando em http://localhost:${env.PORT}`);
});

// Fase 6: expiração do sinal (RF31) e lembretes (RF27)
if (env.WORKER_EMBUTIDO) await iniciarWorker();
