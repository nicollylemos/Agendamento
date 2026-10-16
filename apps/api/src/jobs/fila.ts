import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { novaConexaoFila } from '../lib/redis.js';

// Fase 6: fila de tarefas agendadas (BullMQ + Redis).
// - expirar-sinal: roda na hora exata em que o prazo do Pix vence (RF31)
// - varredura: a cada minuto, pega qualquer expiração perdida (ex.: Redis reiniciou)
// - lembretes: a cada 5 minutos, envia os lembretes de 24 h e 2 h (RF27)

export const NOME_FILA = 'agendamentos';

let fila: Queue | null = null;

export function obterFila() {
  if (env.NODE_ENV === 'test') return null;
  fila ??= new Queue(NOME_FILA, { connection: novaConexaoFila() });
  return fila;
}

// Não espera o Redis: se ele estiver fora, a varredura cobre
export function agendarExpiracao(agendamentoId: string, quando: Date) {
  const f = obterFila();
  if (!f) return;
  f.add(
    'expirar-sinal',
    { agendamentoId },
    { delay: Math.max(0, quando.getTime() - Date.now()) + 1_000, jobId: `expirar-${agendamentoId}`, removeOnComplete: true, removeOnFail: 100 },
  ).catch((err: Error) => logger.warn({ err: err.message }, 'Não foi possível agendar a expiração (a varredura cobre)'));
}

// Tarefa avulsa (ex.: aviso de estoque baixo). Devolve false se não há fila (testes),
// para quem chamou fazer na hora.
export function enfileirar(nome: string, dados: Record<string, unknown>) {
  const f = obterFila();
  if (!f) return false;
  f.add(nome, dados, { removeOnComplete: true, removeOnFail: 100, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } }).catch((err: Error) =>
    logger.warn({ err: err.message, nome }, 'Não foi possível enfileirar a tarefa'),
  );
  return true;
}
