import { useEffect, useState, type CSSProperties } from 'react';
import { cx } from '../ui';
import { hora, minutosDoDia, NOME_SITUACAO, situacaoDe, tom, type ColunaAgenda, type ItemAgenda, type Situacao } from '../../lib/agenda';

// Grade de horários (RF24/RF26): eixo de horas à esquerda e uma coluna por
// profissional (visão Dia) ou por dia (visão Semana). Cada atendimento fica na altura do
// horário, com a cor da situação (aguardando sinal, sinal pago, concluído...).

const PX_POR_MIN = 1.1; // 66 px por hora
const ESCONDIDOS = ['CANCELADO', 'EXPIRADO'];

function agoraEmMinutos() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Itens que se cruzam na mesma coluna (ex.: falta + novo encaixe) dividem a largura
function emFaixas(itens: ItemAgenda[]) {
  const ordenados = [...itens].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const fimDaFaixa: number[] = [];
  const posicao = new Map<string, number>();
  for (const a of ordenados) {
    const ini = minutosDoDia(a.inicio);
    let faixa = fimDaFaixa.findIndex((fim) => fim <= ini);
    if (faixa === -1) faixa = fimDaFaixa.push(0) - 1;
    fimDaFaixa[faixa] = minutosDoDia(a.fim);
    posicao.set(a.id, faixa);
  }
  return { posicao, total: Math.max(1, fimDaFaixa.length) };
}

export interface ColunaGrade {
  id: string;
  titulo: string;
  subtitulo?: string;
  hoje?: boolean; // linha do "agora" e título em destaque
  itens: ItemAgenda[];
}

// Bloco de um atendimento, com a cor da situação
export function BlocoAtendimento({
  a,
  cores,
  selecionado,
  aoClicar,
  mostrarProfissional,
  compacto,
  estreito,
  className,
  style,
}: {
  a: ItemAgenda;
  cores: Record<Situacao, string>;
  selecionado?: boolean;
  aoClicar?: (a: ItemAgenda) => void;
  mostrarProfissional?: boolean;
  compacto?: boolean;
  estreito?: boolean; // muitos ao mesmo tempo: só a cor (o nome fica no painel ao clicar)
  className?: string;
  style?: CSSProperties;
}) {
  const s = situacaoDe(a);
  const cor = cores[s];
  return (
    <button
      type="button"
      onClick={() => aoClicar?.(a)}
      aria-pressed={selecionado}
      title={`${hora(a.inicio)} às ${hora(a.fim)}, ${a.cliente.nome}, ${a.servico.nome} (${NOME_SITUACAO[s]})`}
      aria-label={`${hora(a.inicio)} às ${hora(a.fim)}, ${a.cliente.nome}, ${a.servico.nome}, ${NOME_SITUACAO[s]}`}
      className={cx(
        'overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-xs text-tinta transition-[box-shadow]',
        selecionado ? 'z-20 shadow-[0_0_0_2px_var(--color-tinta)]' : 'hover:z-20 hover:shadow-[0_0_0_1px_#c9c8c3]',
        s === 'CANCELADO' && 'text-tinta-suave line-through',
        className,
      )}
      style={{ background: tom(cor), borderLeftColor: cor, ...style }}
    >
      {estreito ? null : <span className="font-medium tabular-nums">{hora(a.inicio)}</span>}
      {estreito ? null : compacto ? (
        <span className="ml-1 font-medium">{a.cliente.nome}</span>
      ) : (
        <>
          <span className="block truncate text-[0.8125rem] font-medium leading-tight">{a.cliente.nome}</span>
          <span className="block truncate text-tinta-suave">
            {a.servico.nome}
            {mostrarProfissional && `, ${a.funcionario.nome.split(' ')[0]}`}
          </span>
        </>
      )}
    </button>
  );
}

export function GradeHoras({
  colunas,
  cores,
  selecionadoId,
  aoClicar,
  mostrarProfissional,
  larguraMinima = 150,
  inicioPadrao = 8 * 60,
  fimPadrao = 19 * 60,
}: {
  colunas: ColunaGrade[];
  cores: Record<Situacao, string>;
  selecionadoId?: string | null;
  aoClicar?: (a: ItemAgenda) => void;
  mostrarProfissional?: boolean;
  larguraMinima?: number;
  inicioPadrao?: number;
  fimPadrao?: number;
}) {
  const algumHoje = colunas.some((c) => c.hoje);
  const [agora, setAgora] = useState(agoraEmMinutos);
  useEffect(() => {
    if (!algumHoje) return;
    const t = setInterval(() => setAgora(agoraEmMinutos()), 60_000);
    return () => clearInterval(t);
  }, [algumHoje]);

  const visiveis = colunas.flatMap((c) => c.itens.filter((a) => !ESCONDIDOS.includes(a.status)));
  // O eixo cresce para caber atendimentos fora do horário padrão
  const inicioEixo = Math.floor(Math.min(inicioPadrao, ...visiveis.map((a) => minutosDoDia(a.inicio))) / 60) * 60;
  const fimEixo = Math.ceil(Math.max(fimPadrao, ...visiveis.map((a) => minutosDoDia(a.fim))) / 60) * 60;
  const altura = (fimEixo - inicioEixo) * PX_POR_MIN;
  const horas = Array.from({ length: (fimEixo - inicioEixo) / 60 + 1 }, (_, i) => inicioEixo + i * 60);

  return (
    <div className="relative overflow-x-auto rounded-xl border border-borda bg-superficie">
      <div className="grid min-w-full" style={{ gridTemplateColumns: `52px repeat(${colunas.length}, minmax(${larguraMinima}px, 1fr))` }}>
        {/* Cabeçalho */}
        <div className="sticky left-0 z-20 border-b border-borda bg-superficie" />
        {colunas.map((c) => (
          <div key={c.id} className="border-b border-l border-borda px-3 py-2.5">
            <p className={cx('truncate text-sm', c.hoje ? 'font-semibold' : 'font-medium')}>{c.titulo}</p>
            {c.subtitulo && <p className="truncate text-xs text-tinta-suave">{c.subtitulo}</p>}
          </div>
        ))}

        {/* Eixo de horas */}
        <div className="sticky left-0 z-10 bg-superficie" style={{ height: altura }}>
          {horas.map((h, i) => (
            <span
              key={h}
              className={cx('absolute right-2 text-[0.6875rem] tabular-nums text-tinta-suave', i === 0 ? '' : i === horas.length - 1 ? '-translate-y-full' : '-translate-y-1/2')}
              style={{ top: (h - inicioEixo) * PX_POR_MIN }}
            >
              {String(h / 60).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {colunas.map((c) => {
          const daColuna = c.itens.filter((a) => !ESCONDIDOS.includes(a.status));
          const { posicao, total } = emFaixas(daColuna);
          return (
            <div key={c.id} className={cx('relative border-l border-borda', c.hoje && 'bg-fundo/40')} style={{ height: altura }}>
              {horas.map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-borda/70" style={{ top: (h - inicioEixo) * PX_POR_MIN }} />
              ))}
              {c.hoje && agora >= inicioEixo && agora <= fimEixo && (
                <div className="absolute inset-x-0 z-10 border-t border-erro" style={{ top: (agora - inicioEixo) * PX_POR_MIN }} aria-hidden>
                  <span className="absolute -left-1 -top-1 size-2 rounded-full bg-erro" />
                </div>
              )}
              {daColuna.map((a) => {
                const ini = minutosDoDia(a.inicio);
                const dur = Math.max(minutosDoDia(a.fim) - ini, 15);
                const faixa = posicao.get(a.id) ?? 0;
                return (
                  <BlocoAtendimento
                    key={a.id}
                    a={a}
                    cores={cores}
                    selecionado={selecionadoId === a.id}
                    aoClicar={aoClicar}
                    mostrarProfissional={mostrarProfissional}
                    compacto={dur < 40}
                    estreito={total >= 3}
                    className="absolute"
                    style={{
                      top: (ini - inicioEixo) * PX_POR_MIN + 1,
                      height: dur * PX_POR_MIN - 2,
                      left: `calc(${(faixa / total) * 100}% + 3px)`,
                      width: `calc(${100 / total}% - 6px)`,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Visão Dia: uma coluna por profissional
const contar = (n: number) => (n === 0 ? 'Livre' : n === 1 ? '1 atendimento' : `${n} atendimentos`);

export function GradeDia({
  itens,
  colunas,
  ehHoje,
  cores,
  selecionadoId,
  aoClicar,
}: {
  itens: ItemAgenda[];
  colunas: ColunaAgenda[];
  ehHoje: boolean;
  cores: Record<Situacao, string>;
  selecionadoId?: string | null;
  aoClicar?: (a: ItemAgenda) => void;
}) {
  const visiveis = itens.filter((a) => !ESCONDIDOS.includes(a.status));
  // Profissional que tem atendimento mas saiu da lista (ex.: desativado) também aparece
  const todas = [...colunas];
  for (const a of visiveis) if (!todas.some((c) => c.id === a.funcionario.id)) todas.push({ id: a.funcionario.id, nome: a.funcionario.nome });

  if (!todas.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-borda px-6 py-14 text-center">
        <p className="font-medium">Nenhum profissional cadastrado</p>
        <p className="text-sm text-tinta-suave">Cadastre quem atende em Equipe para a agenda aparecer aqui.</p>
      </div>
    );
  }
  return (
    <GradeHoras
      cores={cores}
      selecionadoId={selecionadoId}
      aoClicar={aoClicar}
      colunas={todas.map((c) => {
        const deles = itens.filter((a) => a.funcionario.id === c.id);
        return { id: c.id, titulo: c.nome, subtitulo: contar(deles.filter((a) => !ESCONDIDOS.includes(a.status)).length), hoje: ehHoje, itens: deles };
      })}
    />
  );
}

// Legenda: a mesma cor e o mesmo nome em todo o painel
export function LegendaSituacoes({ cores, contagem }: { cores: Record<Situacao, string>; contagem?: Partial<Record<Situacao, number>> }) {
  const lista = (Object.keys(NOME_SITUACAO) as Situacao[]).filter((s) => !contagem || contagem[s]);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-tinta-suave">
      {lista.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: cores[s] }} aria-hidden />
          {NOME_SITUACAO[s]}
          {contagem && <span className="tabular-nums text-tinta">{contagem[s]}</span>}
        </li>
      ))}
    </ul>
  );
}
