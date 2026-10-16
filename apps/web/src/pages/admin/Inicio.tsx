import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatarCentavos, formatarDuracao } from '../../lib/formato';
import { hojeISO, somarDias } from '../../lib/horarios';
import { dia, formatarDataLonga, hora, minutosDoDia, NOME_SITUACAO, situacaoDe, tom, type ItemAgenda, type Situacao } from '../../lib/agenda';
import { horas as formatarHoras, type Relatorio } from '../../lib/relatorios';
import { useVisualAgenda } from '../../lib/useVisualAgenda';
import { avancar, ordenar, periodoDaVisao, tituloDaVisao } from '../../components/agenda/Calendario';
import { EntradaMoeda } from '../../components/EntradaMoeda';
import { Modal } from '../../components/Modal';
import { Aviso, Botao, Carregando, cx } from '../../components/ui';

// Início (dashboard): o dia de hoje, ocupação, meta do mês, serviços mais feitos,
// próximos atendimentos e um minicalendário. Usa a agenda (RF24/RF26) e os relatórios (RF47, RF49).

const SERIE = '#4a6fb0'; // mesma cor de dado dos relatórios (validada)
const ESCONDIDOS = ['CANCELADO', 'EXPIRADO'];

interface Passo {
  feito: boolean;
  titulo: string;
  descricao: string;
  link: string;
  rotuloLink: string;
}

// Primeiros passos para deixar o agendamento pronto para clientes
function useProgresso(admin: boolean) {
  return useQuery({
    enabled: admin,
    queryKey: ['progresso-inicial'],
    queryFn: async () => {
      const [empresa, servicos, funcionarios, horarios] = await Promise.all([
        api('/admin/empresa').then(() => true).catch((e) => (e instanceof ApiError && e.status === 404 ? false : Promise.reject(e))),
        api<{ equipe: unknown[]; noSite: boolean }[]>('/admin/servicos'),
        api<unknown[]>('/admin/funcionarios'),
        api<{ empresaTemHorario: boolean; semJornada: string[]; semHorarioNenhum: string[] }>('/admin/horarios/diagnostico'),
      ]);
      return {
        empresa,
        servicos: servicos.length,
        servicosForaDoSite: servicos.filter((s) => !s.noSite).length,
        funcionarios: funcionarios.length,
        horarios,
      };
    },
  });
}

const saudacao = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};

export function Inicio() {
  const { usuario, pode } = useAuth();
  const admin = pode('empresa:gerenciar') && pode('servicos:gerenciar');
  const gestao = pode('agenda:ver_todas');
  const base = gestao ? '/admin/agenda' : '/staff/agenda';
  const baseRel = pode('relatorios:ver') ? '/admin/relatorios' : pode('relatorios:ver_proprios') ? '/staff/relatorios' : null;
  const { cores, metaMensalCentavos } = useVisualAgenda();
  const navegar = useNavigate();
  const abrir = (a: ItemAgenda) => navegar(`/painel/agenda?v=dia&data=${dia(a.inicio)}&id=${a.id}`);

  const { data: progresso } = useProgresso(admin);
  const hoje = hojeISO();
  const inicioMes = `${hoje.slice(0, 8)}01`;

  const doDia = useQuery({
    queryKey: ['agenda', base, hoje, hoje],
    queryFn: () => api<ItemAgenda[]>(`${base}?de=${hoje}&ate=${hoje}`),
    refetchInterval: 60_000,
    retry: false,
  });
  const ocupacao = useQuery({
    enabled: Boolean(baseRel),
    queryKey: ['relatorio', baseRel, 'ocupacao', hoje],
    queryFn: () => api<Relatorio>(`${baseRel}/ocupacao?de=${hoje}&ate=${hoje}`),
    retry: false,
  });
  const faturamento = useQuery({
    enabled: Boolean(baseRel),
    queryKey: ['relatorio', baseRel, 'faturamento', inicioMes, hoje],
    queryFn: () => api<Relatorio>(`${baseRel}/faturamento?de=${inicioMes}&ate=${hoje}`),
    retry: false,
  });
  // Fase 6: sinal ligado sem recebedor ou Pix para devolver; RF41: estoque
  const estoque = useQuery({
    enabled: pode('estoque:ver'),
    queryKey: ['estoque-alertas'],
    queryFn: () => api<{ abaixoDoMinimo: number; vencidos: number; vencendo: number }>('/admin/estoque/alertas'),
  });
  const pagamentos = useQuery({
    enabled: pode('sinal:gerenciar'),
    queryKey: ['pagamentos-situacao'],
    queryFn: () => api<{ semCobrar: boolean; precisamAtencao: number }>('/admin/pagamentos/situacao'),
  });

  if (doDia.error instanceof ApiError && doDia.error.code === 'SEM_PERFIL_ATENDIMENTO') {
    return <Aviso tipo="alerta">Você ainda não está cadastrado como profissional. Peça ao administrador para te vincular na Equipe.</Aviso>;
  }

  const passos: Passo[] = progresso
    ? [
        { feito: progresso.empresa, titulo: 'Cadastre os dados da empresa', descricao: 'Nome, contato, endereço e horário de funcionamento aparecem para os clientes.', link: '/painel/empresa', rotuloLink: 'Abrir dados da empresa' },
        { feito: progresso.funcionarios > 0, titulo: 'Cadastre os profissionais', descricao: 'Só o nome já basta. Se você também atende, cadastre-se também.', link: '/painel/equipe', rotuloLink: 'Abrir equipe' },
        {
          // RF17/RF20: sem jornada e sem horário da empresa, ninguém consegue agendar
          feito: progresso.funcionarios > 0 && progresso.horarios.semHorarioNenhum.length === 0,
          titulo: 'Defina os horários de atendimento',
          descricao: progresso.horarios.semHorarioNenhum.length
            ? `Sem horário, o site não mostra vagas: ${progresso.horarios.semHorarioNenhum.join(', ')}. Cadastre a jornada de cada um em Horários da equipe (ou o horário de funcionamento em Empresa, que vale para quem não tem jornada).`
            : 'Cadastre a jornada de cada profissional. Quem não tiver jornada usa o horário de funcionamento da empresa.',
          link: '/painel/horarios',
          rotuloLink: 'Abrir horários da equipe',
        },
        { feito: progresso.servicos > 0, titulo: 'Crie os serviços', descricao: 'Duração, preço e o intervalo de limpeza entre um cliente e outro.', link: '/painel/servicos', rotuloLink: 'Abrir serviços' },
        {
          feito: progresso.servicos > 0 && progresso.servicosForaDoSite === 0,
          titulo: 'Diga quem faz cada serviço',
          descricao: progresso.servicosForaDoSite
            ? `${progresso.servicosForaDoSite} serviço(s) não aparecem no site. A lista de serviços mostra o motivo (quase sempre: ninguém marcado em "Quem faz").`
            : 'Só aparecem no site os serviços com pelo menos um profissional ativo.',
          link: '/painel/servicos',
          rotuloLink: 'Abrir serviços',
        },
      ]
    : [];
  const feitos = passos.filter((p) => p.feito).length;

  const hojeItens = ordenar((doDia.data ?? []).filter((a) => !ESCONDIDOS.includes(a.status)));
  const agoraHHMM = new Date().toTimeString().slice(0, 5);
  const pendentes = hojeItens.filter((a) => ['CONFIRMADO', 'AGUARDANDO_PAGAMENTO', 'EM_ATENDIMENTO'].includes(a.status));
  const proximo = pendentes.find((a) => a.status === 'EM_ATENDIMENTO') ?? pendentes.find((a) => hora(a.fim) > agoraHHMM);
  const concluidos = hojeItens.filter((a) => a.status === 'CONCLUIDO').length;
  const valorHoje = hojeItens.filter((a) => a.status !== 'NAO_COMPARECEU').reduce((t, a) => t + a.valorCentavos, 0);

  const ind = (r: Relatorio | undefined, id: string) => r?.indicadores.find((i) => i.id === id)?.valor ?? null;
  const taxa = ind(ocupacao.data, 'taxa');
  const faturado = ind(faturamento.data, 'total') ?? 0;
  const servicosMes = faturamento.data?.tabelas.find((t) => t.id === 'servicos')?.linhas.slice(0, 5) ?? [];
  const temAvisos =
    (admin && !usuario?.totpAtivo) ||
    pagamentos.data?.semCobrar ||
    Boolean(pagamentos.data?.precisamAtencao) ||
    Boolean(estoque.data && estoque.data.abaixoDoMinimo + estoque.data.vencidos + estoque.data.vencendo > 0);

  return (
    <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-8">
        <header>
          <h1 className="text-[1.75rem] font-semibold leading-tight">
            {saudacao()}, {usuario?.nome.split(' ')[0]}
          </h1>
          <p className="mt-2 text-[0.9375rem] text-tinta-suave">{formatarDataLonga(hoje)}</p>
        </header>

        {/* Destaque do dia: quantos atendimentos e quem é o próximo */}
        <section className="grid gap-6 rounded-2xl bg-tinta p-6 text-white sm:grid-cols-[auto_1fr] sm:items-end sm:p-8">
          <div>
            <p className="text-sm text-white/70">Hoje</p>
            <p className="mt-1 text-6xl font-semibold leading-none tracking-[-0.04em] tabular-nums">{hojeItens.length}</p>
            <p className="mt-2 text-sm text-white/70">{hojeItens.length === 1 ? 'atendimento' : 'atendimentos'}</p>
          </div>
          <div className="grid gap-4 sm:justify-items-end sm:text-right">
            <p className="max-w-sm text-[0.9375rem] leading-relaxed text-white/85">
              {proximo
                ? proximo.status === 'EM_ATENDIMENTO'
                  ? `Agora: ${proximo.cliente.nome}, ${proximo.servico.nome}.`
                  : `Próximo: ${proximo.cliente.nome} às ${hora(proximo.inicio)}, ${proximo.servico.nome}.`
                : hojeItens.length
                  ? 'Os atendimentos de hoje já passaram.'
                  : 'Nenhum atendimento marcado para hoje.'}
              {valorHoje > 0 && ` Previsto para hoje: ${formatarCentavos(valorHoje)}.`}
            </p>
            <Link to="/painel/agenda?v=dia" className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-tinta transition-colors hover:bg-white/90">
              Abrir agenda do dia
            </Link>
          </div>
        </section>

        {temAvisos && (
          <div className="grid gap-3">
            {admin && !usuario?.totpAtivo && (
              <div className="flex flex-wrap items-start gap-3 rounded-lg border border-borda p-4 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-alerta" strokeWidth={1.75} aria-hidden />
                <p className="min-w-60 flex-1">Sua conta entra só com a senha. Como administrador você controla quem recebe os pagamentos, então vale ligar a verificação em duas etapas.</p>
                <Link to="/painel/conta" className="font-medium underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
                  Ativar agora
                </Link>
              </div>
            )}
            {(pagamentos.data?.semCobrar || Boolean(pagamentos.data?.precisamAtencao)) && (
              <Aviso tipo="alerta">
                {pagamentos.data?.semCobrar ? 'O sinal está ligado, mas o recebedor não está ativo: os agendamentos entram sem cobrar. ' : ''}
                {pagamentos.data?.precisamAtencao ? `${pagamentos.data.precisamAtencao} Pix precisam de atenção. ` : ''}
                <Link to="/painel/pagamentos" className="font-medium underline underline-offset-4">
                  Abrir Sinal e Pix
                </Link>
              </Aviso>
            )}
            {estoque.data && estoque.data.abaixoDoMinimo + estoque.data.vencidos + estoque.data.vencendo > 0 && (
              <Aviso tipo="alerta">
                {[
                  estoque.data.abaixoDoMinimo && `${estoque.data.abaixoDoMinimo} produto(s) abaixo do mínimo`,
                  estoque.data.vencidos && `${estoque.data.vencidos} vencido(s)`,
                  estoque.data.vencendo && `${estoque.data.vencendo} vencendo em 30 dias`,
                ]
                  .filter(Boolean)
                  .join(', ')}
                .{' '}
                <Link to="/painel/estoque" className="font-medium underline underline-offset-4">
                  Abrir estoque
                </Link>
              </Aviso>
            )}
          </div>
        )}

        {progresso && feitos < passos.length && (
          <section className="grid gap-3">
            <h2 className="font-medium">
              Primeiros passos <span className="font-normal text-tinta-suave">({feitos} de {passos.length})</span>
            </h2>
            <ol className="grid gap-px overflow-hidden rounded-xl border border-borda bg-borda sm:grid-cols-2">
              {passos.map((p) => (
                <li key={p.titulo} className="flex gap-3 bg-superficie p-4">
                  {p.feito ? <CheckCircle2 className="size-5 shrink-0 text-ok" strokeWidth={1.6} aria-label="Concluído" /> : <Circle className="size-5 shrink-0 text-[#c9c8c3]" strokeWidth={1.6} aria-label="Pendente" />}
                  <div className="grid gap-1">
                    <p className={cx('font-medium', p.feito && 'text-tinta-suave line-through')}>{p.titulo}</p>
                    {!p.feito && (
                      <>
                        <p className="text-sm text-tinta-suave">{p.descricao}</p>
                        <Link to={p.link} className="justify-self-start text-sm underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
                          {p.rotuloLink}
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Números: anéis + serviços do mês */}
        {baseRel && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Cartao>
              <div className="grid grid-cols-2 gap-4">
                <Anel
                  titulo="Ocupação hoje"
                  fracao={taxa}
                  texto={taxa === null ? '—' : `${Math.round(taxa * 100)}%`}
                  legenda={
                    taxa === null
                      ? 'Ninguém com jornada hoje'
                      : `${formatarHoras(ind(ocupacao.data, 'ocupado') ?? 0)} de ${formatarHoras(ind(ocupacao.data, 'disponivel') ?? 0)} agendadas`
                  }
                />
                {gestao && metaMensalCentavos ? (
                  <Anel
                    titulo="Meta do mês"
                    fracao={faturado / metaMensalCentavos}
                    texto={`${Math.round((faturado / metaMensalCentavos) * 100)}%`}
                    legenda={`${formatarCentavos(faturado)} de ${formatarCentavos(metaMensalCentavos)}`}
                    acao={pode('empresa:gerenciar') ? <DefinirMeta atual={metaMensalCentavos} /> : undefined}
                  />
                ) : (
                  <Anel
                    titulo="Concluídos hoje"
                    fracao={hojeItens.length ? concluidos / hojeItens.length : null}
                    texto={`${concluidos}/${hojeItens.length}`}
                    legenda={gestao ? `${formatarCentavos(faturado)} faturados no mês` : 'atendimentos'}
                    acao={gestao && pode('empresa:gerenciar') ? <DefinirMeta atual={null} /> : undefined}
                  />
                )}
              </div>
            </Cartao>

            <Cartao titulo="Serviços do mês">
              {servicosMes.length === 0 ? (
                <p className="py-6 text-sm text-tinta-suave">Nenhum atendimento concluído neste mês ainda.</p>
              ) : (
                <ul className="grid gap-3.5">
                  {servicosMes.map((l) => {
                    const pct = Number(l.participacao ?? 0);
                    return (
                      <li key={String(l.servico)} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
                        <span className="truncate" title={String(l.servico)}>
                          {l.servico}
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full" style={{ background: tom(SERIE, 0.85) }} aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, pct * 100)}%`, background: SERIE }} />
                        </span>
                        <span className="w-10 text-right tabular-nums text-tinta-suave">{Math.round(pct * 100)}%</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link to="/painel/relatorios?tipo=faturamento" className="mt-5 inline-block text-sm underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
                Ver relatórios
              </Link>
            </Cartao>
          </div>
        )}

        {/* Lista do dia */}
        <section className="grid gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">Atendimentos de hoje</h2>
            <Link to="/painel/agenda?v=semana" className="text-sm underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
              Ver a semana
            </Link>
          </div>
          {doDia.isLoading ? (
            <Carregando />
          ) : hojeItens.length === 0 ? (
            <p className="rounded-xl border border-dashed border-borda px-5 py-10 text-center text-sm text-tinta-suave">Nenhum atendimento hoje. Os que vierem pelo site aparecem aqui sozinhos.</p>
          ) : (
            <ul className="grid gap-2">
              {hojeItens.map((a) => (
                <LinhaAtendimento key={a.id} a={a} cores={cores} gestao={gestao} aoClicar={abrir} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <MiniCalendario base={base} cores={cores} aoAbrir={abrir} />
    </div>
  );
}

function Cartao({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-borda p-5 sm:p-6">
      {titulo && <h2 className="mb-5 font-medium">{titulo}</h2>}
      {children}
    </section>
  );
}

// Anel de progresso (medidor): trilha clara e preenchimento no mesmo tom
function Anel({ titulo, fracao, texto, legenda, acao }: { titulo: string; fracao: number | null; texto: string; legenda: string; acao?: ReactNode }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, fracao ?? 0));
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <h2 className="text-sm font-medium">{titulo}</h2>
      <div className="relative size-32">
        <svg viewBox="0 0 108 108" className="size-full -rotate-90" role="img" aria-label={`${titulo}: ${texto}`}>
          <circle cx="54" cy="54" r={R} fill="none" stroke={tom(SERIE, 0.85)} strokeWidth="9" />
          {f > 0 && <circle cx="54" cy="54" r={R} fill="none" stroke={SERIE} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${C * f} ${C}`} />}
        </svg>
        <span className="absolute inset-0 grid place-items-center text-2xl font-semibold tracking-[-0.02em] tabular-nums">{texto}</span>
      </div>
      <p className="text-xs leading-relaxed text-tinta-suave">{legenda}</p>
      {acao}
    </div>
  );
}

function DefinirMeta({ atual }: { atual: number | null }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState<number | null>(atual);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(meta: number | null) {
    setErro(null);
    try {
      await api('/admin/agenda/meta', { method: 'PUT', body: { metaMensalCentavos: meta } });
      qc.invalidateQueries({ queryKey: ['agenda-visual'] });
      setAberto(false);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Sem conexão com o servidor.');
    }
  }
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="text-xs underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
        {atual ? 'Mudar meta' : 'Definir meta do mês'}
      </button>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Meta de faturamento do mês">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar(valor);
          }}
        >
          {erro && <Aviso>{erro}</Aviso>}
          <p className="text-sm text-tinta-suave">Quanto a empresa quer faturar por mês. O Início mostra quanto já foi alcançado.</p>
          <EntradaMoeda valor={valor} aoMudar={setValor} placeholder="R$ 0,00" aria-label="Meta do mês" />
          <div className="flex flex-wrap gap-2">
            <Botao type="submit" disabled={!valor}>
              Salvar meta
            </Botao>
            {atual && (
              <Botao type="button" variante="secundario" onClick={() => salvar(null)}>
                Tirar a meta
              </Botao>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}

function LinhaAtendimento({ a, cores, gestao, aoClicar }: { a: ItemAgenda; cores: Record<Situacao, string>; gestao: boolean; aoClicar: (a: ItemAgenda) => void }) {
  const s = situacaoDe(a);
  return (
    <li>
      <button
        type="button"
        onClick={() => aoClicar(a)}
        className="grid w-full grid-cols-[4px_3.25rem_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-borda py-3 pl-3 pr-4 text-left transition-colors hover:bg-fundo/70"
      >
        <span className="h-9 rounded-full" style={{ background: cores[s] }} aria-hidden />
        <span className="font-medium tabular-nums">{hora(a.inicio)}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{a.cliente.nome}</span>
          <span className="block truncate text-sm text-tinta-suave">
            {a.servico.nome}
            {gestao && `, ${a.funcionario.nome}`}
          </span>
        </span>
        <span className="hidden items-center gap-1.5 text-xs text-tinta-suave sm:flex">
          <span className="size-2 rounded-full" style={{ background: cores[s] }} aria-hidden />
          {NOME_SITUACAO[s]}
        </span>
      </button>
    </li>
  );
}

// Minicalendário: pontinhos nos dias com atendimento; ao escolher um dia, mostra o próximo e a lista
function MiniCalendario({ base, cores, aoAbrir }: { base: string; cores: Record<Situacao, string>; aoAbrir: (a: ItemAgenda) => void }) {
  const hoje = hojeISO();
  const [mes, setMes] = useState(`${hoje.slice(0, 8)}01`);
  const [escolhido, setEscolhido] = useState(hoje);
  const { de, ate } = periodoDaVisao('mes', mes);
  const agenda = useQuery({ queryKey: ['agenda', base, de, ate], queryFn: () => api<ItemAgenda[]>(`${base}?de=${de}&ate=${ate}`), retry: false });
  const porDia = new Map<string, ItemAgenda[]>();
  for (const a of ordenar(agenda.data ?? [])) {
    if (ESCONDIDOS.includes(a.status)) continue;
    porDia.set(dia(a.inicio), [...(porDia.get(dia(a.inicio)) ?? []), a]);
  }
  const doEscolhido = porDia.get(escolhido) ?? [];
  const destaque = doEscolhido.find((a) => escolhido !== hoje || hora(a.fim) > new Date().toTimeString().slice(0, 5)) ?? doEscolhido[0];

  return (
    <aside className="grid gap-6 xl:sticky xl:top-8">
      <section className="rounded-xl border border-borda p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-medium">{tituloDaVisao('mes', mes)}</h2>
          <div className="flex">
            <button type="button" onClick={() => setMes(avancar('mes', mes, -1))} className="rounded-lg p-1.5 text-tinta-suave hover:bg-fundo hover:text-tinta" aria-label="Mês anterior">
              <ChevronLeft className="size-4" strokeWidth={1.6} />
            </button>
            <button type="button" onClick={() => setMes(avancar('mes', mes, 1))} className="rounded-lg p-1.5 text-tinta-suave hover:bg-fundo hover:text-tinta" aria-label="Próximo mês">
              <ChevronRight className="size-4" strokeWidth={1.6} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
            <span key={i} className="pb-1 text-tinta-suave">
              {d}
            </span>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const iso = somarDias(de, i);
            const fora = iso.slice(0, 7) !== mes.slice(0, 7);
            const itens = porDia.get(iso) ?? [];
            const sel = iso === escolhido;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setEscolhido(iso)}
                aria-pressed={sel}
                aria-label={`${formatarDataLonga(iso)}${itens.length ? `, ${itens.length} atendimento(s)` : ''}`}
                className={cx(
                  'relative mx-auto grid size-8 place-items-center rounded-full tabular-nums transition-colors',
                  sel ? 'bg-tinta font-medium text-white' : iso === hoje ? 'font-semibold text-tinta ring-1 ring-tinta' : fora ? 'text-tinta-suave/50' : 'text-tinta hover:bg-fundo',
                )}
              >
                {Number(iso.slice(8))}
                {itens.length > 0 && !sel && <span className="absolute bottom-0.5 size-1 rounded-full bg-tinta-suave" aria-hidden />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border border-borda p-5">
        <div>
          <p className="text-sm text-tinta-suave">{escolhido === hoje ? 'Hoje' : formatarDataLonga(escolhido)}</p>
          <p className="text-sm">{doEscolhido.length ? `${doEscolhido.length} ${doEscolhido.length === 1 ? 'atendimento' : 'atendimentos'}` : 'Nenhum atendimento'}</p>
        </div>
        {destaque && (
          <div className="grid gap-3 border-t border-borda pt-4">
            <span className="inline-flex items-center gap-2 justify-self-start rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: tom(cores[situacaoDe(destaque)], 0.8) }}>
              <span className="size-2 rounded-full" style={{ background: cores[situacaoDe(destaque)] }} aria-hidden />
              {NOME_SITUACAO[situacaoDe(destaque)]}
            </span>
            <div>
              <h3 className="font-semibold leading-tight">{destaque.servico.nome}</h3>
              <p className="mt-1 text-sm text-tinta-suave">
                {destaque.cliente.nome}, {destaque.funcionario.nome}
              </p>
            </div>
            <p className="text-sm tabular-nums">
              {hora(destaque.inicio)} às {hora(destaque.fim)}{' '}
              <span className="text-tinta-suave">({formatarDuracao(minutosDoDia(destaque.fim) - minutosDoDia(destaque.inicio))})</span>
            </p>
            <Botao onClick={() => aoAbrir(destaque)}>Abrir atendimento</Botao>
          </div>
        )}
        {doEscolhido.length > 1 && (
          <ul className="grid gap-1.5 border-t border-borda pt-4">
            {doEscolhido
              .filter((a) => a.id !== destaque?.id)
              .map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => aoAbrir(a)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left text-sm hover:bg-fundo">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: cores[situacaoDe(a)] }} aria-hidden />
                    <span className="tabular-nums text-tinta-suave">{hora(a.inicio)}</span>
                    <span className="truncate">{a.cliente.nome}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
