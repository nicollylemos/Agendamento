import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, FlaskConical, Timer } from 'lucide-react';
import { api } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { Aviso, Botao } from '../ui';

// RF29: QR Code + copia e cola + contador. RF30: confirma sozinho quando o webhook chega.

export interface DadosPix {
  copiaECola: string | null;
  qrBase64: string | null;
  valorCentavos: number;
  expiraEm: string;
}

interface StatusSinal {
  status: string;
  sinalStatus: string | null;
}

function restante(expiraEm: string) {
  return Math.max(0, Math.floor((new Date(expiraEm).getTime() - Date.now()) / 1000));
}

export function PixSinal({ token, pix, aoMudar }: { token: string; pix: DadosPix; aoMudar: (status: string) => void }) {
  const [segundos, setSegundos] = useState(() => restante(pix.expiraEm));
  const [copiado, setCopiado] = useState(false);
  const [simulando, setSimulando] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setSegundos(restante(pix.expiraEm)), 1000);
    return () => clearInterval(t);
  }, [pix.expiraEm]);

  // Pergunta a cada 5 s se o pagamento caiu (para quando sai da tela ou o prazo acaba)
  const status = useQuery({
    queryKey: ['status-sinal', token],
    queryFn: () => api<StatusSinal>('/public/agendamentos/status-sinal', { method: 'POST', body: { token }, semRenovar: true }),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'AGUARDANDO_PAGAMENTO' ? false : 5000),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (status.data && status.data.status !== 'AGUARDANDO_PAGAMENTO') aoMudar(status.data.status);
  }, [status.data, aoMudar]);

  async function copiar() {
    if (!pix.copiaECola) return;
    try {
      await navigator.clipboard.writeText(pix.copiaECola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* o campo de texto continua lá para copiar na mão */
    }
  }

  async function simular() {
    setSimulando(true);
    try {
      await api('/public/agendamentos/simular-pix', { method: 'POST', body: { token }, semRenovar: true });
      await status.refetch();
    } finally {
      setSimulando(false);
    }
  }

  const mm = String(Math.floor(segundos / 60)).padStart(2, '0');
  const ss = String(segundos % 60).padStart(2, '0');
  const acabou = segundos === 0;

  return (
    <div className="grid gap-5 rounded-lg border border-borda bg-superficie p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-tinta-suave">Sinal para confirmar</p>
          <p className="text-2xl font-semibold">{formatarCentavos(pix.valorCentavos)}</p>
        </div>
        <p className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold tabular-nums ${acabou ? 'bg-erro-claro text-erro' : 'bg-alerta-claro text-alerta'}`} role="timer" aria-live="off">
          <Timer className="size-4" aria-hidden />
          {acabou ? 'Prazo encerrado' : `${mm}:${ss}`}
        </p>
      </div>

      {acabou ? (
        <Aviso tipo="alerta">O prazo para pagar acabou. Se você já pagou, aguarde um instante: confirmamos assim que o banco avisar.</Aviso>
      ) : (
        <>
          {pix.qrBase64 && (
            <img src={`data:image/png;base64,${pix.qrBase64}`} alt="QR Code do Pix" className="mx-auto size-56 rounded-md border border-borda bg-white p-2" />
          )}
          <div className="grid gap-2">
            <label htmlFor="pix-copia" className="text-sm font-medium">
              Pix copia e cola
            </label>
            <textarea
              id="pix-copia"
              readOnly
              rows={3}
              value={pix.copiaECola ?? ''}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-none border border-borda-campo rounded-md bg-fundo px-3 py-2 font-mono text-xs break-all"
            />
            <Botao type="button" onClick={copiar}>
              {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copiado ? 'Código copiado' : 'Copiar código Pix'}
            </Botao>
          </div>
          <p className="text-sm text-tinta-suave">
            Abra o app do seu banco, escolha Pix e use o QR Code ou o código. Esta tela confirma sozinha quando o pagamento cair.
          </p>
        </>
      )}

      {import.meta.env.DEV && pix.copiaECola?.includes('SIMULADO') && !acabou && (
        <Botao type="button" variante="secundario" carregando={simulando} onClick={simular}>
          <FlaskConical className="size-4" aria-hidden />
          Simular pagamento (só em teste)
        </Botao>
      )}
    </div>
  );
}
