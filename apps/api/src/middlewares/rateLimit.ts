import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redisComandos } from '../lib/redis.js';

// Seção 9.5: limites por rota.
// Fase 6: os contadores ficam no Redis, então valem mesmo com várias instâncias da API
// e não zeram quando ela reinicia. Nos testes ficam desligados.

// O RedisStore carrega os scripts no construtor; se o Redis estiver fora do ar nesse
// momento, a promessa rejeitada derrubaria o processo. Aqui ela é tratada e
// recarregada na primeira requisição.
class StoreRedis extends RedisStore {
  constructor(prefixo: string) {
    super({ prefix: `rl:${prefixo}:`, sendCommand: (comando: string, ...args: string[]) => redisComandos().call(comando, ...args) as Promise<number> });
    const scripts = this as unknown as { incrementScriptSha: Promise<string>; getScriptSha: Promise<string> };
    scripts.incrementScriptSha.catch(() => undefined);
    scripts.getScriptSha.catch(() => undefined);
  }
}

const mensagem = { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas, aguarde e tente de novo' };

function limiter(nome: string, opts: Partial<Options>) {
  const teste = env.NODE_ENV === 'test';
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: mensagem,
    skip: () => teste,
    ...(!teste && { store: new StoreRedis(nome) }),
    // Redis fora do ar: libera em vez de derrubar o site. Login continua protegido
    // pelo bloqueio progressivo da conta, que fica no banco (9.1).
    passOnStoreError: true,
    ...opts,
  });
}

const chaveIp = (req: Parameters<NonNullable<Options['keyGenerator']>>[0]) => ipKeyGenerator(req.ip ?? '');

export const generalLimiter = limiter('general', { windowMs: 60_000, limit: 100 });

// Login: 5 por minuto por IP e 5 por minuto por e-mail
export const loginIpLimiter = limiter('loginIp', { windowMs: 60_000, limit: 5, keyGenerator: chaveIp });
export const loginEmailLimiter = limiter('loginEmail', {
  windowMs: 60_000,
  limit: 5,
  keyGenerator: (req) => `email:${String(req.body?.email ?? '').toLowerCase()}`,
});

// Códigos de 2FA: 5 por minuto por IP
export const mfaLimiter = limiter('mfa', { windowMs: 60_000, limit: 5, keyGenerator: chaveIp });

// Recuperação de senha: 3 a cada 15 minutos por IP
export const resetLimiter = limiter('reset', { windowMs: 15 * 60_000, limit: 3, keyGenerator: chaveIp });

// Fase 5: rotas públicas de agendamento
// Criar agendamento: 10 por hora por IP (evita robô lotando a agenda)
export const agendamentoLimiter = limiter('agendamento', { windowMs: 60 * 60_000, limit: 10, keyGenerator: chaveIp });
// Link de gestão: 30 a cada 15 min por IP
export const gestaoLimiter = limiter('gestao', { windowMs: 15 * 60_000, limit: 30, keyGenerator: chaveIp });
// Código por e-mail: 3 a cada 15 min por IP e por e-mail
export const codigoIpLimiter = limiter('codigoIp', { windowMs: 15 * 60_000, limit: 3, keyGenerator: chaveIp });
export const codigoEmailLimiter = limiter('codigoEmail', {
  windowMs: 15 * 60_000,
  limit: 3,
  keyGenerator: (req) => `codigo:${String(req.body?.email ?? '').toLowerCase()}`,
});
export const entrarClienteLimiter = limiter('entrarCliente', { windowMs: 15 * 60_000, limit: 10, keyGenerator: chaveIp });
// Fase 6: a tela do Pix consulta se o pagamento caiu (a cada poucos segundos)
export const statusSinalLimiter = limiter('statusSinal', { windowMs: 15 * 60_000, limit: 240, keyGenerator: chaveIp });
// Webhook do gateway: generoso (o gateway reenvia), a assinatura é que protege
export const webhookLimiter = limiter('webhook', { windowMs: 60_000, limit: 300, keyGenerator: chaveIp });
// Fase 9: envio de imagens (pesado: reprocessa com sharp)
export const uploadLimiter = limiter('upload', { windowMs: 10 * 60_000, limit: 40 });
// Fase 10: relatórios fazem consultas pesadas; limite por usuário logado (RNF, 9.5)
const chaveUsuario = (req: Parameters<NonNullable<Options['keyGenerator']>>[0]) =>
  req.usuario ? `u:${req.usuario.id}` : ipKeyGenerator(req.ip ?? '');
export const relatorioLimiter = limiter('relatorio', { windowMs: 60_000, limit: 120, keyGenerator: chaveUsuario });
// Exportação (RF55): ainda mais restrito
export const exportacaoLimiter = limiter('exportacao', { windowMs: 10 * 60_000, limit: 20, keyGenerator: chaveUsuario });
// Tela do cliente: quais dias têm horário (14 dias de cálculo por chamada)
export const diasLivresLimiter = limiter('diasLivres', { windowMs: 15 * 60_000, limit: 120, keyGenerator: chaveIp });
