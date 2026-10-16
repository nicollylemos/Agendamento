import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { GradeDia, GradeHoras, LegendaSituacoes } from '../../components/agenda/GradeDia';
import { avancar, PainelDetalhe, periodoDaVisao, tituloDaVisao, VisaoMes, type Visao } from '../../components/agenda/Calendario';
import { useVisualAgenda } from '../../lib/useVisualAgenda';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { hojeISO, somarDias } from '../../lib/horarios';
import { formatarDataLonga, hora, NOME_FORMA, NOME_SITUACAO, NOME_STATUS, SITUACOES, situacaoDe, type ColunaAgenda, type FormaPagamento, type ItemAgenda, type Situacao, type StatusAgendamento, tom, type VisualAgenda } from '../../lib/agenda';
import { useSalvar } from '../../lib/useSalvar';
import { formatarQuantidade, NOME_UNIDADE, numeroDoTexto, textoDoNumero, type Unidade } from '../../lib/estoque';
import { useAuth } from '../../auth/AuthContext';
import { Modal } from '../../components/Modal';
import { Aviso, Botao, Cabecalho, Campo, Carregando, cx, Entrada, Interruptor, Secao, Selecao, Selo } from '../../components/ui';

// RF24 (agendamento manual), RF25 (remarcar), RF26 (status). RF22 na aba de regras.

interface OpcaoServico {
  id: string;
  nome: string;
  profissionais: { id: string; nome: string; duracaoMin: number; precoCentavos: number }[];
}

export function Agenda() {
  const { pode } = useAuth();
  const gestao = pode('agenda:ver_todas');
  const [aba, setAba] = useState<'agenda' | 'regras'>('agenda');

  return (
    <>
      <Cabecalho titulo={gestao ? 'Agenda' : 'Minha agenda'} />
      {pode('empresa:gerenciar') && (
        <div role="tablist" className="mb-8 flex gap-1 border-b border-borda">
          {(
            [
              ['agenda', 'Agendamentos'],
              ['regras', 'Regras e cores'],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              role="tab"
              aria-selected={aba === id}
              onClick={() => setAba(id)}
              className={cx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', aba === id ? 'border-destaque' : 'border-transparent text-tinta-suave hover:text-tinta')}
            >
              {rotulo}
            </button>
          ))}
        </div>
      )}
      {aba === 'agenda' ? <Dia gestao={gestao} /> : <Regras />}
    </>
  );
}

function Dia({ gestao }: { gestao: boolean }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const { cores } = useVisualAgenda();
  const base = gestao ? '/admin/agenda' : '/staff/agenda';
  const podeGerenciar = gestao ? pode('agenda:gerenciar') : pode('agenda:gerenciar_propria');
  const [params, setParams] = useSearchParams();

  // Estado na URL: dá para voltar, recarregar e mandar o link (Início → agenda já no atendimento)
  const visao: Visao = (['mes', 'semana', 'dia'] as const).find((v) => v === params.get('v')) ?? lerVisao();
  const data = /^\d{4}-\d{2}-\d{2}$/.test(params.get('data') ?? '') ? params.get('data')! : hojeISO();
  const selecionadoId = params.get('id');
  const profissional = gestao ? (params.get('prof') ?? '') : '';
  const mudar = (novo: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(novo)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        return n;
      },
      { replace: true },
    );
  const mudarVisao = (v: Visao) => {
    try {
      localStorage.setItem('agenda-visao', v);
    } catch {
      /* preferência só deste navegador */
    }
    mudar({ v });
  };

  const [novo, setNovo] = useState(false);
  const [remarcando, setRemarcando] = useState<ItemAgenda | null>(null);
  const [concluindo, setConcluindo] = useState<{ agendamento: ItemAgenda; itens: ItemConsumo[] } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  const { de, ate } = periodoDaVisao(visao, data);
  const agenda = useQuery({
    queryKey: ['agenda', base, de, ate],
    queryFn: () => api<ItemAgenda[]>(`${base}?de=${de}&ate=${ate}`),
    refetchInterval: 60_000, // atualiza sozinha enquanto a tela fica aberta
    placeholderData: keepPreviousData, // ao trocar de semana, mantém a anterior até chegar a nova
  });
  const recarregar = () => qc.invalidateQueries({ queryKey: ['agenda'] });
  const colunas = useQuery({ queryKey: ['agenda-colunas', base], queryFn: () => api<ColunaAgenda[]>(`${base}/profissionais`), retry: false });

  const itens = useMemo(
    () => (agenda.data ?? []).filter((a) => !profissional || a.funcionario.id === profissional),
    [agenda.data, profissional],
  );
  const selecionado = itens.find((a) => a.id === selecionadoId) ?? null;
  const telaLarga = useTelaLarga();
  const selecionar = (a: ItemAgenda | null) => mudar({ id: a?.id ?? null });

  async function mudarStatus(a: ItemAgenda, status: StatusAgendamento, conclusao?: Conclusao) {
    setAviso(null);
    // RF40 + RF47: ao concluir, pergunta como o cliente pagou e mostra os produtos da ficha técnica
    if (status === 'CONCLUIDO' && !conclusao) {
      const itensConsumo = await api<ItemConsumo[]>(`${base}/${a.id}/consumo`).catch(() => [] as ItemConsumo[]);
      return setConcluindo({ agendamento: a, itens: itensConsumo });
    }
    if (status === 'CANCELADO' && !window.confirm(`Cancelar o agendamento de ${a.cliente.nome} às ${hora(a.inicio)}?`)) return;
    if (status === 'CONFIRMADO' && !window.confirm(`Confirmar ${a.cliente.nome} sem o Pix? Use quando o sinal foi pago de outro jeito. O Pix pendente será cancelado.`)) return;
    // RF32: cancelamento pelo painel com sinal pago — a gestão decide se devolve
    let reembolsarSinal: boolean | undefined;
    if (status === 'CANCELADO' && gestao && a.sinal?.status === 'APROVADO') {
      reembolsarSinal = window.confirm(`Devolver o sinal de ${formatarCentavos(a.sinal.valorCentavos)} para ${a.cliente.nome}?\n\nOK = devolver · Cancelar = a empresa fica com o sinal`);
    }
    try {
      await api(`${base}/${a.id}/status`, { method: 'PATCH', body: { status, ...(reembolsarSinal !== undefined && { reembolsarSinal }), ...conclusao } });
      setConcluindo(null);
      setAviso({ tipo: 'sucesso', texto: `${a.cliente.nome}: ${NOME_STATUS[status].toLowerCase()}.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Sem conexão com o servidor.' });
    }
  }

  // Resumo do período por situação (vira a legenda com números)
  const contagem = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {};
    for (const a of itens) c[situacaoDe(a)] = (c[situacaoDe(a)] ?? 0) + 1;
    return c;
  }, [itens]);
  const ativos = itens.filter((a) => !['CANCELADO', 'EXPIRADO', 'NAO_COMPARECEU'].includes(a.status));
  const previsto = ativos.reduce((t, a) => t + a.valorCentavos, 0);

  const detalhe = selecionado && (
    <PainelDetalhe
      a={selecionado}
      cores={cores}
      gestao={gestao}
      podeGerenciar={podeGerenciar}
      aoFechar={() => selecionar(null)}
      aoMudarStatus={(a, s) => mudarStatus(a, s)}
      aoRemarcar={setRemarcando}
    />
  );

  return (
    <div className="grid gap-5">
      {/* Linha 1: visão, filtro e novo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Visão da agenda" className="flex rounded-lg border border-borda p-0.5">
          {(
            [
              ['mes', 'Mês'],
              ['semana', 'Semana'],
              ['dia', 'Dia'],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              aria-pressed={visao === v}
              onClick={() => mudarVisao(v)}
              className={cx('h-8 rounded-md px-4 text-sm font-medium transition-colors', visao === v ? 'bg-tinta text-white' : 'text-tinta-suave hover:text-tinta')}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {gestao && (colunas.data?.length ?? 0) > 1 && (
            <Selecao aria-label="Profissional" className="w-48" value={profissional} onChange={(e) => mudar({ prof: e.target.value || null })}>
              <option value="">Toda a equipe</option>
              {colunas.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
          )}
          {podeGerenciar && (
            <Botao onClick={() => setNovo(true)}>
              <Plus className="size-4" aria-hidden />
              Novo agendamento
            </Botao>
          )}
        </div>
      </div>

      {/* Linha 2: período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <Botao variante="secundario" className="h-9 px-2.5" aria-label="Anterior" onClick={() => mudar({ data: avancar(visao, data, -1), id: null })}>
              <ChevronLeft className="size-4" strokeWidth={1.6} />
            </Botao>
            <Botao variante="secundario" className="h-9 px-2.5" aria-label="Próximo" onClick={() => mudar({ data: avancar(visao, data, 1), id: null })}>
              <ChevronRight className="size-4" strokeWidth={1.6} />
            </Botao>
          </div>
          <h2 className="text-lg font-semibold">{tituloDaVisao(visao, data)}</h2>
          {periodoDaVisao(visao, data).de !== periodoDaVisao(visao, hojeISO()).de && (
            <Botao variante="fantasma" className="h-9 px-3" onClick={() => mudar({ data: hojeISO(), id: null })}>
              Hoje
            </Botao>
          )}
        </div>
        <p className="text-sm text-tinta-suave">
          {ativos.length ? `${ativos.length} ${ativos.length === 1 ? 'atendimento' : 'atendimentos'}, ${formatarCentavos(previsto)} previstos` : 'Nenhum atendimento no período'}
        </p>
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_288px]">
        <div className={cx('grid min-w-0 gap-3 transition-opacity', agenda.isFetching && agenda.isPlaceholderData && 'opacity-60')}>
          {agenda.isLoading ? (
            <Carregando />
          ) : agenda.isError ? (
            <Aviso>{agenda.error instanceof ApiError ? agenda.error.message : 'Não foi possível carregar a agenda.'}</Aviso>
          ) : visao === 'mes' ? (
            <VisaoMes data={data} itens={itens} cores={cores} selecionadoId={selecionadoId} aoClicar={selecionar} aoAbrirDia={(iso) => mudar({ v: 'dia', data: iso, id: null })} />
          ) : visao === 'semana' ? (
            <GradeHoras
              cores={cores}
              selecionadoId={selecionadoId}
              aoClicar={selecionar}
              mostrarProfissional={gestao && !profissional}
              larguraMinima={92}
              colunas={Array.from({ length: 7 }, (_, i) => {
                const iso = somarDias(de, i);
                return {
                  id: iso,
                  titulo: `${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][i]} ${Number(iso.slice(8))}`,
                  hoje: iso === hojeISO(),
                  itens: itens.filter((a) => a.inicio.startsWith(iso)),
                };
              })}
            />
          ) : (
            <GradeDia
              itens={itens}
              colunas={(colunas.data ?? []).filter((c) => !profissional || c.id === profissional)}
              ehHoje={data === hojeISO()}
              cores={cores}
              selecionadoId={selecionadoId}
              aoClicar={selecionar}
            />
          )}
          <LegendaSituacoes cores={cores} />
        </div>

        {/* Painel ao lado (computador). No celular abre por cima. */}
        <aside className="sticky top-6 hidden rounded-xl border border-borda p-5 xl:block">
          {detalhe ?? (
            <div className="grid gap-4">
              <div>
                <h3 className="font-medium">Resumo do período</h3>
                <p className="mt-1 text-sm text-tinta-suave">Clique num atendimento para ver os detalhes e mudar a situação.</p>
              </div>
              {itens.length > 0 && (
                <ul className="grid gap-2">
                  {SITUACOES.filter((s) => contagem[s]).map((s) => (
                    <li key={s} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-sm" style={{ background: cores[s] }} aria-hidden />
                        {NOME_SITUACAO[s]}
                      </span>
                      <span className="tabular-nums">{contagem[s]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Tela estreita: o painel abre como janela (o <dialog> trava a página mesmo escondido, por isso o teste em JS) */}
      <div>
        <Modal aberto={Boolean(selecionado) && !telaLarga} aoFechar={() => selecionar(null)} titulo="Atendimento">
          {selecionado && (
            <PainelDetalhe a={selecionado} cores={cores} gestao={gestao} podeGerenciar={podeGerenciar} aoMudarStatus={(a, s) => mudarStatus(a, s)} aoRemarcar={setRemarcando} />
          )}
        </Modal>
      </div>

      <Modal aberto={novo} aoFechar={() => setNovo(false)} titulo="Novo agendamento" largura="max-w-xl">
        {novo && (
          <FormAgendamento
            base={base}
            gestao={gestao}
            dataInicial={data < hojeISO() ? hojeISO() : data}
            aoConcluir={(texto) => {
              setNovo(false);
              setAviso({ tipo: 'sucesso', texto });
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal aberto={concluindo !== null} aoFechar={() => setConcluindo(null)} titulo="Concluir atendimento">
        {concluindo && <FormConcluir {...concluindo} aoConcluir={(c) => mudarStatus(concluindo.agendamento, 'CONCLUIDO', c)} />}
      </Modal>

      <Modal aberto={remarcando !== null} aoFechar={() => setRemarcando(null)} titulo="Remarcar">
        {remarcando && (
          <FormRemarcar
            base={base}
            item={remarcando}
            aoConcluir={(texto) => {
              setRemarcando(null);
              setAviso({ tipo: 'sucesso', texto });
              recarregar();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// Mesmo ponto de quebra do painel lateral (xl = 1280px)
function useTelaLarga() {
  const consulta = '(min-width: 1280px)';
  const [larga, setLarga] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudou = () => setLarga(m.matches);
    m.addEventListener('change', mudou);
    return () => m.removeEventListener('change', mudou);
  }, []);
  return larga;
}

function lerVisao(): Visao {
  try {
    const v = localStorage.getItem('agenda-visao');
    return v === 'mes' || v === 'dia' ? v : 'semana';
  } catch {
    return 'semana';
  }
}

// Escolha de horário no painel: lista de livres ou, no encaixe, horário livre digitado
function EscolhaHorario({
  base,
  servicoId,
  funcionarioId,
  data,
  horario,
  aoMudar,
  encaixe,
  ignorarAgendamentoId,
}: {
  base: string;
  servicoId: string;
  funcionarioId: string;
  data: string;
  horario: string;
  aoMudar: (h: string) => void;
  encaixe: boolean;
  ignorarAgendamentoId?: string;
}) {
  const livres = useQuery({
    enabled: Boolean(servicoId && funcionarioId && data) && !encaixe,
    queryKey: ['livres-painel', base, servicoId, funcionarioId, data, ignorarAgendamentoId],
    queryFn: () =>
      api<string[]>(
        `${base}/horarios-livres?servicoId=${servicoId}&funcionarioId=${funcionarioId}&data=${data}${ignorarAgendamentoId ? `&ignorarAgendamentoId=${ignorarAgendamentoId}` : ''}`,
      ),
  });

  if (encaixe) {
    return (
      <Campo rotulo="Horário" dica="Encaixe ignora a jornada, mas nunca passa por cima de outro cliente.">
        {(id, desc) => <Entrada id={id} aria-describedby={desc} type="time" step={300} required value={horario} onChange={(e) => aoMudar(e.target.value)} className="w-36" />}
      </Campo>
    );
  }
  if (!servicoId || !funcionarioId) return null;
  if (livres.isLoading) return <Carregando texto="Buscando horários livres…" />;
  if (livres.error) return <Aviso>{(livres.error as Error).message}</Aviso>;
  if (!livres.data?.length) return <Aviso tipo="alerta">Sem horários livres nesse dia. Escolha outro dia ou use o encaixe.</Aviso>;

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Horário</legend>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {livres.data.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={h === horario}
            onClick={() => aoMudar(h)}
            className={cx('rounded-md border py-1.5 text-sm', h === horario ? 'border-destaque bg-destaque text-white' : 'border-borda hover:border-destaque')}
          >
            {h}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FormAgendamento({ base, gestao, dataInicial, aoConcluir }: { base: string; gestao: boolean; dataInicial: string; aoConcluir: (t: string) => void }) {
  const opcoes = useQuery({ queryKey: ['opcoes-agenda', base], queryFn: () => api<OpcaoServico[]>(`${base}/opcoes`) });
  const { salvando, erro, campos, executar } = useSalvar();
  const [servicoId, setServicoId] = useState('');
  const [funcionarioId, setFuncionarioId] = useState('');
  const [data, setData] = useState(dataInicial);
  const [horario, setHorario] = useState('');
  const [encaixe, setEncaixe] = useState(false);

  const servico = opcoes.data?.find((s) => s.id === servicoId);
  useEffect(() => {
    // Funcionário: só ele mesmo. Gestão: primeiro da lista.
    if (servico && !servico.profissionais.some((p) => p.id === funcionarioId)) setFuncionarioId(servico.profissionais[0]?.id ?? '');
  }, [servico, funcionarioId]);
  useEffect(() => setHorario(''), [servicoId, funcionarioId, data, encaixe]);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await executar(() =>
      api<ItemAgenda>(base, {
        method: 'POST',
        body: {
          servicoId,
          funcionarioId,
          data,
          horario,
          encaixe,
          observacao: f.get('observacao'),
          cliente: { nome: f.get('nome'), telefone: f.get('telefone'), email: f.get('email') },
        },
      }),
    );
    if (r) aoConcluir(`${r.cliente.nome} agendado para ${hora(r.inicio)} com ${r.funcionario.nome}.`);
  }

  if (opcoes.isLoading) return <Carregando />;
  if (!opcoes.data?.length) return <Aviso tipo="alerta">Nenhum serviço com profissional definido. Configure em Serviços.</Aviso>;

  return (
    <form onSubmit={salvar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Serviço">
          {(id) => (
            <Selecao id={id} required value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
              <option value="">Escolha</option>
              {opcoes.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        {gestao && servico && (
          <Campo rotulo="Profissional">
            {(id) => (
              <Selecao id={id} required value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
                {servico.profissionais.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} ({formatarCentavos(p.precoCentavos)})
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
        )}
        <Campo rotulo="Data">{(id) => <Entrada id={id} type="date" required value={data} onChange={(e) => setData(e.target.value)} />}</Campo>
      </div>
      <Interruptor ligado={encaixe} aoMudar={setEncaixe} rotulo="Encaixe (horário fora da jornada)" />
      <EscolhaHorario base={base} servicoId={servicoId} funcionarioId={funcionarioId} data={data} horario={horario} aoMudar={setHorario} encaixe={encaixe} />

      <fieldset className="grid gap-4 border-t border-borda pt-5">
        <legend className="font-semibold">Cliente</legend>
        {campos.cliente && <Aviso>{campos.cliente}</Aviso>}
        <Campo rotulo="Nome">{(id) => <Entrada id={id} name="nome" required minLength={2} maxLength={120} />}</Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Telefone">{(id) => <Entrada id={id} name="telefone" type="tel" required placeholder="(15) 99999-0000" />}</Campo>
          <Campo rotulo="E-mail (opcional)" dica="Recebe a confirmação.">
            {(id, desc) => <Entrada id={id} aria-describedby={desc} name="email" type="email" />}
          </Campo>
        </div>
        <Campo rotulo="Observação (opcional)">{(id) => <Entrada id={id} name="observacao" maxLength={500} />}</Campo>
      </fieldset>

      <Botao type="submit" carregando={salvando} disabled={!horario || !funcionarioId}>
        Agendar
      </Botao>
    </form>
  );
}

function FormRemarcar({ base, item, aoConcluir }: { base: string; item: ItemAgenda; aoConcluir: (t: string) => void }) {
  const { salvando, erro, executar } = useSalvar();
  const [data, setData] = useState(item.inicio.slice(0, 10));
  const [horario, setHorario] = useState('');
  const [encaixe, setEncaixe] = useState(false);
  useEffect(() => setHorario(''), [data, encaixe]);

  async function salvar() {
    const r = await executar(() => api<ItemAgenda>(`${base}/${item.id}/reagendar`, { method: 'PATCH', body: { data, horario, encaixe } }));
    if (r) aoConcluir(`${r.cliente.nome} remarcado para ${formatarDataLonga(r.inicio).toLowerCase()}, às ${hora(r.inicio)}.`);
  }

  return (
    <div className="grid gap-5">
      <p className="text-sm text-tinta-suave">
        {item.cliente.nome}, {item.servico.nome} com {item.funcionario.nome}. Hoje marcado para {formatarDataLonga(item.inicio).toLowerCase()}, às {hora(item.inicio)}.
      </p>
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nova data">{(id) => <Entrada id={id} type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-auto" />}</Campo>
      <Interruptor ligado={encaixe} aoMudar={setEncaixe} rotulo="Encaixe (horário fora da jornada)" />
      <EscolhaHorario
        base={base}
        servicoId={item.servico.id}
        funcionarioId={item.funcionario.id}
        data={data}
        horario={horario}
        aoMudar={setHorario}
        encaixe={encaixe}
        ignorarAgendamentoId={item.id}
      />
      <Botao onClick={salvar} carregando={salvando} disabled={!horario}>
        Remarcar
      </Botao>
    </div>
  );
}

// RF22, RF25
interface Config {
  antecedenciaMinimaMin: number;
  diasAFrente: number;
  passoMin: number;
  prazoCancelamentoHoras: number;
  prazoReagendamentoHoras: number;
}

function Regras() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config-agenda'], queryFn: () => api<Config>('/admin/agenda/config') });
  const [c, setC] = useState<Config | null>(null);
  const { salvando, erro, salvo, executar } = useSalvar();
  useEffect(() => {
    if (config.data) setC(config.data);
  }, [config.data]);

  if (!c) return <Carregando />;
  const num = (k: keyof Config) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setC({ ...c, [k]: Number(e.target.value) });

  return (
    <>
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await executar(() => api<Config>('/admin/agenda/config', { method: 'PUT', body: c }));
        if (r) qc.setQueryData(['config-agenda'], r);
      }}
    >
      {erro && <Aviso>{erro}</Aviso>}
      {salvo && <Aviso tipo="sucesso">Regras salvas.</Aviso>}
      <Secao titulo="Quando o cliente pode agendar" descricao="Vale para o agendamento pelo site. No painel, a equipe pode encaixar a qualquer momento.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Antecedência mínima (minutos)" dica="Ex.: 120 = só aceita horários daqui a 2 horas ou mais.">
            {(id, desc) => <Entrada id={id} aria-describedby={desc} type="number" min={0} max={10080} step={15} value={c.antecedenciaMinimaMin} onChange={num('antecedenciaMinimaMin')} />}
          </Campo>
          <Campo rotulo="Até quantos dias à frente">
            {(id) => <Entrada id={id} type="number" min={1} max={365} value={c.diasAFrente} onChange={num('diasAFrente')} />}
          </Campo>
          <Campo rotulo="Oferecer horários a cada">
            {(id) => (
              <Selecao id={id} value={c.passoMin} onChange={num('passoMin')}>
                {[5, 10, 15, 20, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
        </div>
      </Secao>
      <Secao titulo="Mudanças pelo cliente" descricao="Até quando o cliente pode cancelar ou remarcar sozinho, pelo link do e-mail. Depois disso, só falando com vocês.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Cancelar até (horas antes)">
            {(id) => <Entrada id={id} type="number" min={0} max={168} value={c.prazoCancelamentoHoras} onChange={num('prazoCancelamentoHoras')} />}
          </Campo>
          <Campo rotulo="Remarcar até (horas antes)">
            {(id) => <Entrada id={id} type="number" min={0} max={168} value={c.prazoReagendamentoHoras} onChange={num('prazoReagendamentoHoras')} />}
          </Campo>
        </div>
        <Botao type="submit" carregando={salvando} className="justify-self-start">
          Salvar regras
        </Botao>
      </Secao>
    </form>
    <CoresAgenda />
    </>
  );
}

// Cores da agenda: cada situação com a cor que a empresa escolher
function CoresAgenda() {
  const qc = useQueryClient();
  const visual = useQuery({ queryKey: ['agenda-visual', '/admin/agenda'], queryFn: () => api<VisualAgenda>('/admin/agenda/visual') });
  const [cores, setCores] = useState<Record<Situacao, string> | null>(null);
  const { salvando, erro, salvo, executar } = useSalvar();
  useEffect(() => {
    if (visual.data) setCores(visual.data.cores);
  }, [visual.data]);
  if (!cores || !visual.data) return <Carregando />;
  const padrao = visual.data.coresPadrao;

  async function salvar(novas: Record<Situacao, string>) {
    const r = await executar(() => api<VisualAgenda>('/admin/agenda/cores', { method: 'PUT', body: novas }));
    if (r) qc.setQueryData(['agenda-visual', '/admin/agenda'], r);
  }

  return (
    <Secao titulo="Cores da agenda" descricao="Cada situação aparece com uma cor na agenda e no início. O nome da situação sempre aparece junto.">
      {erro && <Aviso>{erro}</Aviso>}
      {salvo && <Aviso tipo="sucesso">Cores salvas.</Aviso>}
      <ul className="grid gap-px overflow-hidden rounded-xl border border-borda bg-borda sm:grid-cols-2">
        {SITUACOES.map((s) => (
          <li key={s} className="flex items-center gap-3 bg-superficie px-4 py-3 sm:last:odd:col-span-2">
            <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-borda" style={{ background: cores[s] }}>
              <span className="sr-only">Cor de {NOME_SITUACAO[s]}</span>
              <input type="color" value={cores[s]} onChange={(e) => setCores({ ...cores, [s]: e.target.value })} className="absolute inset-0 size-full cursor-pointer opacity-0" />
            </label>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{NOME_SITUACAO[s]}</p>
              {/* Prévia do bloco como aparece na agenda */}
              <p className="mt-1 truncate rounded border-l-[3px] px-2 py-0.5 text-xs" style={{ background: tom(cores[s]), borderLeftColor: cores[s] }}>
                09:00 Cliente
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Botao carregando={salvando} onClick={() => salvar(cores)}>
          Salvar cores
        </Botao>
        <Botao variante="secundario" onClick={() => (setCores(padrao), salvar(padrao))}>
          Voltar às cores padrão
        </Botao>
      </div>
    </Secao>
  );
}

// RF40: produtos usados no atendimento (vem da ficha técnica; dá para corrigir)
interface ItemConsumo {
  produtoId: string;
  nome: string;
  unidade: Unidade;
  quantidade: number;
  estoqueAtual: number;
}

interface Conclusao {
  consumo?: { produtoId: string; quantidade: number }[];
  formaPagamento?: FormaPagamento;
}

function FormConcluir({ agendamento, itens, aoConcluir }: { agendamento: ItemAgenda; itens: ItemConsumo[]; aoConcluir: (c: Conclusao) => Promise<void> }) {
  const [valores, setValores] = useState(() => Object.fromEntries(itens.map((i) => [i.produtoId, textoDoNumero(i.quantidade)])));
  const [forma, setForma] = useState<FormaPagamento | ''>('');
  const [enviando, setEnviando] = useState(false);
  const invalido = itens.some((i) => numeroDoTexto(valores[i.produtoId] ?? '') === null || numeroDoTexto(valores[i.produtoId] ?? '')! < 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await aoConcluir({
        ...(itens.length && { consumo: itens.map((i) => ({ produtoId: i.produtoId, quantidade: numeroDoTexto(valores[i.produtoId] ?? '0') ?? 0 })) }),
        ...(forma && { formaPagamento: forma }),
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="grid gap-5">
      <p className="text-sm text-tinta-suave">
        {agendamento.cliente.nome} · {agendamento.servico.nome}
        {agendamento.restanteCentavos > 0 && (
          <>
            {' '}
            · falta receber <strong className="text-tinta">{formatarCentavos(agendamento.restanteCentavos)}</strong>
          </>
        )}
      </p>
      {/* RF47: entra no relatório de faturamento por forma de pagamento */}
      {agendamento.restanteCentavos > 0 && (
        <Campo rotulo="Como o cliente pagou?" dica="Opcional. Aparece no relatório de faturamento.">
          {(id) => (
            <Selecao id={id} value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento | '')}>
              <option value="">Não informar</option>
              {Object.entries(NOME_FORMA).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      )}
      {itens.length > 0 && <p className="text-sm text-tinta-suave">Confira quanto foi usado de cada produto; a baixa no estoque sai ao concluir.</p>}
      {itens.length > 0 && <ul className="grid divide-y divide-borda rounded-lg border border-borda">
        {itens.map((i) => {
          const q = numeroDoTexto(valores[i.produtoId] ?? '');
          return (
            <li key={i.produtoId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">{i.nome}</p>
                <p className={cx('text-xs', q !== null && q > i.estoqueAtual ? 'text-erro' : 'text-tinta-suave')}>em estoque: {formatarQuantidade(i.estoqueAtual, i.unidade)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Entrada
                  aria-label={`Quantidade usada de ${i.nome}`}
                  inputMode="decimal"
                  className="w-24"
                  value={valores[i.produtoId] ?? ''}
                  onChange={(e) => setValores({ ...valores, [i.produtoId]: e.target.value })}
                />
                <span className="w-6 text-sm text-tinta-suave">{NOME_UNIDADE[i.unidade]}</span>
              </div>
            </li>
          );
        })}
      </ul>}
      <Botao type="submit" carregando={enviando} disabled={invalido}>
        {itens.length ? 'Concluir e dar baixa' : 'Concluir atendimento'}
      </Botao>
    </form>
  );
}
