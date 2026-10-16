import { pino } from 'pino';
import { env } from '../config/env.js';

// redact: esses campos nunca aparecem nos logs (RNF11 / LGPD)
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-signature"]', // assinatura do webhook do gateway
      'req.headers["x-reauth-token"]',
      '*.password',
      '*.senha',
      '*.token',
      '*.email',
      '*.telefone',
    ],
    censor: '[oculto]',
  },
});
