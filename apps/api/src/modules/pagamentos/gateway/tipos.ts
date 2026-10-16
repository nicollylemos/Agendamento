// Fase 6 (RF29–RF32, RF37): o que o sistema precisa de qualquer gateway de Pix.
// Trocar de gateway = escrever outra implementação desta interface.

export type StatusGateway = 'pendente' | 'aprovado' | 'cancelado' | 'reembolsado' | 'recusado';

export interface NovaCobranca {
  valorCentavos: number;
  descricao: string;
  emailPagador: string;
  expiraEm: Date;
  idempotencyKey: string;
  referencia: string; // id do agendamento
  urlNotificacao?: string;
}

export interface Cobranca {
  gatewayPaymentId: string;
  copiaECola: string;
  qrBase64: string; // PNG em base64, sem o prefixo data:
}

export interface PagamentoGateway {
  gatewayPaymentId: string;
  status: StatusGateway;
  valorCentavos: number;
  moeda: string;
  referencia: string | null;
}

// Cabeçalhos e query do webhook, já separados do Express
export interface NotificacaoRecebida {
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
}

export type ResultadoAssinatura =
  | { ok: true; eventoId: string; gatewayPaymentId: string | null; tipo: string | null }
  | { ok: false; motivo: 'ASSINATURA_INVALIDA' | 'EVENTO_ANTIGO' | 'FORMATO_INVALIDO' };

export interface GatewayPix {
  criarCobranca(c: NovaCobranca): Promise<Cobranca>;
  consultar(gatewayPaymentId: string): Promise<PagamentoGateway>;
  cancelar(gatewayPaymentId: string): Promise<void>;
  reembolsar(gatewayPaymentId: string, idempotencyKey: string): Promise<void>;
  testarConexao(): Promise<{ ok: true; conta: string } | { ok: false; motivo: string }>;
  validarNotificacao(n: NotificacaoRecebida): ResultadoAssinatura;
}

export class ErroGateway extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// 9.3: eventos com mais de 5 minutos são recusados (evita replay de notificação antiga)
export const JANELA_WEBHOOK_MS = 5 * 60_000;
