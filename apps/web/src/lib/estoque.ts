// Fase 7: tipos e formatação do estoque (RF38–RF42)

export type Unidade = 'ML' | 'G' | 'UN';

export const NOME_UNIDADE: Record<Unidade, string> = { ML: 'ml', G: 'g', UN: 'un' };
export const UNIDADE_LONGA: Record<Unidade, string> = { ML: 'Mililitro (ml)', G: 'Grama (g)', UN: 'Unidade' };

export interface Produto {
  id: string;
  nome: string;
  sku: string | null;
  categoria: string | null;
  unidade: Unidade;
  custoMedioCentavos: number;
  estoqueAtual: number;
  estoqueMinimo: number;
  valorEmEstoqueCentavos: number;
  fornecedor: string | null;
  validade: string | null;
  ativo: boolean;
  abaixoDoMinimo: boolean;
  semEstoque: boolean;
  vencido: boolean;
  venceEmBreve: boolean;
  diasParaVencer: number | null;
}

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
export const formatarQuantidade = (q: number, u: Unidade) => `${num.format(q)} ${NOME_UNIDADE[u]}`;

// Custo por unidade costuma ser fração de centavo (R$ 0,047 por ml)
export function formatarCustoUnitario(centavos: number, u: Unidade) {
  const reais = centavos / 100;
  const casas = reais >= 1 ? 2 : reais >= 0.1 ? 3 : 4;
  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: casas });
  return `${fmt.format(reais)}/${NOME_UNIDADE[u]}`;
}

// Aceita "12,5" ou "12.5"; null se não for número
export function numeroDoTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

export const textoDoNumero = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
