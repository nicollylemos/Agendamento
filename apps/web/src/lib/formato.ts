const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarCentavos(centavos: number): string {
  return moeda.format(centavos / 100);
}

// "R$ 1.234,56" ou "1234,56" → 123456
export function centavosDoTexto(texto: string): number {
  const digitos = texto.replace(/\D/g, '');
  return digitos ? Number(digitos) : 0;
}

export function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const NOME_PERFIL = { ADMIN: 'Administrador', GERENTE: 'Gerente', FUNCIONARIO: 'Funcionário' } as const;
