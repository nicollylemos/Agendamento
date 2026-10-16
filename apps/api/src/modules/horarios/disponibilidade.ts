import { DateTime } from 'luxon';
import type { FaixaMin } from './faixas.js';

// RF20: disponibilidade = jornada − exceções − bloqueios − agendamentos − intervalo de limpeza.
// Função pura (sem banco), para ser testada com qualquer cenário.

export interface Ocupado {
  inicio: Date;
  fim: Date; // já inclui o intervalo de limpeza do que estava agendado
}

export interface ParametrosCalculo {
  data: string; // YYYY-MM-DD, no fuso da empresa
  zona: string; // ex.: America/Sao_Paulo
  faixas: FaixaMin[]; // faixas que valem nesse dia (jornada ou exceção)
  ocupados: Ocupado[];
  duracaoMin: number;
  limpezaMin: number;
  passoMin?: number; // de quanto em quanto minuto oferecer horário
  agora?: Date;
  antecedenciaMinimaMin?: number; // RF22 (configurável na Fase 5)
}

export function inicioDoDia(data: string, zona: string): DateTime {
  return DateTime.fromISO(data, { zone: zona }).startOf('day');
}

export function diaDaSemana(data: string, zona: string): number {
  return inicioDoDia(data, zona).weekday % 7; // luxon: 1 = segunda … 7 = domingo → 0 = domingo
}

export function calcularHorariosLivres(p: ParametrosCalculo): string[] {
  const passo = p.passoMin ?? 15;
  const dia = inicioDoDia(p.data, p.zona);
  const minutoDe = (d: Date) => DateTime.fromJSDate(d).setZone(p.zona).diff(dia, 'minutes').minutes;

  // Ocupações convertidas para minutos do dia (podem começar antes ou terminar depois)
  const ocupados = p.ocupados.map((o) => ({ ini: minutoDe(o.inicio), fim: minutoDe(o.fim) }));

  const limite = p.agora ? minutoDe(p.agora) + (p.antecedenciaMinimaMin ?? 0) : -Infinity;
  const livres: string[] = [];

  for (const faixa of [...p.faixas].sort((a, b) => a.inicioMin - b.inicioMin)) {
    // Alinha o primeiro horário ao passo (ex.: faixa começa 09:10 com passo 15 → 09:15)
    let t = Math.ceil(faixa.inicioMin / passo) * passo;
    for (; t + p.duracaoMin <= faixa.fimMin; t += passo) {
      if (t < limite) continue;
      // O horário ocupa o atendimento + a limpeza depois dele
      const fimComLimpeza = t + p.duracaoMin + p.limpezaMin;
      const conflita = ocupados.some((o) => t < o.fim && fimComLimpeza > o.ini);
      if (!conflita) livres.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
  }
  return livres;
}
