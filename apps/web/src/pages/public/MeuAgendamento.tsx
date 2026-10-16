import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { formatarDataLonga, NOME_STATUS, type StatusAgendamento } from '../../lib/agenda';
import { hojeISO } from '../../lib/horarios';
import { LayoutPublico, linkWhatsapp } from '../../layouts/LayoutPublico';
import { SeletorHorario } from '../../components/agenda/SeletorHorario';
import { Aviso, Botao, Carregando, Selo } from '../../components/ui';
import { PixSinal } from '../../components/pagamento/PixSinal';

// RF25: o cliente vê, remarca ou cancela pelo link do e-mail

interface Detalhe {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  valorCentavos: number;
  servico: { id: string; nome: string };
  profissional: { id: string; nome: string };
  podeCancelar: boolean;
  podeReagendar: boolean;
  prazoCancelamentoHoras: number;
  prazoReagendamentoHoras: number;
  politicaCancelamento: string | null;
  contato: string | null;
  sinalCentavos: number;
  sinalStatus: string | null;
  reembolsoAteHoras: number;
  pix: { status: string; valorCentavos: number; copiaECola?: string | null; qrBase64?: string | null; expiraEm?: string } | null;
}

// RF32: o que aconteceu com o sinal, em palavras
const TEXTO_SINAL: Record<string, string> = {
  APROVADO: 'Sinal pago',
  REEMBOLSADO: 'Sinal devolvido',
  REEMBOLSO_PENDENTE: 'Devolução do sinal em andamento',
  RETIDO: 'Sinal retido (cancelamento fora do prazo de devolução)',
  RECEBIDO_APOS_EXPIRAR: 'Pagamento recebido depois do prazo: será devolvido',
};

export function MeuAgendamento() {
  const [params] = useSearchParams();
  // O token sai da barra de endereço assim que a página abre (não fica no histórico)
  const token = useMemo(() => {
    const t = params.get('token');
    if (t) window.history.replaceState(null, '', window.location.pathname);
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const qc = useQueryClient();
  const detalhe = useQuery({
    enabled: Boolean(token),
    queryKey: ['meu-agendamento', token],
    queryFn: () => api<Detalhe>('/public/agendamentos/consultar', { method: 'POST', body: { token }, semRenovar: true }),
    retry: false,
  });
  const [modo, setModo] = useState<'ver' | 'remarcar' | 'cancelar'>('ver');
  const [data, setData] = useState(hojeISO());
  const [horario, setHorario] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
      setAviso(sucesso);
      setModo('ver');
      await qc.invalidateQueries({ queryKey: ['meu-agendamento', token] });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Sem conexão. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  if (!token || detalhe.error) {
    return (
      <LayoutPublico>
        <h1 className="text-2xl font-semibold tracking-tight">Link inválido</h1>
        <p className="mt-2 text-tinta-suave">Abra o link do e-mail de confirmação, ou veja seus agendamentos com um código.</p>
        <Link to="/meus-agendamentos" className="mt-6 inline-block font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
          Ver meus agendamentos
        </Link>
      </LayoutPublico>
    );
  }
  if (!detalhe.data) return <LayoutPublico><Carregando /></LayoutPublico>;

  const d = detalhe.data;

  return (
    <LayoutPublico>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Seu agendamento</h1>
          <Selo cor={d.status === 'CONFIRMADO' ? 'verde' : 'cinza'}>{NOME_STATUS[d.status]}</Selo>
        </div>
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso>{erro}</Aviso>}

        <dl className="grid gap-3 rounded-lg border border-borda bg-superficie p-5 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="text-tinta-suave">Serviço</dt>
          <dd className="font-medium">{d.servico.nome}</dd>
          <dt className="text-tinta-suave">Com</dt>
          <dd className="font-medium">{d.profissional.nome}</dd>
          <dt className="text-tinta-suave">Quando</dt>
          <dd className="font-medium">
            {formatarDataLonga(d.inicio)}, às {d.inicio.slice(11, 16)}
          </dd>
          <dt className="text-tinta-suave">Valor</dt>
          <dd className="font-medium">{formatarCentavos(d.valorCentavos)}</dd>
          {d.sinalCentavos > 0 && (
            <>
              <dt className="text-tinta-suave">Sinal</dt>
              <dd className="font-medium">
                {formatarCentavos(d.sinalCentavos)}
                {d.sinalStatus && TEXTO_SINAL[d.sinalStatus] && <span className="font-normal text-tinta-suave"> · {TEXTO_SINAL[d.sinalStatus]}</span>}
              </dd>
            </>
          )}
        </dl>

        {/* RF29: voltou pelo link antes de pagar */}
        {modo === 'ver' && d.status === 'AGUARDANDO_PAGAMENTO' && d.pix?.expiraEm && (
          <PixSinal
            token={token}
            pix={{ copiaECola: d.pix.copiaECola ?? null, qrBase64: d.pix.qrBase64 ?? null, valorCentavos: d.pix.valorCentavos, expiraEm: d.pix.expiraEm }}
            aoMudar={() => qc.invalidateQueries({ queryKey: ['meu-agendamento', token] })}
          />
        )}

        {modo === 'ver' && (
          <div className="grid gap-3">
            {(d.podeReagendar || d.podeCancelar) && (
              <div className="flex flex-wrap gap-2">
                {d.podeReagendar && (
                  <Botao variante="secundario" onClick={() => (setAviso(null), setModo('remarcar'))}>
                    Remarcar
                  </Botao>
                )}
                {d.podeCancelar && (
                  <Botao variante="perigo" onClick={() => (setAviso(null), setModo('cancelar'))}>
                    Cancelar agendamento
                  </Botao>
                )}
              </div>
            )}
            {['CONFIRMADO', 'AGUARDANDO_PAGAMENTO'].includes(d.status) && !d.podeCancelar && (
              <p className="text-sm text-tinta-suave">
                Pelo site, dá para cancelar até {d.prazoCancelamentoHoras} h antes.{' '}
                {d.contato && (
                  <a href={linkWhatsapp(d.contato)} target="_blank" rel="noopener noreferrer" className="font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
                    Fale com a gente
                  </a>
                )}
              </p>
            )}
          </div>
        )}

        {modo === 'cancelar' && (
          <div className="grid gap-4 rounded-lg border border-borda bg-superficie p-5">
            <p className="font-semibold">Cancelar este agendamento?</p>
            {d.politicaCancelamento && <p className="text-sm text-tinta-suave">{d.politicaCancelamento}</p>}
            {d.sinalStatus === 'APROVADO' && (
              <p className="text-sm text-tinta-suave">
                O sinal é devolvido se você cancelar com pelo menos {d.reembolsoAteHoras} h de antecedência. Depois disso, fica com a empresa.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Botao
                variante="perigo"
                carregando={enviando}
                onClick={() =>
                  executar(async () => {
                    const r = await api<{ sinal: string | null }>('/public/agendamentos/cancelar', { method: 'POST', body: { token }, semRenovar: true });
                    if (r.sinal === 'reembolsado') setTimeout(() => setAviso('Agendamento cancelado. O sinal foi devolvido para a conta que pagou.'));
                    if (r.sinal === 'retido') setTimeout(() => setAviso('Agendamento cancelado. Pelo prazo, o sinal fica com a empresa.'));
                  }, 'Agendamento cancelado.')
                }
              >
                Cancelar agendamento
              </Botao>
              <Botao variante="fantasma" onClick={() => setModo('ver')}>
                Manter
              </Botao>
            </div>
          </div>
        )}

        {modo === 'remarcar' && (
          <div className="grid gap-6">
            <SeletorHorario
              servicoId={d.servico.id}
              funcionarioId={d.profissional.id}
              data={data}
              aoMudarData={(x) => (setData(x), setHorario(null))}
              horario={horario}
              aoMudarHorario={setHorario}
            />
            <div className="flex flex-wrap gap-2">
              <Botao
                disabled={!horario}
                carregando={enviando}
                onClick={() =>
                  executar(
                    () => api('/public/agendamentos/reagendar', { method: 'POST', body: { token, data, horario }, semRenovar: true }),
                    'Agendamento remarcado.',
                  )
                }
              >
                Remarcar para {horario ?? 'o horário escolhido'}
              </Botao>
              <Botao variante="fantasma" onClick={() => setModo('ver')}>
                Voltar
              </Botao>
            </div>
          </div>
        )}
      </div>
    </LayoutPublico>
  );
}
