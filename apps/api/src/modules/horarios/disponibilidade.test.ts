import { describe, it, expect } from 'vitest';
import { calcularHorariosLivres, diaDaSemana } from './disponibilidade.js';
import { faixasDoDiaSchema } from './faixas.js';

const zona = 'America/Sao_Paulo';
const data = '2026-10-20'; // terça
const h = (hhmm: string) => new Date(`${data}T${hhmm}:00-03:00`);

const base = {
  data,
  zona,
  faixas: [{ inicioMin: 9 * 60, fimMin: 12 * 60 }],
  ocupados: [],
  duracaoMin: 60,
  limpezaMin: 0,
  passoMin: 30,
};

describe('RF20: cálculo de horários livres', () => {
  it('oferece horários dentro da faixa, cabendo a duração inteira', () => {
    expect(calcularHorariosLivres(base)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('respeita o almoço (buraco entre faixas)', () => {
    const r = calcularHorariosLivres({ ...base, faixas: [{ inicioMin: 540, fimMin: 660 }, { inicioMin: 780, fimMin: 900 }] });
    expect(r).toEqual(['09:00', '09:30', '10:00', '13:00', '13:30', '14:00']);
  });

  it('desconta bloqueios e agendamentos', () => {
    const r = calcularHorariosLivres({ ...base, ocupados: [{ inicio: h('10:00'), fim: h('10:30') }] });
    // 09:30 terminaria 10:30 (conflita), 10:00 conflita; 10:30 em diante livre
    expect(r).toEqual(['09:00', '10:30', '11:00']);
  });

  it('o intervalo de limpeza do serviço novo não pode invadir o próximo cliente', () => {
    const r = calcularHorariosLivres({ ...base, limpezaMin: 15, ocupados: [{ inicio: h('11:00'), fim: h('12:00') }] });
    // 09:30 + 60 min + 15 de limpeza = 10:45 → ok; 10:00 → 11:15, invade
    expect(r).toEqual(['09:00', '09:30']);
  });

  it('não oferece horário que já passou nem dentro da antecedência mínima', () => {
    const r = calcularHorariosLivres({ ...base, agora: h('09:40'), antecedenciaMinimaMin: 60 });
    expect(r).toEqual(['11:00']);
  });

  it('alinha o primeiro horário ao passo', () => {
    const r = calcularHorariosLivres({ ...base, faixas: [{ inicioMin: 9 * 60 + 10, fimMin: 11 * 60 }] });
    expect(r).toEqual(['09:30', '10:00']); // 10:00 termina exatamente às 11:00
  });

  it('ocupação que vem do dia anterior também conta', () => {
    const r = calcularHorariosLivres({ ...base, ocupados: [{ inicio: new Date('2026-10-19T23:00:00-03:00'), fim: h('09:30') }] });
    expect(r[0]).toBe('09:30');
  });

  it('dia da semana no fuso da empresa', () => {
    expect(diaDaSemana('2026-10-20', zona)).toBe(2);
    expect(diaDaSemana('2026-10-18', zona)).toBe(0);
  });
});

describe('validação de faixas', () => {
  it('recusa faixas sobrepostas e fim antes do início', () => {
    expect(faixasDoDiaSchema.safeParse([{ inicio: '09:00', fim: '12:00' }, { inicio: '11:00', fim: '14:00' }]).success).toBe(false);
    expect(faixasDoDiaSchema.safeParse([{ inicio: '12:00', fim: '09:00' }]).success).toBe(false);
    expect(faixasDoDiaSchema.safeParse([{ inicio: '09:07', fim: '12:00' }]).success).toBe(false);
  });
  it('aceita faixas encostadas e fim às 24:00', () => {
    expect(faixasDoDiaSchema.safeParse([{ inicio: '09:00', fim: '12:00' }, { inicio: '12:00', fim: '24:00' }]).success).toBe(true);
  });
});
