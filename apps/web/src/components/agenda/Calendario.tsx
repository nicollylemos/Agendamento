import type { ReactNode } from 'react';
import { CalendarDays, Clock, MessageSquareText, Phone, Scissors, User, Wallet, X } from 'lucide-react';
import { Botao, cx } from '../ui';
import { BlocoAtendimento } from './GradeDia';
import { formatarCentavos, formatarDuracao } from '../../lib/formato';
import { hojeISO, somarDias } from '../../lib/horarios';
import {
  ACAO_STATUS,
  dia,
  formatarDataLonga,
  hora,
  minutosDoDia,
  NOME_FORMA,
  NOME_SINAL,
  NOME_SITUACAO,
  situacaoDe,
  tom,
  type ItemAgenda,
  type Situacao,
  type StatusAgendamento,
} from '../../lib/agenda';

// Agenda em Mês / Semana / Dia (RF24, RF26) com painel de detalhes ao lado

export type Visao = 'mes' | 'semana' | 'dia';

const ESCONDIDOS = ['CANCELADO', 'EXPIRADO'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00`).getDay();
export const inicioDaSemana = (iso: string) => somarDias(iso, -diaDaSemana(iso));
const inicioDoMes = (iso: string) => `${iso.slice(0, 8)}01`;

// Período que cada visão busca na API
export function periodoDaVisao(visao: Visao, data: string) {
  if (visao === 'dia') return { de: data, ate: data };
  if (visao === 'semana') {
    const de = inicioDaSemana(data);
    return { de, ate: somarDias(de, 6) };
  }
  const de = inicioDaSemana(inicioDoMes(data)); // a grade do mês começa no domingo
  return { de, ate: somarDias(de, 41) }; // 6 semanas
}

// Anda um mês / uma semana / um dia
export function avancar(visao: Visao, data: string, sentido: 1 | -1) {
  if (visao === 'dia') return somarDias(data, sentido);
  if (visao === 'semana') return somarDias(data, 7 * sentido);
  const d = new Date(`${inicioDoMes(data)}T12:00:00`);
  d.setMonth(d.getMonth() + sentido);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function tituloDaVisao(visao: Visao, data: string) {
  const [a, m] = data.split('-').map(Number) as [number, number];
  if (visao === 'dia') return formatarDataLonga(data);
  if (visao === 'mes') return `${MESES[m - 1]![0]!.toUpperCase()}${MESES[m - 1]!.slice(1)} de ${a}`;
  const ini = inicioDaSemana(data);
  const fim = somarDias(ini, 6);
  const [, m1, d1] = ini.split('-').map(Number) as [number, number, number];
  const [a2, m2, d2] = fim.split('-').map(Number) as [number, number, number];
  return m1 === m2 ? `${d1} a ${d2} de ${MESES[m2 - 1]} de ${a2}` : `${d1} de ${MESES[m1 - 1]} a ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

export const ordenar = (l: ItemAgenda[]) => [...l].sort((x, y) => x.inicio.localeCompare(y.inicio));

// ─── Mês ─────────────────────────────────────────────────

export function VisaoMes({
  data,
  itens,
  cores,
  selecionadoId,
  aoClicar,
  aoAbrirDia,
}: {
  data: string;
  itens: ItemAgenda[];
  cores: Record<Situacao, string>;
  selecionadoId?: string | null;
  aoClicar: (a: ItemAgenda) => void;
  aoAbrirDia: (iso: string) => void;
}) {
  const { de } = periodoDaVisao('mes', data);
  const mes = data.slice(0, 7);
  const hoje = hojeISO();
  const porDia = new Map<string, ItemAgenda[]>();
  for (const a of ordenar(itens)) {
    if (ESCONDIDOS.includes(a.status)) continue;
    const k = dia(a.inicio);
    porDia.set(k, [...(porDia.get(k) ?? []), a]);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-superficie">
      <div className="grid grid-cols-7 border-b border-borda">
        {SEMANA.map((s) => (
          <div key={s} className="px-2 py-2 text-center text-xs text-tinta-suave sm:px-3 sm:text-right">
            {s}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => {
          const iso = somarDias(de, i);
          const doDia = porDia.get(iso) ?? [];
          const fora = iso.slice(0, 7) !== mes;
          const visiveis = doDia.slice(0, 3);
          return (
            <div
              key={iso}
              className={cx('min-h-20 border-borda p-1 sm:min-h-28 sm:p-1.5', i % 7 !== 0 && 'border-l', i >= 7 && 'border-t', fora && 'bg-fundo/50')}
            >
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => aoAbrirDia(iso)}
                  aria-label={`Abrir ${formatarDataLonga(iso)}${doDia.length ? `, ${doDia.length} atendimento(s)` : ''}`}
                  className={cx(
                    'grid size-7 place-items-center rounded-full text-xs tabular-nums transition-colors',
                    iso === hoje ? 'bg-tinta font-semibold text-white' : fora ? 'text-tinta-suave/70 hover:bg-fundo' : 'text-tinta-suave hover:bg-fundo hover:text-tinta',
                  )}
                >
                  {Number(iso.slice(8))}
                </button>
              </div>
              {/* Celular: só pontinhos coloridos; no computador, os atendimentos */}
              {doDia.length > 0 && (
                <button type="button" onClick={() => aoAbrirDia(iso)} className="mt-1 flex flex-wrap justify-end gap-0.5 sm:hidden" aria-hidden tabIndex={-1}>
                  {doDia.slice(0, 6).map((a) => (
                    <span key={a.id} className="size-1.5 rounded-full" style={{ background: cores[situacaoDe(a)] }} />
                  ))}
                </button>
              )}
              <div className="mt-0.5 hidden gap-1 sm:grid">
                {visiveis.map((a) => (
                  <BlocoAtendimento key={a.id} a={a} cores={cores} compacto selecionado={selecionadoId === a.id} aoClicar={aoClicar} className="block w-full truncate py-0.5" />
                ))}
                {doDia.length > visiveis.length && (
                  <button type="button" onClick={() => aoAbrirDia(iso)} className="justify-self-start px-1 text-xs text-tinta-suave hover:text-tinta">
                    mais {doDia.length - visiveis.length}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Painel de detalhes ──────────────────────────────────

function Linha({ icone: Icone, children }: { icone: typeof Clock; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <Icone className="mt-0.5 size-4 shrink-0 text-tinta-suave" strokeWidth={1.6} aria-hidden />
      <div className="min-w-0 text-sm">{children}</div>
    </li>
  );
}

export function PainelDetalhe({
  a,
  cores,
  gestao,
  podeGerenciar,
  aoFechar,
  aoMudarStatus,
  aoRemarcar,
}: {
  a: ItemAgenda;
  cores: Record<Situacao, string>;
  gestao: boolean;
  podeGerenciar: boolean;
  aoFechar?: () => void;
  aoMudarStatus: (a: ItemAgenda, s: StatusAgendamento) => void;
  aoRemarcar: (a: ItemAgenda) => void;
}) {
  const s = situacaoDe(a);
  const cor = cores[s];
  const duracao = minutosDoDia(a.fim) - minutosDoDia(a.inicio);
  const acoes = a.proximosStatus.filter((x) => x !== 'CANCELADO');
  const principal = acoes.find((x) => x === 'CONCLUIDO' || x === 'EM_ATENDIMENTO');

  return (
    <article className="grid gap-5">
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: tom(cor, 0.8) }}>
            <span className="size-2 rounded-full" style={{ background: cor }} aria-hidden />
            {NOME_SITUACAO[s]}
          </span>
          {aoFechar && (
            <button type="button" onClick={aoFechar} className="-m-1 rounded-lg p-1 text-tinta-suave hover:bg-fundo hover:text-tinta" aria-label="Fechar detalhes">
              <X className="size-4" strokeWidth={1.6} />
            </button>
          )}
        </div>
        <div>
          <h3 className="text-lg font-semibold leading-tight">{a.cliente.nome}</h3>
          <p className="text-sm text-tinta-suave">{a.servico.nome}</p>
        </div>
      </header>

      <ul className="grid gap-3">
        <Linha icone={Clock}>
          <span className="tabular-nums">
            {hora(a.inicio)} às {hora(a.fim)}
          </span>
          <span className="text-tinta-suave">, {formatarDuracao(duracao)}</span>
        </Linha>
        <Linha icone={CalendarDays}>{formatarDataLonga(a.inicio)}</Linha>
        {gestao && <Linha icone={Scissors}>{a.funcionario.nome}</Linha>}
        <Linha icone={Phone}>
          {gestao ? (
            <a href={`tel:${a.cliente.telefone}`} className="underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
              {a.cliente.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')}
            </a>
          ) : (
            a.cliente.telefone
          )}
        </Linha>
        <Linha icone={Wallet}>
          {formatarCentavos(a.valorCentavos)}
          {a.sinal && (
            <span className="block text-tinta-suave">
              {NOME_SINAL[a.sinal.status]}: {formatarCentavos(a.sinal.valorCentavos)}
              {a.sinal.status === 'APROVADO' && !['CONCLUIDO', 'CANCELADO'].includes(a.status) && <>, falta receber {formatarCentavos(a.restanteCentavos)}</>}
            </span>
          )}
          {a.status === 'AGUARDANDO_PAGAMENTO' && a.expiraSinalEm && (
            <span className="block text-alerta">Pix vence às {new Date(a.expiraSinalEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
          {a.status === 'CONCLUIDO' && a.formaPagamento && <span className="block text-tinta-suave">Pago com {NOME_FORMA[a.formaPagamento].toLowerCase()}</span>}
        </Linha>
        {a.origem === 'ONLINE' && <Linha icone={User}>Agendado pelo site</Linha>}
        {(a.observacao || a.respostasExtras?.length > 0 || a.motivoCancelamento) && (
          <Linha icone={MessageSquareText}>
            {a.observacao && <p>{a.observacao}</p>}
            {a.respostasExtras?.map((r) => (
              <p key={r.rotulo}>
                <span className="text-tinta-suave">{r.rotulo}: </span>
                {r.resposta}
              </p>
            ))}
            {a.motivoCancelamento && <p className="text-tinta-suave">Motivo do cancelamento: {a.motivoCancelamento}</p>}
          </Linha>
        )}
      </ul>

      {podeGerenciar && (acoes.length > 0 || a.proximosStatus.includes('CANCELADO')) && (
        <div className="grid gap-2 border-t border-borda pt-5">
          {principal && <Botao onClick={() => aoMudarStatus(a, principal)}>{ACAO_STATUS[principal]}</Botao>}
          {acoes
            .filter((x) => x !== principal)
            .map((x) => (
              <Botao key={x} variante={x === 'NAO_COMPARECEU' ? 'perigo' : 'secundario'} onClick={() => aoMudarStatus(a, x)}>
                {ACAO_STATUS[x]}
              </Botao>
            ))}
          {['CONFIRMADO', 'AGUARDANDO_PAGAMENTO'].includes(a.status) && (
            <Botao variante="secundario" onClick={() => aoRemarcar(a)}>
              Remarcar
            </Botao>
          )}
          {a.proximosStatus.includes('CANCELADO') && (
            <Botao variante="fantasma" className="hover:text-erro" onClick={() => aoMudarStatus(a, 'CANCELADO')}>
              Cancelar agendamento
            </Botao>
          )}
        </div>
      )}
    </article>
  );
}
