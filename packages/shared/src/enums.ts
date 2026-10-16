export const PERFIS = ['ADMIN', 'GERENTE', 'FUNCIONARIO'] as const;
export type Perfil = (typeof PERFIS)[number];

export const STATUS_AGENDAMENTO = [
  'AGUARDANDO_PAGAMENTO',
  'CONFIRMADO',
  'EM_ATENDIMENTO',
  'CONCLUIDO',
  'CANCELADO',
  'EXPIRADO',
  'NAO_COMPARECEU',
] as const;
export type StatusAgendamento = (typeof STATUS_AGENDAMENTO)[number];
