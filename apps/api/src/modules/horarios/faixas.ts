import { z } from 'zod';

// Faixa de horário: na API trafega como "HH:MM", no banco fica em minutos (09:30 = 570).

export interface FaixaMin {
  inicioMin: number;
  fimMin: number;
}

export function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function paraHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// "24:00" é aceito como fim do dia
const horario = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Formato HH:MM')
  .refine((v) => paraMinutos(v) % 5 === 0, 'Use múltiplos de 5 minutos');

export const faixaSchema = z
  .object({ inicio: horario, fim: horario })
  .refine((f) => paraMinutos(f.inicio) < paraMinutos(f.fim), 'O início precisa ser antes do fim')
  .transform((f) => ({ inicioMin: paraMinutos(f.inicio), fimMin: paraMinutos(f.fim) }));

function semSobreposicao(faixas: FaixaMin[]) {
  const ordenadas = [...faixas].sort((a, b) => a.inicioMin - b.inicioMin);
  return ordenadas.every((f, i) => i === 0 || f.inicioMin >= ordenadas[i - 1]!.fimMin);
}

export const faixasDoDiaSchema = z
  .array(faixaSchema)
  .max(6)
  .refine(semSobreposicao, 'Faixas de horário do mesmo dia se sobrepõem');

// Semana: [{ diaSemana, faixas: [...] }]
export const semanaSchema = z
  .array(z.object({ diaSemana: z.number().int().min(0).max(6), faixas: faixasDoDiaSchema }))
  .max(7)
  .refine((dias) => new Set(dias.map((d) => d.diaSemana)).size === dias.length, 'Dia da semana repetido');

export type Semana = z.infer<typeof semanaSchema>;

// Do banco (lista plana) para a API (agrupado por dia)
export function agruparPorDia(faixas: (FaixaMin & { diaSemana: number })[]) {
  return Array.from({ length: 7 }, (_, diaSemana) => ({
    diaSemana,
    faixas: faixas
      .filter((f) => f.diaSemana === diaSemana)
      .sort((a, b) => a.inicioMin - b.inicioMin)
      .map((f) => ({ inicio: paraHHMM(f.inicioMin), fim: paraHHMM(f.fimMin) })),
  }));
}

export function achatarSemana(semana: Semana) {
  return semana.flatMap((d) => d.faixas.map((f) => ({ diaSemana: d.diaSemana, ...f })));
}
