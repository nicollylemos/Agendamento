import { DateTime } from 'luxon';
import { ErroGateway, type Cobranca, type GatewayPix, type NotificacaoRecebida, type NovaCobranca, type PagamentoGateway, type StatusGateway } from './tipos.js';
import { validarAssinaturaHmac } from './assinatura.js';

// RF29–RF32, RF37: integração com o Mercado Pago (API de pagamentos, Pix).
// Só HTTPS para api.mercadopago.com; o token nunca vai para log (9.3, RNF11).

const BASE = 'https://api.mercadopago.com';
const TEMPO_LIMITE_MS = 10_000;

const STATUS: Record<string, StatusGateway> = {
  pending: 'pendente',
  in_process: 'pendente',
  authorized: 'pendente',
  approved: 'aprovado',
  cancelled: 'cancelado',
  refunded: 'reembolsado',
  charged_back: 'reembolsado',
  rejected: 'recusado',
};

interface RespostaPagamento {
  id: number | string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
}

export class MercadoPago implements GatewayPix {
  constructor(
    private readonly token: string,
    private readonly segredoWebhook: string,
  ) {}

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown, idempotencyKey?: string): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${BASE}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey && { 'X-Idempotency-Key': idempotencyKey }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        redirect: 'error',
      });
    } catch {
      throw new ErroGateway('Sem resposta do Mercado Pago');
    }
    if (!r.ok) {
      // Não repassa o corpo do erro: pode conter dados do pagador
      throw new ErroGateway(`Mercado Pago respondeu ${r.status}`, r.status);
    }
    return (await r.json()) as T;
  }

  async criarCobranca(c: NovaCobranca): Promise<Cobranca> {
    const r = await this.chamar<RespostaPagamento>(
      'POST',
      '/v1/payments',
      {
        transaction_amount: c.valorCentavos / 100,
        description: c.descricao.slice(0, 200),
        payment_method_id: 'pix',
        payer: { email: c.emailPagador },
        date_of_expiration: DateTime.fromJSDate(c.expiraEm).setZone('America/Sao_Paulo').toFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZZ"),
        external_reference: c.referencia,
        ...(c.urlNotificacao && { notification_url: c.urlNotificacao }),
      },
      c.idempotencyKey,
    );
    const dados = r.point_of_interaction?.transaction_data;
    if (!dados?.qr_code || !dados.qr_code_base64) throw new ErroGateway('Mercado Pago não devolveu o QR Code');
    return { gatewayPaymentId: String(r.id), copiaECola: dados.qr_code, qrBase64: dados.qr_code_base64 };
  }

  async consultar(id: string): Promise<PagamentoGateway> {
    if (!/^\d{1,20}$/.test(id)) throw new ErroGateway('Id de pagamento inválido');
    const r = await this.chamar<RespostaPagamento>('GET', `/v1/payments/${id}`);
    return {
      gatewayPaymentId: String(r.id),
      status: STATUS[r.status] ?? 'pendente',
      valorCentavos: Math.round(r.transaction_amount * 100),
      moeda: r.currency_id,
      referencia: r.external_reference ?? null,
    };
  }

  async cancelar(id: string) {
    await this.chamar('PUT', `/v1/payments/${id}`, { status: 'cancelled' });
  }

  async reembolsar(id: string, idempotencyKey: string) {
    await this.chamar('POST', `/v1/payments/${id}/refunds`, {}, idempotencyKey);
  }

  async testarConexao() {
    try {
      const r = await this.chamar<{ id: number; nickname?: string; site_id?: string }>('GET', '/users/me');
      if (r.site_id && r.site_id !== 'MLB') return { ok: false as const, motivo: 'A conta não é do Mercado Pago Brasil' };
      return { ok: true as const, conta: r.nickname ?? String(r.id) };
    } catch (e) {
      const status = e instanceof ErroGateway ? e.status : undefined;
      return { ok: false as const, motivo: status === 401 || status === 403 ? 'Token recusado pelo Mercado Pago' : 'Não foi possível falar com o Mercado Pago' };
    }
  }

  validarNotificacao(n: NotificacaoRecebida) {
    return validarAssinaturaHmac(this.segredoWebhook, n);
  }
}
