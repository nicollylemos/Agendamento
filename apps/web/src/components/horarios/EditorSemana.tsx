import { Plus, X } from 'lucide-react';
import { DIAS_SEMANA } from '../../lib/formato';
import { ORDEM_DIAS, type DiaSemana, type Faixa } from '../../lib/horarios';
import { Entrada } from '../ui';

// RF16/RF17: semana com várias faixas por dia (o almoço é o espaço entre elas)
export function EditorSemana({
  valor,
  aoMudar,
  somenteLeitura,
}: {
  valor: DiaSemana[];
  aoMudar?: (v: DiaSemana[]) => void;
  somenteLeitura?: boolean;
}) {
  const mudarDia = (dia: number, faixas: Faixa[]) => aoMudar?.(valor.map((d) => (d.diaSemana === dia ? { ...d, faixas } : d)));

  return (
    <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
      {ORDEM_DIAS.map((dia) => {
        const faixas = valor.find((d) => d.diaSemana === dia)?.faixas ?? [];
        return (
          <li key={dia} className="grid gap-3 px-4 py-3 sm:grid-cols-[100px_1fr] sm:items-start">
            <span className="font-medium sm:pt-2">{DIAS_SEMANA[dia]}</span>
            <div className="flex flex-wrap items-center gap-2">
              {faixas.length === 0 && <span className="text-sm text-tinta-suave sm:py-2">Não atende</span>}
              {faixas.map((f, i) =>
                somenteLeitura ? (
                  <span key={i} className="rounded-md bg-destaque-claro px-3 py-1.5 text-sm text-destaque-forte">
                    {f.inicio} às {f.fim}
                  </span>
                ) : (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-borda bg-fundo p-1 pl-2 text-sm">
                    <Entrada
                      type="time"
                      step={300}
                      className="h-8 w-[6.5rem]"
                      aria-label={`${DIAS_SEMANA[dia]}, início da faixa ${i + 1}`}
                      value={f.inicio}
                      onChange={(e) => mudarDia(dia, faixas.map((x, j) => (j === i ? { ...x, inicio: e.target.value } : x)))}
                    />
                    às
                    <Entrada
                      type="time"
                      step={300}
                      className="h-8 w-[6.5rem]"
                      aria-label={`${DIAS_SEMANA[dia]}, fim da faixa ${i + 1}`}
                      value={f.fim}
                      onChange={(e) => mudarDia(dia, faixas.map((x, j) => (j === i ? { ...x, fim: e.target.value } : x)))}
                    />
                    <button
                      type="button"
                      onClick={() => mudarDia(dia, faixas.filter((_, j) => j !== i))}
                      className="rounded p-1 text-tinta-suave hover:text-erro"
                      aria-label={`Remover faixa ${f.inicio} às ${f.fim} de ${DIAS_SEMANA[dia]}`}
                    >
                      <X className="size-4" />
                    </button>
                  </span>
                ),
              )}
              {!somenteLeitura && faixas.length < 6 && (
                <button
                  type="button"
                  onClick={() => {
                    const ultima = faixas.at(-1);
                    // Sugere a próxima faixa logo depois da última (ex.: volta do almoço)
                    const nova = ultima ? { inicio: somarHora(ultima.fim, 60), fim: somarHora(ultima.fim, 300) } : { inicio: '09:00', fim: '18:00' };
                    mudarDia(dia, [...faixas, nova]);
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-destaque hover:bg-destaque-claro"
                >
                  <Plus className="size-4" aria-hidden />
                  {faixas.length ? 'Faixa' : 'Atende neste dia'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function somarHora(hhmm: string, minutos: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h! * 60 + m! + minutos, 23 * 60 + 55);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
