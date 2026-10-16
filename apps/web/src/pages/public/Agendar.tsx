import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { usePersonalizacao } from '../../lib/site';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, Clock, User } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos, formatarDuracao } from '../../lib/formato';
import { hojeISO } from '../../lib/horarios';
import { formatarDataLonga } from '../../lib/agenda';
import { LayoutPublico, useEmpresa } from '../../layouts/LayoutPublico';
import { SeletorHorario } from '../../components/agenda/SeletorHorario';
import { AreaTexto, Aviso, Botao, Campo, Carregando, cx, Entrada } from '../../components/ui';
import { PixSinal, type DadosPix } from '../../components/pagamento/PixSinal';

// RF21: serviço → profissional → dia e horário → dados → confirmação
// RF28–RF30: se o serviço exige sinal, o horário fica reservado e o cliente paga por Pix na hora

interface Profissional {
  id: string;
  nome: string;
  cargo: string | null;
  precoCentavos: number;
  duracaoMin: number;
  sinalCentavos: number;
}

interface ServicoPublico {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoMin: number;
  precoCentavos: number;
  fotoUrl: string | null;
  categoria: { id: string; nome: string; ordem: number } | null;
  profissionais: Profissional[];
  sinalPrazoMin: number;
}

interface Confirmacao {
  agendamento: { inicio: string; status: string; servico: { nome: string }; profissional: { nome: string }; valorCentavos: number; sinalCentavos: number };
  linkGestao: string;
  pix: DadosPix | null;
}

const ETAPAS = ['Serviço', 'Profissional', 'Dia e horário', 'Seus dados'];

export function Agendar() {
  const catalogo = useQuery({ queryKey: ['catalogo'], queryFn: () => api<ServicoPublico[]>('/public/servicos', { semRenovar: true }), staleTime: 0, refetchOnWindowFocus: 'always' });
  const { data: empresa } = useEmpresa();
  const { data: site } = usePersonalizacao();
  const [params] = useSearchParams();

  const [etapa, setEtapa] = useState(0);
  const [servico, setServico] = useState<ServicoPublico | null>(null);
  const [profissional, setProfissional] = useState<Profissional | null>(null); // null = qualquer um
  const [data, setData] = useState(hojeISO());
  const [horario, setHorario] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState<Confirmacao | null>(null);
  const [statusFinal, setStatusFinal] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string | undefined>>({});
  const [enviando, setEnviando] = useState(false);

  // RF11: veio do botão "Agendar" de um serviço na landing → já começa nele
  useEffect(() => {
    const id = params.get('servico');
    const s = id && catalogo.data?.find((x) => x.id === id);
    if (!s || servico) return;
    setServico(s);
    if (s.profissionais.length === 1) {
      setProfissional(s.profissionais[0]!);
      setEtapa(2);
    } else setEtapa(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogo.data]);

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, { nome: string; ordem: number; itens: ServicoPublico[] }>();
    for (const s of catalogo.data ?? []) {
      const chave = s.categoria?.id ?? '';
      if (!grupos.has(chave)) grupos.set(chave, { nome: s.categoria?.nome ?? 'Outros', ordem: s.categoria?.ordem ?? 9999, itens: [] });
      grupos.get(chave)!.itens.push(s);
    }
    return [...grupos.values()].sort((a, b) => a.ordem - b.ordem);
  }, [catalogo.data]);

  const precoMin = (s: ServicoPublico) => Math.min(...s.profissionais.map((p) => p.precoCentavos));
  const precoMax = (s: ServicoPublico) => Math.max(...s.profissionais.map((p) => p.precoCentavos));

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErro(null);
    setCampos({});
    setEnviando(true);
    try {
      const r = await api<Confirmacao>('/public/agendamentos', {
        method: 'POST',
        semRenovar: true,
        body: {
          servicoId: servico!.id,
          funcionarioId: profissional?.id ?? null,
          data,
          horario,
          cliente: { nome: f.get('nome'), telefone: f.get('telefone'), email: f.get('email') },
          observacao: f.get('observacao'),
          // RF07: perguntas extras configuradas no painel
          respostasExtras: Object.fromEntries(
            (site?.camposExtras ?? []).map((c) => [c.id, c.tipo === 'SIM_NAO' ? f.get(`extra-${c.id}`) === 'on' : String(f.get(`extra-${c.id}`) ?? '')]),
          ),
          aceitePolitica: f.get('aceitePolitica') === 'on',
          consentimentoLgpd: f.get('consentimentoLgpd') === 'on',
        },
      });
      setConfirmado(r);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'HORARIO_INDISPONIVEL') {
          setHorario(null);
          setEtapa(2);
        }
        setErro(err.code === 'VALIDATION_ERROR' ? 'Confira os campos destacados.' : err.message);
        const c = err.campos as Record<string, string[] | undefined>;
        setCampos(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v?.[0]])));
      } else setErro('Sem conexão. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  }

  if (confirmado) {
    const a = confirmado.agendamento;
    const status = statusFinal ?? a.status;
    const tokenGestao = new URL(confirmado.linkGestao).searchParams.get('token') ?? '';

    // Aguardando o Pix
    if (status === 'AGUARDANDO_PAGAMENTO' && confirmado.pix) {
      return (
        <LayoutPublico>
          <div className="grid gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Horário reservado. Falta o sinal.</h1>
              <p className="mt-2 text-tinta-suave">
                {a.servico.nome} com {a.profissional.nome}, {formatarDataLonga(a.inicio).toLowerCase()} às {a.inicio.slice(11, 16)}. Pague o sinal por Pix
                para confirmar. O resto ({formatarCentavos(a.valorCentavos - a.sinalCentavos)}) você paga no atendimento.
              </p>
            </div>
            <PixSinal token={tokenGestao} pix={confirmado.pix} aoMudar={setStatusFinal} />
            <p className="text-sm text-tinta-suave">Também mandamos o Pix para o seu e-mail, junto com o link para ver ou cancelar.</p>
          </div>
        </LayoutPublico>
      );
    }
    if (status === 'EXPIRADO' || status === 'CANCELADO') {
      return (
        <LayoutPublico>
          <div className="grid gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Reserva expirada</h1>
            <p className="text-tinta-suave">O sinal não foi pago a tempo e o horário foi liberado. Se você pagou depois, o valor é devolvido automaticamente.</p>
            <Botao className="justify-self-start" onClick={() => (setConfirmado(null), setStatusFinal(null), setHorario(null), setEtapa(2))}>
              Escolher outro horário
            </Botao>
          </div>
        </LayoutPublico>
      );
    }

    return (
      <LayoutPublico>
        <div className="grid gap-6">
          <CalendarCheck className="size-10 text-destaque" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agendamento confirmado</h1>
            <p className="mt-2 text-tinta-suave">
              {a.sinalCentavos > 0 ? 'Recebemos o sinal. ' : ''}Enviamos os detalhes para o seu e-mail, com um link para remarcar ou cancelar.
            </p>
          </div>
          <dl className="grid gap-3 rounded-lg border border-borda bg-superficie p-5 text-sm sm:grid-cols-[120px_1fr]">
            <dt className="text-tinta-suave">Serviço</dt>
            <dd className="font-medium">{a.servico.nome}</dd>
            <dt className="text-tinta-suave">Com</dt>
            <dd className="font-medium">{a.profissional.nome}</dd>
            <dt className="text-tinta-suave">Quando</dt>
            <dd className="font-medium">
              {formatarDataLonga(a.inicio)}, às {a.inicio.slice(11, 16)}
            </dd>
            <dt className="text-tinta-suave">Valor</dt>
            <dd className="font-medium">
              {formatarCentavos(a.valorCentavos)}
              {a.sinalCentavos > 0 && <span className="font-normal text-tinta-suave"> (sinal de {formatarCentavos(a.sinalCentavos)} pago, resto no atendimento)</span>}
            </dd>
          </dl>
          <a href={confirmado.linkGestao} className="text-destaque font-medium underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current justify-self-start">
            Ver ou alterar meu agendamento
          </a>
        </div>
      </LayoutPublico>
    );
  }

  return (
    <LayoutPublico>
      <h1 className="font-titulo text-2xl font-semibold tracking-tight">Agende seu horário</h1>
      {site?.textos.boasVindasAgendamento && etapa === 0 && <p className="mt-2 whitespace-pre-line text-tinta-suave">{site.textos.boasVindasAgendamento}</p>}

      {/* Etapas: é uma sequência de verdade, por isso numeradas */}
      <ol className="mt-6 mb-8 flex gap-2 text-xs sm:text-sm" aria-label="Etapas">
        {ETAPAS.map((nome, i) => (
          <li
            key={nome}
            aria-current={i === etapa ? 'step' : undefined}
            className={cx('flex-1 border-t-4 pt-2', i <= etapa ? 'border-destaque text-tinta font-medium' : 'border-borda text-tinta-suave')}
          >
            {i + 1}. {nome}
          </li>
        ))}
      </ol>

      {etapa > 0 && (
        <button onClick={() => setEtapa(etapa - 1)} className="mb-6 inline-flex items-center gap-1.5 text-sm text-tinta-suave hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Voltar
        </button>
      )}

      {erro && (
        <div className="mb-6">
          <Aviso>{erro}</Aviso>
        </div>
      )}

      {etapa === 0 &&
        (catalogo.isLoading ? (
          <Carregando />
        ) : !catalogo.data?.length ? (
          <Aviso tipo="alerta">Nenhum serviço disponível para agendar online no momento.</Aviso>
        ) : (
          <div className="grid gap-8">
            {porCategoria.map((g) => (
              <section key={g.nome}>
                {porCategoria.length > 1 && <h2 className="mb-3 font-semibold text-tinta-suave">{g.nome}</h2>}
                <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
                  {g.itens.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          setServico(s);
                          setProfissional(null);
                          setHorario(null);
                          setEtapa(s.profissionais.length > 1 ? 1 : 2);
                          if (s.profissionais.length === 1) setProfissional(s.profissionais[0]!);
                        }}
                        className="grid w-full gap-1 px-5 py-4 text-left hover:bg-fundo"
                      >
                        <span className="flex items-baseline justify-between gap-4">
                          <span className="font-semibold">{s.nome}</span>
                          <span className="whitespace-nowrap font-semibold">
                            {precoMin(s) === precoMax(s) ? formatarCentavos(precoMin(s)) : `a partir de ${formatarCentavos(precoMin(s))}`}
                          </span>
                        </span>
                        <span className="text-sm text-tinta-suave">{formatarDuracao(s.duracaoMin)}</span>
                        {s.descricao && <span className="text-sm text-tinta-suave">{s.descricao}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}

      {etapa === 1 && servico && (
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          <li>
            <button onClick={() => (setProfissional(null), setHorario(null), setEtapa(2))} className="grid w-full gap-1 px-5 py-4 text-left hover:bg-fundo">
              <span className="font-semibold">Sem preferência</span>
              <span className="text-sm text-tinta-suave">Mostra todos os horários livres</span>
            </button>
          </li>
          {servico.profissionais.map((p) => (
            <li key={p.id}>
              <button onClick={() => (setProfissional(p), setHorario(null), setEtapa(2))} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-fundo">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destaque-claro text-destaque-forte">
                  <User className="size-5" aria-hidden />
                </span>
                <span className="grid flex-1 gap-0.5">
                  <span className="font-semibold">{p.nome}</span>
                  {p.cargo && <span className="text-sm text-tinta-suave">{p.cargo}</span>}
                </span>
                <span className="text-right text-sm">
                  <span className="block font-semibold">{formatarCentavos(p.precoCentavos)}</span>
                  <span className="text-tinta-suave">{formatarDuracao(p.duracaoMin)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {etapa === 2 && servico && (
        <div className="grid gap-8">
          <Resumo servico={servico} profissional={profissional} />
          <SeletorHorario
            servicoId={servico.id}
            funcionarioId={profissional?.id ?? null}
            data={data}
            aoMudarData={(d) => (setData(d), setHorario(null))}
            horario={horario}
            aoMudarHorario={setHorario}
          />
          <Botao disabled={!horario} onClick={() => setEtapa(3)} className="sm:justify-self-start">
            Continuar
          </Botao>
        </div>
      )}

      {etapa === 3 && servico && horario && (
        <form onSubmit={confirmar} className="grid gap-6">
          <Resumo servico={servico} profissional={profissional} data={data} horario={horario} />
          <Campo rotulo="Nome" erro={campos.cliente}>
            {(id) => <Entrada id={id} name="nome" required minLength={2} maxLength={120} autoComplete="name" />}
          </Campo>
          <div className="grid gap-6 sm:grid-cols-2">
            <Campo rotulo="WhatsApp ou telefone">
              {(id) => <Entrada id={id} name="telefone" type="tel" required autoComplete="tel" placeholder="(15) 99999-0000" />}
            </Campo>
            <Campo rotulo="E-mail" dica="Para a confirmação e o link de alteração.">
              {(id, desc) => <Entrada id={id} aria-describedby={desc} name="email" type="email" required autoComplete="email" />}
            </Campo>
          </div>
          {site?.camposExtras.map((c) =>
            c.tipo === 'SIM_NAO' ? (
              <label key={c.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={`extra-${c.id}`} required={c.obrigatorio} className="mt-0.5 size-4 accent-destaque" />
                {c.rotulo}
              </label>
            ) : (
              <Campo key={c.id} rotulo={`${c.rotulo}${c.obrigatorio ? '' : ' (opcional)'}`}>
                {(id) => <Entrada id={id} name={`extra-${c.id}`} required={c.obrigatorio} maxLength={300} />}
              </Campo>
            ),
          )}
          <Campo rotulo="Alguma observação? (opcional)">
            {(id) => <AreaTexto id={id} name="observacao" maxLength={500} className="min-h-16" />}
          </Campo>

          <div className="grid gap-3 rounded-lg border border-borda bg-superficie p-4 text-sm">
            {empresa?.politicaCancelamento && <p className="text-tinta-suave">{empresa.politicaCancelamento}</p>}
            <label className="flex items-start gap-2">
              <input type="checkbox" name="aceitePolitica" required className="mt-0.5 size-4 accent-destaque" />
              Li e aceito a política de cancelamento.
            </label>
            {/* 9.6: consentimento explícito para o uso dos dados (LGPD) */}
            <label className="flex items-start gap-2">
              <input type="checkbox" name="consentimentoLgpd" required className="mt-0.5 size-4 accent-destaque" />
              Concordo com o uso do meu nome, telefone e e-mail para este agendamento e para avisos sobre ele.
            </label>
          </div>

          {sinalPrevisto(servico, profissional) > 0 && (
            <Aviso tipo="alerta">
              Para confirmar, você paga um sinal de {formatarCentavos(sinalPrevisto(servico, profissional))} por Pix na próxima tela. O horário fica reservado por{' '}
              {servico.sinalPrazoMin} min.
            </Aviso>
          )}

          <Botao type="submit" carregando={enviando} className="sm:justify-self-start">
            {sinalPrevisto(servico, profissional) > 0 ? 'Reservar e pagar o sinal' : 'Confirmar agendamento'}
          </Botao>
        </form>
      )}
    </LayoutPublico>
  );
}

// Com "sem preferência" mostra o maior sinal possível (o valor exato sai do servidor)
function sinalPrevisto(servico: ServicoPublico, profissional: Profissional | null) {
  return profissional ? profissional.sinalCentavos : Math.max(0, ...servico.profissionais.map((p) => p.sinalCentavos));
}

function Resumo({ servico, profissional, data, horario }: { servico: ServicoPublico; profissional: Profissional | null; data?: string; horario?: string }) {
  const preco = profissional?.precoCentavos ?? Math.min(...servico.profissionais.map((p) => p.precoCentavos));
  const duracao = profissional?.duracaoMin ?? servico.duracaoMin;
  return (
    <div className="grid gap-1.5 rounded-lg bg-destaque-claro px-5 py-4 text-sm text-destaque-forte">
      <p className="font-semibold text-base">{servico.nome}</p>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <User className="size-4" aria-hidden />
          {profissional?.nome ?? 'Sem preferência'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden />
          {formatarDuracao(duracao)}
        </span>
        <span>{formatarCentavos(preco)}</span>
        {sinalPrevisto(servico, profissional) > 0 && <span>Sinal de {formatarCentavos(sinalPrevisto(servico, profissional))} via Pix</span>}
      </p>
      {data && horario && (
        <p className="font-medium">
          {formatarDataLonga(data)}, às {horario}
        </p>
      )}
    </div>
  );
}
