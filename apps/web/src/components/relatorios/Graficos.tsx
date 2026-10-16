import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { cx } from '../ui';
import { escala, formatar, formatarCurto, type Formato, type Grafico, type Ponto } from '../../lib/relatorios';

// Fase 10 (RF47–RF54): gráficos em SVG/HTML puro, sem biblioteca.
// Cor da série validada (dataviz: faixa de luminosidade, croma e contraste ≥ 3:1 no branco).
// O texto nunca usa a cor da série: valores e rótulos ficam em tinta/tinta-suave.
// Azul-ardósia discreto: único tom de dado num painel grafite e branco
const SERIE = '#4a6fb0';
const SERIE_HOVER = '#34528a';
const GRADE = '#efeeeb';
// Escala sequencial (um tom só, do claro ao escuro) para o mapa de ocupação
const RAMPA = ['#f0f3f9', '#cfd9ec', '#a3b6dc', '#7590c6', '#4a6fb0', '#34528a'];

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.floor(e!.contentRect.width)));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return { ref, largura };
}

function Dica({ x, y, valor, rotulo, visivel }: { x: number; y: number; valor: string; rotulo: string; visivel: boolean }) {
  return (
    <div
      role="status"
      className={cx(
        'pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-borda bg-superficie px-2.5 py-1.5 text-xs shadow-[0_8px_24px_-12px_rgba(20,22,22,0.25)] transition-opacity',
        visivel ? 'opacity-100' : 'opacity-0',
      )}
      style={{ left: x, top: y - 8 }}
    >
      <span className="block text-sm font-semibold text-tinta tabular-nums">{valor}</span>
      <span className="text-tinta-suave">{rotulo}</span>
    </div>
  );
}

// ─── Colunas: evolução no tempo ──────────────────────────

export function GraficoColunas({ pontos, formato, titulo }: { pontos: Ponto[]; formato: Formato; titulo: string }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const ALTURA = 220;
  const M = { esq: 64, dir: 8, topo: 20, base: 26 };
  const maximo = Math.max(...pontos.map((p) => p.valor), 0);
  const { alto, ticks } = escala(maximo);
  const area = Math.max(largura - M.esq - M.dir, 10);
  const banda = area / Math.max(pontos.length, 1);
  const larg = Math.max(2, Math.min(24, banda - 2)); // ≤ 24px; o resto da banda é respiro
  const y = (v: number) => M.topo + (ALTURA - M.topo - M.base) * (1 - v / alto);
  const passoRotulo = Math.max(1, Math.ceil(46 / banda)); // rótulos do eixo X sem encavalar
  const maiorIdx = pontos.findIndex((p) => p.valor === maximo && maximo > 0);

  function teclado(e: KeyboardEvent) {
    if (!pontos.length) return;
    if (e.key === 'ArrowRight') setAtivo((a) => Math.min(pontos.length - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setAtivo((a) => Math.max(0, (a ?? pontos.length) - 1));
    else return;
    e.preventDefault();
  }

  return (
    <div
      ref={ref}
      className="relative"
      tabIndex={0}
      aria-label={`${titulo}. Use as setas para ver cada valor.`}
      onKeyDown={teclado}
      onBlur={() => setAtivo(null)}
      onPointerLeave={() => setAtivo(null)}
    >
      {largura > 0 && (
        <svg width={largura} height={ALTURA} role="img" aria-hidden className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.esq} x2={largura - M.dir} y1={y(t)} y2={y(t)} stroke={GRADE} strokeWidth={1} />
              <text x={M.esq - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-tinta-suave text-[11px] tabular-nums">
                {formatarCurto(t, formato)}
              </text>
            </g>
          ))}
          {pontos.map((p, i) => {
            const cx0 = M.esq + banda * i + banda / 2;
            const h = Math.max(0, y(0) - y(p.valor));
            const r = Math.min(4, h, larg / 2);
            const x0 = cx0 - larg / 2;
            const topo = y(0) - h;
            return (
              <g key={i}>
                {h > 0 && (
                  // Ponta arredondada (4px) em cima, base reta na linha do zero
                  <path
                    d={`M${x0},${y(0)} V${topo + r} Q${x0},${topo} ${x0 + r},${topo} H${x0 + larg - r} Q${x0 + larg},${topo} ${x0 + larg},${topo + r} V${y(0)} Z`}
                    fill={ativo === i ? SERIE_HOVER : SERIE}
                  />
                )}
                {i % passoRotulo === 0 && (
                  <text x={cx0} y={ALTURA - 6} textAnchor="middle" className="fill-tinta-suave text-[11px]">
                    {p.rotulo}
                  </text>
                )}
                {/* Só o maior valor ganha rótulo; o resto fica no eixo, na dica e na tabela */}
                {i === maiorIdx && ativo === null && (
                  <text x={cx0} y={topo - 6} textAnchor={i > pontos.length * 0.8 ? 'end' : i < pontos.length * 0.2 ? 'start' : 'middle'} className="fill-tinta text-[11px] font-semibold tabular-nums">
                    {formatar(p.valor, formato)}
                  </text>
                )}
                {/* Área de toque: a banda inteira, não só a coluna */}
                <rect x={M.esq + banda * i} y={M.topo} width={banda} height={ALTURA - M.topo - M.base} fill="transparent" onPointerEnter={() => setAtivo(i)} />
              </g>
            );
          })}
          <line x1={M.esq} x2={largura - M.dir} y1={y(0)} y2={y(0)} stroke="#c9c8c3" strokeWidth={1} />
        </svg>
      )}
      {ativo !== null && pontos[ativo] && (
        <Dica
          visivel
          x={Math.min(Math.max(M.esq + banda * ativo + banda / 2, 60), largura - 60)}
          y={y(pontos[ativo].valor)}
          valor={formatar(pontos[ativo].valor, formato)}
          rotulo={pontos[ativo].rotulo}
        />
      )}
    </div>
  );
}

// ─── Barras: comparação entre categorias ─────────────────

export function GraficoBarras({ pontos, formato }: { pontos: Ponto[]; formato: Formato }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const maximo = Math.max(...pontos.map((p) => p.valor), 0);
  const minimo = Math.min(...pontos.map((p) => p.valor), 0);
  const amplitude = maximo - minimo || 1;
  const zero = (-minimo / amplitude) * 100; // posição da linha do zero, em %
  const total = pontos.reduce((t, p) => t + Math.max(0, p.valor), 0);

  return (
    <ul className="grid gap-1.5">
      {pontos.map((p, i) => {
        const largura = (Math.abs(p.valor) / amplitude) * 100;
        const negativo = p.valor < 0;
        return (
          <li
            key={`${p.rotulo}-${i}`}
            tabIndex={0}
            className="group grid grid-cols-1 gap-x-3 gap-y-0.5 rounded px-1 py-1 outline-offset-0 hover:bg-fundo focus-visible:bg-fundo sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-center"
            onPointerEnter={() => setAtivo(i)}
            onPointerLeave={() => setAtivo(null)}
            onFocus={() => setAtivo(i)}
            onBlur={() => setAtivo(null)}
            aria-label={`${p.rotulo}: ${formatar(p.valor, formato)}`}
          >
            <span className="truncate text-sm text-tinta" title={p.rotulo}>
              {p.rotulo}
            </span>
            <div className="relative flex h-6 items-center">
              <div className="relative h-full min-w-0 flex-1">
                {minimo < 0 && <span className="absolute inset-y-0 w-px bg-borda-campo" style={{ left: `${zero}%` }} aria-hidden />}
                <span
                  className={cx('absolute top-1 bottom-1 transition-colors', negativo ? 'rounded-l' : 'rounded-r')}
                  style={{
                    left: negativo ? `${zero - largura}%` : `${zero}%`,
                    width: `max(${largura}%, ${p.valor ? 2 : 0}px)`,
                    background: ativo === i ? SERIE_HOVER : SERIE,
                  }}
                  aria-hidden
                />
              </div>
              {/* Valor na ponta (fora da barra, em tinta) */}
              <span className="ml-2 shrink-0 text-sm font-medium tabular-nums text-tinta">
                {formatar(p.valor, formato)}
                {ativo === i && total > 0 && p.valor > 0 && <span className="ml-1.5 font-normal text-tinta-suave">({formatar(p.valor / total, 'pct')})</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Mapa de calor: dia da semana × hora ─────────────────

function corDaRampa(v: number) {
  const pos = Math.min(1, Math.max(0, v)) * (RAMPA.length - 1);
  const i = Math.min(RAMPA.length - 2, Math.floor(pos));
  const t = pos - i;
  const a = RAMPA[i]!.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const b = RAMPA[i + 1]!.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const c = a.map((x, k) => Math.round(x + (b[k]! - x) * t));
  // Texto branco ou tinta, conforme a luminância do fundo
  const lum = (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255;
  return { fundo: `rgb(${c.join(',')})`, texto: lum < 0.55 ? '#ffffff' : '#26292a' };
}

export function MapaCalor({ linhas, colunas, valores, formato }: { linhas: string[]; colunas: string[]; valores: (number | null)[][]; formato: Formato }) {
  const [ativo, setAtivo] = useState<{ l: number; c: number } | null>(null);
  const dica = ativo ? valores[ativo.l]?.[ativo.c] : undefined;
  return (
    <div className="grid gap-3">
      <div className="relative overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs" style={{ minWidth: colunas.length * 34 + 48 }}>
          <thead>
            <tr>
              <th className="w-10" />
              {colunas.map((c) => (
                <th key={c} scope="col" className="pb-1 font-normal text-tinta-suave">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, li) => (
              <tr key={l}>
                <th scope="row" className="pr-2 text-left font-normal text-tinta-suave">
                  {l}
                </th>
                {colunas.map((c, ci) => {
                  const v = valores[li]?.[ci] ?? null;
                  const cor = v === null ? null : corDaRampa(v);
                  const sel = ativo?.l === li && ativo.c === ci;
                  return (
                    <td
                      key={c}
                      tabIndex={0}
                      aria-label={`${l} ${c}: ${v === null ? 'sem expediente' : formatar(v, formato)}`}
                      onPointerEnter={() => setAtivo({ l: li, c: ci })}
                      onPointerLeave={() => setAtivo(null)}
                      onFocus={() => setAtivo({ l: li, c: ci })}
                      onBlur={() => setAtivo(null)}
                      className={cx('h-8 rounded-sm text-center tabular-nums', sel && 'outline-2 outline-tinta')}
                      style={
                        cor
                          ? { background: cor.fundo, color: cor.texto }
                          : { background: 'repeating-linear-gradient(135deg, #f6f6f4 0 4px, #ebeae7 4px 5px)' }
                      }
                    >
                      {v !== null && Math.round(v * 100)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-tinta-suave">
        <span className="flex items-center gap-2">
          0%
          <span className="h-2.5 w-32 rounded-sm" style={{ background: `linear-gradient(90deg, ${RAMPA.join(',')})` }} aria-hidden />
          100% ocupado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, #f6f6f4 0 4px, #ebeae7 4px 5px)' }} aria-hidden />
          sem expediente
        </span>
        <span aria-live="polite" className="min-h-4 font-medium text-tinta">
          {ativo &&
            `${linhas[ativo.l]} ${colunas[ativo.c]}: ${dica === null || dica === undefined ? 'sem expediente' : `${formatar(dica, formato)} ocupado`}`}
        </span>
      </div>
    </div>
  );
}

// ─── Cartão com alternância gráfico/tabela ───────────────

export function CartaoGrafico({ grafico }: { grafico: Grafico }) {
  const [tabela, setTabela] = useState(false);
  const id = useId();
  const vazio = grafico.tipo === 'mapa' ? !grafico.linhas.length : !grafico.pontos.length || grafico.pontos.every((p) => p.valor === 0);
  useEffect(() => setTabela(false), [grafico.id]);

  let conteudo: ReactNode;
  if (vazio) conteudo = <p className="py-10 text-center text-sm text-tinta-suave">Sem dados no período.</p>;
  else if (tabela) conteudo = <TabelaDoGrafico grafico={grafico} />;
  else if (grafico.tipo === 'colunas') conteudo = <GraficoColunas pontos={grafico.pontos} formato={grafico.formato} titulo={grafico.titulo} />;
  else if (grafico.tipo === 'barras') conteudo = <GraficoBarras pontos={grafico.pontos} formato={grafico.formato} />;
  else if (grafico.tipo === 'mapa') conteudo = <MapaCalor linhas={grafico.linhas} colunas={grafico.colunas} valores={grafico.valores} formato={grafico.formato} />;

  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl border border-borda bg-superficie p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 id={id} className="font-medium">
          {grafico.titulo}
        </h3>
        {!vazio && (
          <div role="group" aria-label="Forma de ver" className="flex shrink-0 rounded-lg border border-borda p-0.5">
            {[
              { v: false, icone: BarChart3, rotulo: 'Gráfico' },
              { v: true, icone: Table2, rotulo: 'Tabela' },
            ].map((o) => (
              <button
                key={o.rotulo}
                type="button"
                aria-pressed={tabela === o.v}
                title={o.rotulo}
                onClick={() => setTabela(o.v)}
                className={cx('flex size-7 items-center justify-center rounded', tabela === o.v ? 'bg-fundo text-tinta' : 'text-tinta-suave hover:text-tinta')}
              >
                <o.icone className="size-4" strokeWidth={1.6} aria-hidden />
                <span className="sr-only">{o.rotulo}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {conteudo}
    </section>
  );
}

function TabelaDoGrafico({ grafico }: { grafico: Grafico }) {
  if (grafico.tipo === 'mapa') {
    return (
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-tinta-suave">
              <th className="py-1.5 pr-3 font-medium">Dia</th>
              {grafico.colunas.map((c) => (
                <th key={c} className="px-2 py-1.5 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {grafico.linhas.map((l, li) => (
              <tr key={l}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                  {l}
                </th>
                {grafico.colunas.map((c, ci) => (
                  <td key={c} className="px-2 py-1.5 text-right tabular-nums">
                    {formatar(grafico.valores[li]?.[ci] ?? null, grafico.formato)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="relative max-h-80 overflow-y-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-borda">
          {grafico.pontos.map((p, i) => (
            <tr key={i}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                {p.rotulo}
              </th>
              <td className="py-1.5 text-right tabular-nums">{formatar(p.valor, grafico.formato)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
