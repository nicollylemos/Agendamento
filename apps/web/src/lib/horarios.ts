export interface Faixa {
  inicio: string;
  fim: string;
}

export interface DiaSemana {
  diaSemana: number;
  faixas: Faixa[];
}

export interface Excecao {
  id: string;
  funcionarioId: string | null;
  data: string;
  tipo: 'FOLGA' | 'HORARIO_ESPECIAL';
  faixas: Faixa[];
  motivo: string | null;
}

export interface Bloqueio {
  id: string;
  funcionarioId: string;
  inicio: string; // AAAA-MM-DDTHH:MM
  fim: string;
  motivo: string | null;
}

export function semanaVazia(): DiaSemana[] {
  return Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, faixas: [] }));
}

// Segunda primeiro, domingo por último (como o comércio costuma pensar a semana)
export const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

export function hojeISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const fmtData = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
export function formatarData(iso: string) {
  return fmtData.format(new Date(`${iso}T12:00:00`));
}

export function formatarPeriodo(inicio: string, fim: string) {
  const [di, hi] = inicio.split('T');
  const [df, hf] = fim.split('T');
  return di === df ? `${formatarData(di!)}, ${hi} às ${hf}` : `${formatarData(di!)} ${hi} até ${formatarData(df!)} ${hf}`;
}
