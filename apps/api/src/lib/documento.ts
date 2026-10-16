// RF06: validação de CPF e CNPJ.
// O CNPJ alfanumérico (emitido a partir de jul/2026) também é aceito:
// os 12 primeiros caracteres podem ser letras, e cada caractere vale
// (código ASCII - 48) no cálculo dos dígitos verificadores.

export function normalizarDocumento(valor: string): string {
  return valor.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function valorDoCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = [...base].reduce((acc, c, i) => acc + valorDoCaractere(c) * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(valor: string): boolean {
  const cpf = normalizarDocumento(valor);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const d1 = digitoVerificador(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cpf.endsWith(`${d1}${d2}`);
}

export function cnpjValido(valor: string): boolean {
  const cnpj = normalizarDocumento(valor);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = digitoVerificador(cnpj.slice(0, 12), pesos1);
  const d2 = digitoVerificador(cnpj.slice(0, 13), pesos2);
  return cnpj.endsWith(`${d1}${d2}`);
}

export function documentoValido(valor: string): boolean {
  const doc = normalizarDocumento(valor);
  return doc.length === 11 ? cpfValido(doc) : doc.length === 14 ? cnpjValido(doc) : false;
}

export function ehCnpj(valor: string | null | undefined): boolean {
  return Boolean(valor && normalizarDocumento(valor).length === 14);
}
