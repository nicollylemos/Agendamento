import { createHmac } from 'node:crypto';
import { iguaisSemVazarTempo } from '../../../lib/crypto.js';
import { JANELA_WEBHOOK_MS, type NotificacaoRecebida, type ResultadoAssinatura } from './tipos.js';

// Formato de assinatura do Mercado Pago (o gateway simulado usa o mesmo, para o
// caminho de validação ser exercitado em desenvolvimento e nos testes):
//   x-signature: ts=<epoch>,v1=<hmac-sha256 hex>
//   manifesto:   id:<data.id>;request-id:<x-request-id>;ts:<ts>;

export function manifesto(dataId: string, requestId: string, ts: string) {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

export function assinar(segredo: string, dataId: string, requestId: string, ts: string) {
  return createHmac('sha256', segredo).update(manifesto(dataId, requestId, ts)).digest('hex');
}

export function validarAssinaturaHmac(segredo: string, n: NotificacaoRecebida, agora = Date.now()): ResultadoAssinatura {
  const cabecalho = n.headers['x-signature'];
  const requestId = n.headers['x-request-id'];
  const corpo = (n.body ?? {}) as { id?: unknown; type?: unknown; action?: unknown; data?: { id?: unknown } };
  const bruto = n.query['data.id'] ?? (corpo.data?.id != null ? String(corpo.data.id) : undefined);
  if (!cabecalho || !requestId || !bruto || bruto.length > 64) return { ok: false, motivo: 'FORMATO_INVALIDO' };
  // O Mercado Pago assina o id em minúsculas quando ele é alfanumérico
  const dataId = /^[a-z0-9]+$/i.test(bruto) ? bruto.toLowerCase() : bruto;

  const partes = Object.fromEntries(
    cabecalho.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1 || !/^\d{10,13}$/.test(ts) || !/^[a-f0-9]{64}$/.test(v1)) return { ok: false, motivo: 'FORMATO_INVALIDO' };

  if (!iguaisSemVazarTempo(assinar(segredo, dataId, requestId, ts), v1)) return { ok: false, motivo: 'ASSINATURA_INVALIDA' };

  const tsMs = ts.length > 10 ? Number(ts) : Number(ts) * 1000;
  if (Math.abs(agora - tsMs) > JANELA_WEBHOOK_MS) return { ok: false, motivo: 'EVENTO_ANTIGO' };

  const eventoId = corpo.id != null ? String(corpo.id).slice(0, 100) : `${requestId}`.slice(0, 100);
  const tipo = typeof corpo.type === 'string' ? corpo.type : typeof corpo.action === 'string' ? corpo.action : null;
  return { ok: true, eventoId, gatewayPaymentId: bruto, tipo };
}
