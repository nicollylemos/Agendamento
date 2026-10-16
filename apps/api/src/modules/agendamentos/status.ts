import type { StatusAgendamento } from '@prisma/client';

// RF26: para onde cada status pode ir.
// Expirar (RF31) e confirmar pelo webhook (RF30) são automáticos. A equipe pode
// confirmar na mão quem aguardava o sinal (ex.: pagou no balcão); o Pix pendente é cancelado.
const TRANSICOES: Record<StatusAgendamento, StatusAgendamento[]> = {
  AGUARDANDO_PAGAMENTO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_ATENDIMENTO', 'CONCLUIDO', 'NAO_COMPARECEU', 'CANCELADO'],
  EM_ATENDIMENTO: ['CONCLUIDO', 'CANCELADO'],
  CONCLUIDO: [],
  CANCELADO: [],
  EXPIRADO: [],
  NAO_COMPARECEU: [],
};

export function podeMudar(de: StatusAgendamento, para: StatusAgendamento): boolean {
  return TRANSICOES[de].includes(para);
}

export function proximosStatus(de: StatusAgendamento): StatusAgendamento[] {
  return TRANSICOES[de];
}

// Só dá para marcar falta ou iniciar o atendimento quando o horário chegou
// (iniciar: até 30 min antes, para quem chega cedo)
export function momentoPermite(para: StatusAgendamento, inicio: Date, agora = new Date()): boolean {
  if (para === 'NAO_COMPARECEU') return agora >= inicio;
  if (para === 'EM_ATENDIMENTO' || para === 'CONCLUIDO') return agora.getTime() >= inicio.getTime() - 30 * 60_000;
  return true;
}
