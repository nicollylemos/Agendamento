import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, KeyRound, PlugZap, Power, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { formatarDataLonga } from '../../lib/agenda';
import { useSalvar } from '../../lib/useSalvar';
import { useReautenticacao } from '../../components/Reautenticar';
import { EntradaMoeda } from '../../components/EntradaMoeda';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Entrada, Interruptor, Secao, Selecao, Selo, cx } from '../../components/ui';

// RF28 (regra do sinal), RF32 (devolução), RF34–RF37 (recebedor), 9.1 (reautenticação), 9.3 (só os 4 últimos)

interface ConfigSinal {
  sinalExige: boolean;
  sinalTipo: 'FIXO' | 'PERCENTUAL';
  sinalValor: number;
  sinalPrazoMin: number;
  reembolsoAteHoras: number;
  reembolsoAutomaticoAposExpirar: boolean;
}

type TipoChave = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA';
type Gateway = 'MERCADO_PAGO' | 'SIMULADO';

interface Recebedor {
  nome: string;
  tipoChave: TipoChave;
  banco: string | null;
  gateway: Gateway;
  finalDocumento: string;
  finalChave: string;
  finalToken: string | null;
  finalSegredo: string | null;
  testadoEm: string | null;
  ativo: boolean;
}

interface Situacao {
  recebedorAtivo: boolean;
  exigeAlgum: boolean;
  semCobrar: boolean;
  precisamAtencao: number;
  urlWebhook: string;
}

interface PagamentoAtencao {
  id: string;
  status: 'RECEBIDO_APOS_EXPIRAR' | 'REEMBOLSO_PENDENTE';
  valorCentavos: number;
  valorPagoCentavos: number | null;
  pagoEm: string | null;
  agendamento: { inicio: string; cliente: string; servico: string };
}

const TIPOS_CHAVE: Record<TipoChave, string> = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail', TELEFONE: 'Celular', ALEATORIA: 'Chave aleatória' };
const PRAZOS = [10, 15, 20, 30, 45, 60, 120, 240, 720, 1440];
const prazoTexto = (m: number) => (m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : `${m / 60} horas`);

export function Pagamentos() {
  const qc = useQueryClient();
  const situacao = useQuery({ queryKey: ['pagamentos-situacao'], queryFn: () => api<Situacao>('/admin/pagamentos/situacao') });
  const reauth = useReautenticacao();
  const atualizar = () => ['pagamentos-situacao', 'recebedor', 'config-sinal', 'pagamentos-atencao', 'servicos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  return (
    <>
      <Cabecalho titulo="Sinal e Pix" descricao="Quanto cobrar para garantir o horário e quem recebe o dinheiro." />

      {situacao.data?.semCobrar && (
        <div className="mb-6">
          <Aviso tipo="alerta">
            O sinal está ligado, mas o recebedor não está ativo. Enquanto isso, os agendamentos entram confirmados sem cobrar nada.
          </Aviso>
        </div>
      )}

      <div>
        <Secao titulo="Regra do sinal" descricao="Vale para todos os serviços, a não ser que o serviço tenha uma regra própria.">
          <FormRegra pedirReauth={reauth.pedir} aoSalvar={atualizar} />
        </Secao>
        <Secao titulo="Quem recebe" descricao="Os dados ficam cifrados. Depois de salvos, só aparecem os 4 últimos caracteres.">
          <BlocoRecebedor pedirReauth={reauth.pedir} aoMudar={atualizar} />
        </Secao>
        {Boolean(situacao.data?.precisamAtencao) && (
          <Secao titulo="Precisam de atenção" descricao="Pix pagos depois do prazo ou devoluções que o gateway não conseguiu fazer.">
            <ListaAtencao pedirReauth={reauth.pedir} aoMudar={atualizar} />
          </Secao>
        )}
      </div>
      {reauth.modal}
    </>
  );
}

type PedirReauth = (motivo: string) => Promise<string | null>;

function FormRegra({ pedirReauth, aoSalvar }: { pedirReauth: PedirReauth; aoSalvar: () => void }) {
  const config = useQuery({ queryKey: ['config-sinal'], queryFn: () => api<ConfigSinal>('/admin/pagamentos/config') });
  const { salvando, erro, campos, salvo, executar } = useSalvar();
  const [d, setD] = useState<ConfigSinal | null>(null);
  useEffect(() => {
    if (config.data) setD(config.data);
  }, [config.data]);
  if (!d) return <Carregando />;
  const set = (p: Partial<ConfigSinal>) => setD({ ...d, ...p });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const token = await pedirReauth('Para mudar a regra do sinal');
    if (!token) return;
    const ok = await executar(() => api('/admin/pagamentos/config', { method: 'PUT', body: d, headers: { 'X-Reauth-Token': token } }).then(() => true));
    if (ok) aoSalvar();
  }

  const exemplo = d.sinalTipo === 'PERCENTUAL' ? Math.max(100, Math.round((10000 * d.sinalValor) / 10_000)) : d.sinalValor;

  return (
    <form onSubmit={salvar} className="grid grid-cols-1 gap-5 rounded-lg border border-borda bg-superficie p-5">
      {erro && <Aviso>{erro}</Aviso>}
      {salvo && <Aviso tipo="sucesso">Regra salva.</Aviso>}
      <Interruptor ligado={d.sinalExige} aoMudar={(v) => set({ sinalExige: v })} rotulo="Cobrar sinal para agendar pelo site" />

      <fieldset className={cx('grid gap-5', !d.sinalExige && 'opacity-60')}>
        <legend className="sr-only">Valor do sinal</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de sinal">
          {(
            [
              ['PERCENTUAL', 'Porcentagem do valor'],
              ['FIXO', 'Valor fixo'],
            ] as const
          ).map(([tipo, rotulo]) => (
            <button
              key={tipo}
              type="button"
              role="radio"
              aria-checked={d.sinalTipo === tipo}
              onClick={() => set({ sinalTipo: tipo, sinalValor: tipo === 'PERCENTUAL' ? 3000 : 2000 })}
              className={cx(
                'h-10 rounded-md border px-4 text-sm font-medium',
                d.sinalTipo === tipo ? 'border-destaque bg-destaque-claro text-destaque-forte' : 'border-borda bg-superficie text-tinta-suave hover:text-tinta',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {d.sinalTipo === 'PERCENTUAL' ? (
            <Campo rotulo="Porcentagem" dica={`Num serviço de R$ 100, o sinal é ${formatarCentavos(exemplo)}.`} erro={campos.sinalValor}>
              {(id, desc) => (
                <div className="flex items-center gap-2">
                  <div className="w-28 shrink-0"><Entrada
                    id={id}
                    aria-describedby={desc}
                    type="number"
                    min={1}
                    max={100}
                   
                    value={d.sinalValor / 100}
                    onChange={(e) => set({ sinalValor: Math.round(Number(e.target.value) * 100) })}
                  /></div>
                  <span className="text-tinta-suave">%</span>
                </div>
              )}
            </Campo>
          ) : (
            <Campo rotulo="Valor do sinal" dica="Se o serviço custar menos, cobra o valor do serviço." erro={campos.sinalValor}>
              {(id, desc) => <EntradaMoeda id={id} aria-describedby={desc} valor={d.sinalValor} aoMudar={(v) => set({ sinalValor: v ?? 0 })} />}
            </Campo>
          )}
          <Campo rotulo="Prazo para pagar" dica="Depois disso a reserva expira e o horário volta a ficar livre.">
            {(id, desc) => (
              <Selecao id={id} aria-describedby={desc} value={d.sinalPrazoMin} onChange={(e) => set({ sinalPrazoMin: Number(e.target.value) })}>
                {PRAZOS.map((m) => (
                  <option key={m} value={m}>
                    {prazoTexto(m)}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
        </div>
      </fieldset>

      <div className="grid gap-4 border-t border-borda pt-5">
        <p className="font-semibold">Devolução</p>
        <Campo rotulo="Devolver o sinal se o cliente cancelar com pelo menos" erro={campos.reembolsoAteHoras}>
          {(id) => (
            <div className="flex items-center gap-2">
              <div className="w-28 shrink-0"><Entrada id={id} type="number" min={0} max={720} value={d.reembolsoAteHoras} onChange={(e) => set({ reembolsoAteHoras: Number(e.target.value) })} /></div>
              <span className="text-tinta-suave">horas de antecedência</span>
            </div>
          )}
        </Campo>
        <Interruptor
          ligado={d.reembolsoAutomaticoAposExpirar}
          aoMudar={(v) => set({ reembolsoAutomaticoAposExpirar: v })}
          rotulo="Devolver sozinho o Pix pago depois que a reserva expirou"
        />
      </div>

      <Botao type="submit" carregando={salvando} className="sm:justify-self-start">
        Salvar regra
      </Botao>
    </form>
  );
}

function BlocoRecebedor({ pedirReauth, aoMudar }: { pedirReauth: PedirReauth; aoMudar: () => void }) {
  const recebedor = useQuery({ queryKey: ['recebedor'], queryFn: () => api<Recebedor | null>('/admin/pagamentos/recebedor') });
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso' | 'alerta'; texto: string } | null>(null);
  const [testando, setTestando] = useState(false);
  const [mudandoAtivo, setMudandoAtivo] = useState(false);

  if (recebedor.isLoading) return <Carregando />;
  const r = recebedor.data;

  if (!r || editando) {
    return (
      <FormRecebedor
        atual={r ?? null}
        pedirReauth={pedirReauth}
        aoCancelar={r ? () => setEditando(false) : undefined}
        aoSalvar={() => {
          setEditando(false);
          setAviso({ tipo: 'sucesso', texto: 'Salvo. Agora teste a conexão e ative. Os admins receberam um e-mail de alerta.' });
          aoMudar();
        }}
      />
    );
  }

  async function testar() {
    setAviso(null);
    setTestando(true);
    try {
      const t = await api<{ ok: boolean; conta?: string; motivo?: string }>('/admin/pagamentos/recebedor/testar', { method: 'POST' });
      setAviso(t.ok ? { tipo: 'sucesso', texto: `Conexão funcionando: ${t.conta}.` } : { tipo: 'erro', texto: t.motivo ?? 'Falhou.' });
      aoMudar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Sem conexão com o servidor.' });
    } finally {
      setTestando(false);
    }
  }

  async function alternarAtivo() {
    const token = await pedirReauth(r!.ativo ? 'Para parar de cobrar o sinal' : 'Para começar a cobrar o sinal');
    if (!token) return;
    setAviso(null);
    setMudandoAtivo(true);
    try {
      await api('/admin/pagamentos/recebedor/ativo', { method: 'POST', body: { ativo: !r!.ativo }, headers: { 'X-Reauth-Token': token } });
      setAviso({ tipo: 'sucesso', texto: r!.ativo ? 'Cobrança do sinal desligada.' : 'Pronto: os próximos agendamentos já cobram o sinal.' });
      aoMudar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Sem conexão com o servidor.' });
    } finally {
      setMudandoAtivo(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-borda bg-superficie p-5">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{r.nome}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {r.ativo ? <Selo cor="verde">Ativo: cobrando sinal</Selo> : <Selo cor="cinza">Desativado</Selo>}
            {r.gateway === 'SIMULADO' ? <Selo cor="alerta">Gateway simulado (teste)</Selo> : <Selo>Mercado Pago</Selo>}
            {r.testadoEm ? <Selo cor="verde">Conexão testada</Selo> : <Selo cor="alerta">Falta testar</Selo>}
          </div>
        </div>
        <Botao variante="secundario" onClick={() => (setAviso(null), setEditando(true))}>
          <KeyRound className="size-4" aria-hidden />
          Alterar dados
        </Botao>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
        <dt className="text-tinta-suave">CPF/CNPJ</dt>
        <dd className="font-mono">•••• {r.finalDocumento}</dd>
        <dt className="text-tinta-suave">Chave Pix ({TIPOS_CHAVE[r.tipoChave]})</dt>
        <dd className="font-mono">•••• {r.finalChave}</dd>
        {r.banco && (
          <>
            <dt className="text-tinta-suave">Banco</dt>
            <dd>{r.banco}</dd>
          </>
        )}
        {r.finalToken && (
          <>
            <dt className="text-tinta-suave">Access token</dt>
            <dd className="font-mono">•••• {r.finalToken}</dd>
          </>
        )}
        {r.finalSegredo && (
          <>
            <dt className="text-tinta-suave">Assinatura do webhook</dt>
            <dd className="font-mono">•••• {r.finalSegredo}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-borda pt-4">
        <Botao variante="secundario" carregando={testando} onClick={testar}>
          <PlugZap className="size-4" aria-hidden />
          Testar conexão
        </Botao>
        <Botao variante={r.ativo ? 'perigo' : 'primario'} carregando={mudandoAtivo} disabled={!r.ativo && !r.testadoEm} onClick={alternarAtivo}>
          <Power className="size-4" aria-hidden />
          {r.ativo ? 'Desativar cobrança' : 'Ativar cobrança'}
        </Botao>
      </div>
      {!r.ativo && !r.testadoEm && <p className="text-sm text-tinta-suave">Para ativar, primeiro teste a conexão com o gateway.</p>}
    </div>
  );
}

function FormRecebedor({
  atual,
  pedirReauth,
  aoSalvar,
  aoCancelar,
}: {
  atual: Recebedor | null;
  pedirReauth: PedirReauth;
  aoSalvar: () => void;
  aoCancelar?: () => void;
}) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [d, setD] = useState({
    nome: atual?.nome ?? '',
    documento: '',
    tipoChave: atual?.tipoChave ?? ('CNPJ' as TipoChave),
    chave: '',
    banco: atual?.banco ?? '',
    gateway: atual?.gateway ?? ('MERCADO_PAGO' as Gateway),
    tokenGateway: '',
    segredoWebhook: '',
  });
  const set = (p: Partial<typeof d>) => setD({ ...d, ...p });
  const manter = (final?: string | null) => (final ? `•••• ${final} (em branco = manter)` : undefined);
  const situacao = useQuery({ queryKey: ['pagamentos-situacao'], queryFn: () => api<Situacao>('/admin/pagamentos/situacao') });
  const webhook = situacao.data?.urlWebhook ?? '';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const token = await pedirReauth('Para alterar quem recebe o sinal');
    if (!token) return;
    const ok = await executar(() => api('/admin/pagamentos/recebedor', { method: 'PUT', body: d, headers: { 'X-Reauth-Token': token } }).then(() => true));
    if (ok) aoSalvar();
  }

  return (
    <form onSubmit={salvar} className="grid grid-cols-1 gap-5 rounded-lg border border-borda bg-superficie p-5" autoComplete="off">
      <p className="flex items-start gap-2 text-sm text-tinta-suave">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-destaque" aria-hidden />
        Ao salvar, pedimos sua senha de novo, registramos a alteração e avisamos todos os administradores por e-mail.
      </p>
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nome ou razão social" erro={campos.nome}>
        {(id) => <Entrada id={id} required minLength={2} maxLength={120} value={d.nome} onChange={(e) => set({ nome: e.target.value })} />}
      </Campo>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo rotulo="CPF ou CNPJ" erro={campos.documento}>
          {(id) => (
            <Entrada id={id} required={!atual} inputMode="numeric" maxLength={20} placeholder={manter(atual?.finalDocumento)} value={d.documento} onChange={(e) => set({ documento: e.target.value })} />
          )}
        </Campo>
        <Campo rotulo="Banco (opcional)" erro={campos.banco}>
          {(id) => <Entrada id={id} maxLength={80} value={d.banco} onChange={(e) => set({ banco: e.target.value })} />}
        </Campo>
      </div>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <Campo rotulo="Tipo de chave Pix">
          {(id) => (
            <Selecao id={id} value={d.tipoChave} onChange={(e) => set({ tipoChave: e.target.value as TipoChave })}>
              {(Object.keys(TIPOS_CHAVE) as TipoChave[]).map((t) => (
                <option key={t} value={t}>
                  {TIPOS_CHAVE[t]}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Chave Pix" erro={campos.chave}>
          {(id) => (
            <Entrada
              id={id}
              required={!atual || atual.tipoChave !== d.tipoChave}
              maxLength={120}
              placeholder={atual?.tipoChave === d.tipoChave ? manter(atual?.finalChave) : undefined}
              value={d.chave}
              onChange={(e) => set({ chave: e.target.value })}
            />
          )}
        </Campo>
      </div>

      <div className="grid gap-4 border-t border-borda pt-5">
        <Campo rotulo="Gateway de pagamento" dica="É ele que gera o Pix e avisa o sistema quando o cliente paga.">
          {(id, desc) => (
            <Selecao id={id} aria-describedby={desc} value={d.gateway} onChange={(e) => set({ gateway: e.target.value as Gateway })}>
              <option value="MERCADO_PAGO">Mercado Pago</option>
              <option value="SIMULADO">Simulado (só para testar, sem dinheiro de verdade)</option>
            </Selecao>
          )}
        </Campo>
        {d.gateway === 'MERCADO_PAGO' ? (
          <>
            <Campo rotulo="Access token de produção" dica="Mercado Pago → Suas integrações → Credenciais." erro={campos.tokenGateway}>
              {(id, desc) => (
                <Entrada
                  id={id}
                  aria-describedby={desc}
                  type="password"
                  autoComplete="new-password"
                  required={!atual?.finalToken || atual.gateway !== 'MERCADO_PAGO'}
                  placeholder={atual?.gateway === 'MERCADO_PAGO' ? manter(atual.finalToken) : undefined}
                  value={d.tokenGateway}
                  onChange={(e) => set({ tokenGateway: e.target.value })}
                />
              )}
            </Campo>
            <Campo rotulo="Assinatura secreta do webhook" dica={`Em Webhooks, cadastre a URL ${webhook} com o evento "Pagamentos" e cole a assinatura aqui.`} erro={campos.segredoWebhook}>
              {(id, desc) => (
                <Entrada
                  id={id}
                  aria-describedby={desc}
                  type="password"
                  autoComplete="new-password"
                  required={!atual?.finalSegredo || atual.gateway !== 'MERCADO_PAGO'}
                  placeholder={atual?.gateway === 'MERCADO_PAGO' ? manter(atual.finalSegredo) : undefined}
                  value={d.segredoWebhook}
                  onChange={(e) => set({ segredoWebhook: e.target.value })}
                />
              )}
            </Campo>
          </>
        ) : (
          <Aviso tipo="alerta">No modo simulado o Pix não vale dinheiro: a tela do cliente mostra um botão para fingir o pagamento. Não funciona em produção.</Aviso>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Botao type="submit" carregando={salvando}>
          Salvar recebedor
        </Botao>
        {aoCancelar && (
          <Botao type="button" variante="fantasma" onClick={aoCancelar}>
            Cancelar
          </Botao>
        )}
      </div>
    </form>
  );
}

function ListaAtencao({ pedirReauth, aoMudar }: { pedirReauth: PedirReauth; aoMudar: () => void }) {
  const lista = useQuery({ queryKey: ['pagamentos-atencao'], queryFn: () => api<PagamentoAtencao[]>('/admin/pagamentos?filtro=atencao') });
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  async function devolver(p: PagamentoAtencao) {
    const token = await pedirReauth(`Para devolver ${formatarCentavos(p.valorPagoCentavos ?? p.valorCentavos)} a ${p.agendamento.cliente}`);
    if (!token) return;
    try {
      const r = await api<{ resultado: string }>(`/admin/pagamentos/${p.id}/reembolsar`, { method: 'POST', headers: { 'X-Reauth-Token': token } });
      setAviso(r.resultado === 'reembolsado' ? { tipo: 'sucesso', texto: 'Valor devolvido.' } : { tipo: 'erro', texto: 'O gateway não confirmou. Tente de novo mais tarde.' });
      aoMudar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Sem conexão com o servidor.' });
    }
  }

  if (lista.isLoading) return <Carregando />;
  return (
    <div className="grid gap-3">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
        {lista.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="grid gap-1 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <CircleAlert className="size-4 text-alerta" aria-hidden />
                {p.agendamento.cliente} · {formatarCentavos(p.valorPagoCentavos ?? p.valorCentavos)}
              </p>
              <p className="text-tinta-suave">
                {p.agendamento.servico}, {formatarDataLonga(p.agendamento.inicio).toLowerCase()} às {p.agendamento.inicio.slice(11, 16)} ·{' '}
                {p.status === 'RECEBIDO_APOS_EXPIRAR' ? 'pagou depois que a reserva expirou' : 'a devolução falhou no gateway'}
              </p>
            </div>
            <Botao variante="secundario" onClick={() => devolver(p)}>
              <CheckCircle2 className="size-4" aria-hidden />
              Devolver
            </Botao>
          </li>
        ))}
      </ul>
    </div>
  );
}
