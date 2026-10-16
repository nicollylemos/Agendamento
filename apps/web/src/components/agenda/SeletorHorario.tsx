import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { hojeISO, somarDias } from '../../lib/horarios';
import { Aviso, Carregando, cx, Entrada } from '../ui';

interface Disponibilidade {
  profissionais: { id: string; nome: string; horarios: string[] }[];
}

const fmtDiaSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const fmtDiaMes = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

// RF20/RF21: faixa com os próximos dias e os horários livres do dia escolhido.
// Sem profissional escolhido, junta os horários de todos ("qualquer um").
export function SeletorHorario({
  servicoId,
  funcionarioId,
  data,
  aoMudarData,
  horario,
  aoMudarHorario,
  diasAFrente = 60,
}: {
  servicoId: string;
  funcionarioId: string | null;
  data: string;
  aoMudarData: (d: string) => void;
  horario: string | null;
  aoMudarHorario: (h: string) => void;
  diasAFrente?: number;
}) {
  const hoje = hojeISO();
  const dias = useMemo(() => Array.from({ length: 14 }, (_, i) => somarDias(hoje, i)), [hoje]);

  // Quais dias têm vaga: a tela já abre no primeiro dia livre e apaga os dias sem horário
  const livres = useQuery({
    queryKey: ['dias-livres', servicoId, funcionarioId],
    queryFn: () => api<{ data: string; livres: number }[]>(`/public/dias-livres?servicoId=${servicoId}${funcionarioId ? `&funcionarioId=${funcionarioId}` : ''}`, { semRenovar: true }),
  });
  const vagas = useMemo(() => new Map((livres.data ?? []).map((d) => [d.data, d.livres])), [livres.data]);
  const escolheu = useRef(false);
  useEffect(() => {
    if (escolheu.current || !livres.data) return;
    const atual = vagas.get(data);
    if (atual === 0) {
      const primeiro = livres.data.find((d) => d.livres > 0);
      if (primeiro) aoMudarData(primeiro.data);
    }
  }, [livres.data, vagas, data, aoMudarData]);
  const semNenhum = livres.data !== undefined && livres.data.every((d) => d.livres === 0);
  const escolher = (d: string) => {
    escolheu.current = true;
    aoMudarData(d);
  };

  const disp = useQuery({
    queryKey: ['disponibilidade', servicoId, funcionarioId, data],
    queryFn: () =>
      api<Disponibilidade>(
        `/public/disponibilidade?servicoId=${servicoId}&data=${data}${funcionarioId ? `&funcionarioId=${funcionarioId}` : ''}`,
        { semRenovar: true },
      ),
  });

  const horarios = useMemo(
    () => [...new Set(disp.data?.profissionais.flatMap((p) => p.horarios) ?? [])].sort(),
    [disp.data],
  );

  return (
    <div className="grid gap-6">
      {/* min-w-0: fieldset tem largura mínima = conteúdo; sem isso a fileira de dias estoura a tela no celular (RNF06) */}
      <fieldset className="min-w-0">
        <legend className="mb-3 font-semibold">Dia</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          {dias.map((d) => {
            const dt = new Date(`${d}T12:00:00`);
            const ativo = d === data;
            const semVaga = vagas.get(d) === 0;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={ativo}
                aria-label={semVaga ? `${d}, sem horário livre` : undefined}
                onClick={() => escolher(d)}
                className={cx(
                  'flex w-16 shrink-0 flex-col items-center rounded-lg border py-2 text-sm transition-colors',
                  ativo ? 'border-destaque bg-destaque text-white' : semVaga ? 'border-borda bg-fundo text-tinta-suave/60 line-through' : 'border-borda bg-superficie hover:border-destaque',
                )}
              >
                <span className={cx('text-xs capitalize', ativo ? 'text-white/85' : 'text-tinta-suave')}>
                  {d === hoje ? 'hoje' : fmtDiaSemana.format(dt).replace('.', '')}
                </span>
                <span className="font-semibold">{fmtDiaMes.format(dt)}</span>
              </button>
            );
          })}
        </div>
        <label className="mt-2 inline-flex items-center gap-2 text-sm text-tinta-suave">
          Outra data
          <Entrada type="date" className="h-9 w-auto" min={hoje} max={somarDias(hoje, diasAFrente)} value={data} onChange={(e) => e.target.value && escolher(e.target.value)} />
        </label>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-3 font-semibold">Horário</legend>
        {disp.isLoading ? (
          <Carregando texto="Buscando horários…" />
        ) : disp.error ? (
          <Aviso>{(disp.error as Error).message}</Aviso>
        ) : horarios.length === 0 ? (
          <p className="rounded-lg border border-dashed border-borda px-4 py-6 text-center text-sm text-tinta-suave">
            {semNenhum
              ? 'Não há horários livres nos próximos dias. Fale com a gente pelo WhatsApp para encaixar.'
              : 'Nenhum horário livre nesse dia. Os dias riscados também estão cheios; escolha outro.'}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {horarios.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={h === horario}
                onClick={() => aoMudarHorario(h)}
                className={cx(
                  'rounded-md border py-2 text-sm font-medium transition-colors',
                  h === horario ? 'border-destaque bg-destaque text-white' : 'border-borda bg-superficie hover:border-destaque',
                )}
              >
                {h}
              </button>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
