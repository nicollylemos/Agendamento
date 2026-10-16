import { prisma } from './prisma.js';
import { logger } from './logger.js';
import { isProd } from '../config/env.js';

// Confere se a trava da agenda existe no banco. Uma migration futura mal revisada
// poderia removê-la sem ninguém perceber; em produção a API nem sobe sem ela.
export async function verificarTravaAgenda() {
  const r = await prisma.$queryRaw<{ existe: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agendamentos_sem_sobreposicao') AS existe`;
  if (r[0]?.existe) return;

  const msg = 'A trava da agenda (agendamentos_sem_sobreposicao) não existe no banco. Veja docs/FASE-5-AGENDAMENTO.md';
  if (isProd) {
    logger.fatal(msg);
    process.exit(1);
  }
  logger.warn(msg);
}

// Erro do Postgres quando a trava barra um horário (23P01 = exclusion_violation)
export function ehConflitoDeHorario(err: unknown): boolean {
  const texto = err instanceof Error ? `${err.message} ${JSON.stringify(err)}` : String(err);
  return texto.includes('agendamentos_sem_sobreposicao') || texto.includes('23P01');
}
