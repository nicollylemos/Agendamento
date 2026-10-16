import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { ErroGateway, type Cobranca, type GatewayPix, type NotificacaoRecebida, type NovaCobranca, type PagamentoGateway } from './tipos.js';
import { assinar, validarAssinaturaHmac } from './assinatura.js';

// Gateway de mentira para desenvolvimento e testes: gera um Pix que não vale dinheiro.
// O pagamento é "feito" pelo botão de simulação (só fora de produção), que manda
// um webhook assinado igual ao do Mercado Pago. Recusado em produção.

interface Registro {
  valorCentavos: number;
  status: PagamentoGateway['status'];
  referencia: string;
}

const pagamentos = new Map<string, Registro>();

export class Simulado implements GatewayPix {
  constructor(private readonly segredoWebhook: string) {}

  async criarCobranca(c: NovaCobranca): Promise<Cobranca> {
    const id = `sim${randomUUID().replaceAll('-', '')}`;
    pagamentos.set(id, { valorCentavos: c.valorCentavos, status: 'pendente', referencia: c.referencia });
    const copiaECola = `00020126SIMULADO-SEM-VALOR-${id}5204000053039865406${(c.valorCentavos / 100).toFixed(2)}5802BR6304TEST`;
    const png = await QRCode.toDataURL(copiaECola, { margin: 1, width: 240 });
    return { gatewayPaymentId: id, copiaECola, qrBase64: png.replace(/^data:image\/png;base64,/, '') };
  }

  async consultar(id: string): Promise<PagamentoGateway> {
    const p = pagamentos.get(id);
    if (!p) throw new ErroGateway('Pagamento simulado não encontrado (a API reiniciou?)', 404);
    return { gatewayPaymentId: id, status: p.status, valorCentavos: p.valorCentavos, moeda: 'BRL', referencia: p.referencia };
  }

  async cancelar(id: string) {
    const p = pagamentos.get(id);
    if (p && p.status === 'pendente') p.status = 'cancelado';
  }

  async reembolsar(id: string) {
    const p = pagamentos.get(id);
    if (!p || p.status !== 'aprovado') throw new ErroGateway('Só dá para reembolsar pagamento aprovado');
    p.status = 'reembolsado';
  }

  async testarConexao() {
    return { ok: true as const, conta: 'Gateway simulado (sem dinheiro de verdade)' };
  }

  validarNotificacao(n: NotificacaoRecebida) {
    return validarAssinaturaHmac(this.segredoWebhook, n);
  }

  // Só para o botão "simular pagamento" e para os testes
  pagar(id: string, valorCentavos?: number) {
    const p = pagamentos.get(id);
    if (!p) throw new ErroGateway('Pagamento simulado não encontrado', 404);
    // Pix pago depois de cancelado/expirado também acontece na vida real
    p.status = 'aprovado';
    if (valorCentavos !== undefined) p.valorCentavos = valorCentavos;
  }

  notificacaoAssinada(id: string, agora = Date.now()): NotificacaoRecebida {
    const ts = String(Math.floor(agora / 1000));
    const requestId = randomUUID();
    return {
      headers: { 'x-signature': `ts=${ts},v1=${assinar(this.segredoWebhook, id.toLowerCase(), requestId, ts)}`, 'x-request-id': requestId },
      query: { 'data.id': id, type: 'payment' },
      body: { id: randomUUID(), type: 'payment', action: 'payment.updated', data: { id } },
    };
  }
}
