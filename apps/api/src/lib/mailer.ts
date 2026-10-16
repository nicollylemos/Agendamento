import { isProd } from '../config/env.js';
import { logger } from './logger.js';

// Provedor real (Resend ou SES) entra numa fase futura.
// Em desenvolvimento, o e-mail aparece no terminal da API.
export async function enviarEmail(para: string, assunto: string, texto: string) {
  if (isProd) {
    logger.warn({ assunto }, 'Provedor de e-mail ainda não configurado: e-mail não enviado');
    return;
  }
  logger.info(`\n──── E-MAIL (dev) ────\nPara: ${para}\nAssunto: ${assunto}\n\n${texto}\n──────────────────────`);
}
