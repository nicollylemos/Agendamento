import { describe, it, expect } from 'vitest';
import { intersecao, ocupacaoDoDia, porHora, subtrair, unir } from './intervalos.js';
import { celulaSegura, formatar } from './exportar.js';

describe('RF49: contas de intervalo', () => {
  it('une, subtrai e cruza', () => {
    expect(unir([[60, 120], [100, 180], [200, 210]])).toEqual([[60, 180], [200, 210]]);
    expect(subtrair([[540, 1080]], [[600, 720]])).toEqual([[540, 600], [720, 1080]]);
    expect(intersecao([[540, 600], [720, 1080]], [[570, 750]])).toEqual([[570, 600], [720, 750]]);
  });

  it('distribui minutos por hora', () => {
    const h = porHora([[570, 650]]);
    expect(h[9]).toBe(30);
    expect(h[10]).toBe(50);
    expect(h.reduce((a, b) => a + b, 0)).toBe(80);
  });

  it('ocupação do dia: agendado fora da jornada não conta', () => {
    const r = ocupacaoDoDia({ jornada: [[540, 720]], bloqueios: [[600, 660]], agendados: [[480, 600], [660, 700]] });
    expect(r.disponivelMin).toBe(120);
    expect(r.ocupadoMin).toBe(100);
  });
});

describe('RF55: formatação de exportação', () => {
  it('neutraliza fórmula no CSV', () => {
    expect(celulaSegura('=1+1')).toBe("'=1+1");
    expect(celulaSegura('+55 15')).toBe("'+55 15");
    expect(celulaSegura('@SOMA')).toBe("'@SOMA");
    expect(celulaSegura('a;b')).toBe('"a;b"');
    expect(celulaSegura('Ana')).toBe('Ana');
  });

  it('formata para leitura', () => {
    expect(formatar(123456, 'moeda').replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatar(0.425, 'pct')).toBe('42,5%');
    expect(formatar(150, 'horas')).toBe('2h30');
    expect(formatar(null, 'moeda')).toBe('—');
    expect(formatar('2026-09-07', 'data')).toBe('07/09/2026');
  });
});
