export type StatusAgendamento =
  | 'AGUARDANDO_PAGAMENTO'
  | 'CONFIRMADO'
  | 'EM_ATENDIMENTO'
  | 'CONCLUIDO'
  | 'CANCELADO'
  | 'EXPIRADO'
  | 'NAO_COMPARECEU';

export const NOME_STATUS: Record<StatusAgendamento, string> = {
  AGUARDANDO_PAGAMENTO: 'Aguardando sinal',
  CONFIRMADO: 'Confirmado',
  EM_ATENDIMENTO: 'Em atendimento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
  NAO_COMPARECEU: 'Não compareceu',
};

// O que o botão faz, com o mesmo nome do status que ele gera
export const ACAO_STATUS: Partial<Record<StatusAgendamento, string>> = {
  CONFIRMADO: 'Confirmar sem Pix',
  EM_ATENDIMENTO: 'Iniciar atendimento',
  CONCLUIDO: 'Concluir',
  NAO_COMPARECEU: 'Marcar falta',
  CANCELADO: 'Cancelar',
};

export const COR_STATUS: Record<StatusAgendamento, 'verde' | 'cinza' | 'alerta' | 'neutro'> = {
  AGUARDANDO_PAGAMENTO: 'alerta',
  CONFIRMADO: 'verde',
  EM_ATENDIMENTO: 'neutro',
  CONCLUIDO: 'cinza',
  CANCELADO: 'cinza',
  EXPIRADO: 'cinza',
  NAO_COMPARECEU: 'alerta',
};

const fmtLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
export function formatarDataLonga(iso: string) {
  const t = fmtLongo.format(new Date(`${iso.slice(0, 10)}T12:00:00`));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const hora = (dataHora: string) => dataHora.slice(11, 16);
export const dia = (dataHora: string) => dataHora.slice(0, 10);

export interface ItemAgenda {
  id: string;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  proximosStatus: StatusAgendamento[];
  valorCentavos: number;
  origem: 'ONLINE' | 'PAINEL';
  observacao: string | null;
  servico: { id: string; nome: string };
  funcionario: { id: string; nome: string };
  cliente: { nome: string; telefone: string; email: string | null };
  // Fase 6 (RF28–RF33)
  sinal: { status: StatusPagamento; valorCentavos: number; pagoEm: string | null } | null;
  expiraSinalEm: string | null;
  restanteCentavos: number;
  respostasExtras: { rotulo: string; resposta: string }[]; // RF07
  formaPagamento: FormaPagamento | null; // RF47
  motivoCancelamento: string | null;
}

// RF47: como o cliente pagou o restante, informado ao concluir
export type FormaPagamento = 'PIX' | 'DINHEIRO' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'OUTRO';
export const NOME_FORMA: Record<FormaPagamento, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  OUTRO: 'Outro',
};

export type StatusPagamento = 'PENDENTE' | 'APROVADO' | 'CANCELADO' | 'RECEBIDO_APOS_EXPIRAR' | 'REEMBOLSO_PENDENTE' | 'REEMBOLSADO' | 'RETIDO';

export const NOME_SINAL: Record<StatusPagamento, string> = {
  PENDENTE: 'Sinal pendente',
  APROVADO: 'Sinal pago',
  CANCELADO: 'Pix cancelado',
  RECEBIDO_APOS_EXPIRAR: 'Pix pago após expirar',
  REEMBOLSO_PENDENTE: 'Devolução pendente',
  REEMBOLSADO: 'Sinal devolvido',
  RETIDO: 'Sinal retido',
};

export interface ColunaAgenda {
  id: string;
  nome: string;
  cargo?: string | null;
}

// "2026-10-14T09:30:00-03:00" → 570 (minutos desde a meia-noite, no fuso da empresa)
export const minutosDoDia = (dataHora: string) => Number(dataHora.slice(11, 13)) * 60 + Number(dataHora.slice(14, 16));

// ─── Situação visual (cor da agenda) ─────────────────────
// Junta status + sinal no que importa para quem olha a agenda. Cada uma tem uma cor que o
// admin pode trocar (Agenda → Regras e cores). A cor nunca é a única pista: o nome vai junto.

export type Situacao = 'AGUARDANDO' | 'SINAL_PAGO' | 'CONFIRMADO' | 'EM_ATENDIMENTO' | 'CONCLUIDO' | 'FALTA' | 'CANCELADO';
export const SITUACOES: Situacao[] = ['AGUARDANDO', 'SINAL_PAGO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'FALTA', 'CANCELADO'];

export const NOME_SITUACAO: Record<Situacao, string> = {
  AGUARDANDO: 'Aguardando sinal',
  SINAL_PAGO: 'Sinal pago',
  CONFIRMADO: 'Confirmado',
  EM_ATENDIMENTO: 'Em atendimento',
  CONCLUIDO: 'Concluído',
  FALTA: 'Não compareceu',
  CANCELADO: 'Cancelado',
};

export const CORES_PADRAO: Record<Situacao, string> = {
  AGUARDANDO: '#d9a21b',
  SINAL_PAGO: '#2f9e6e',
  CONFIRMADO: '#4a6fb0',
  EM_ATENDIMENTO: '#7c5cc4',
  CONCLUIDO: '#8f928f',
  FALTA: '#d0453f',
  CANCELADO: '#c9c8c3',
};

export function situacaoDe(a: Pick<ItemAgenda, 'status' | 'sinal'>): Situacao {
  switch (a.status) {
    case 'AGUARDANDO_PAGAMENTO':
      return 'AGUARDANDO';
    case 'CONFIRMADO':
      return a.sinal?.status === 'APROVADO' ? 'SINAL_PAGO' : 'CONFIRMADO';
    case 'EM_ATENDIMENTO':
      return 'EM_ATENDIMENTO';
    case 'CONCLUIDO':
      return 'CONCLUIDO';
    case 'NAO_COMPARECEU':
      return 'FALTA';
    default:
      return 'CANCELADO';
  }
}

// Fundo do bloco: a cor bem clarinha (mistura com branco); a barrinha usa a cor cheia
export function tom(hex: string, branco = 0.86) {
  const c = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - branco) + 255 * branco);
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`;
}

export interface VisualAgenda {
  cores: Record<Situacao, string>;
  coresPadrao: Record<Situacao, string>;
  metaMensalCentavos: number | null;
}
