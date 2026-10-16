import { describe, it, expect } from 'vitest';
import { cpfValido, cnpjValido, documentoValido } from './documento.js';

describe('documento (RF06)', () => {
  it('CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  it('CNPJ numérico', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
  });

  it('CNPJ alfanumérico (exemplo oficial da Receita)', () => {
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true);
    expect(cnpjValido('12.ABC.345/01DE-36')).toBe(false);
  });

  it('decide pelo tamanho', () => {
    expect(documentoValido('52998224725')).toBe(true);
    expect(documentoValido('123')).toBe(false);
  });
});
