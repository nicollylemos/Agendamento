import { Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { novaConexaoFila } from '../lib/redis.js';
import { expirarVencidos } from '../modules/pagamentos/pagamentos.service.js';
import { NOME_FILA, obterFila } from './fila.js';
import { enviarLembretes } from './lembretes.js';
import { enviarAlertaEstoqueBaixo, enviarAlertaValidade } from '../modules/estoque/estoque.service.js';
import { expirar as expirarPontos } from '../modules/fidelidade/fidelidade.service.js';

// Fase 6: processa a fila (RF27, RF31). Também tem uma rede de segurança sem Redis:
// se a varredura do BullMQ não rodar por 3 minutos, a própria API expira os sinais
// vencidos, para nenhum horário ficar preso.

let ultimaVarredura = Date.now();

async function varrer() {
  ultimaVarredura = Date.now();
  const n = await expirarVencidos();
  if (n) logger.info({ expirados: n }, 'Sinais expirados');
}

export async function iniciarWorker() {
  const fila = obterFila();
  if (!fila) return;

  const worker = new Worker(
    NOME_FILA,
    async (job) => {
      if (job.name === 'expirar-sinal' || job.name === 'varredura') return varrer();
      if (job.name === 'lembretes') return enviarLembretes();
      if (job.name === 'alerta-estoque') return enviarAlertaEstoqueBaixo((job.data as { produtoIds: string[] }).produtoIds);
      if (job.name === 'validade') return enviarAlertaValidade();
      if (job.name === 'fidelidade-expirar') return expirarPontos();
    },
    { connection: novaConexaoFila(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'Tarefa falhou'));

  // Tarefas repetidas (upsert: várias instâncias não duplicam)
  fila.upsertJobScheduler('varredura', { every: 60_000 }, { name: 'varredura' }).catch(() => undefined);
  fila.upsertJobScheduler('lembretes', { every: 5 * 60_000 }, { name: 'lembretes' }).catch(() => undefined);
  // RF41: todo dia às 8h (horário de Brasília)
  // Fase 8: pontos e vouchers vencidos, todo dia às 3h
  fila.upsertJobScheduler('fidelidade-expirar', { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, { name: 'fidelidade-expirar' }).catch(() => undefined);
  fila.upsertJobScheduler('validade', { pattern: '0 8 * * *', tz: 'America/Sao_Paulo' }, { name: 'validade' }).catch(() => undefined);

  const rede = setInterval(() => {
    if (Date.now() - ultimaVarredura > 3 * 60_000) {
      varrer().catch((err: Error) => logger.error({ err: err.message }, 'Falha na varredura de segurança'));
    }
  }, 60_000);
  rede.unref();

  logger.info('Fila de tarefas iniciada (expiração do sinal e lembretes)');
  return worker;
}
