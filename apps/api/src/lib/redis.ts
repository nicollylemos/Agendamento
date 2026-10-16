import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Fase 6: Redis para filas (BullMQ) e rate limit compartilhado (9.5).
// Se o Redis cair, a API continua no ar: o rate limit libera (o bloqueio de conta
// no banco continua valendo) e as varreduras pegam o atraso quando ele voltar.

let ultimoAviso = 0;
function avisar(err: Error) {
  if (Date.now() - ultimoAviso < 60_000) return;
  ultimoAviso = Date.now();
  logger.warn({ err: err.message }, 'Redis indisponível');
}

let comandos: Redis | null = null;

// Para comandos rápidos (rate limit): falha na hora em vez de enfileirar
export function redisComandos() {
  if (!comandos) {
    comandos = new Redis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    comandos.on('error', avisar);
  }
  return comandos;
}

// Conexão própria para o BullMQ (ele exige maxRetriesPerRequest: null)
export function novaConexaoFila() {
  const c = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  c.on('error', avisar);
  return c;
}
