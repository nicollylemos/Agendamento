// RF47–RF55: todo relatório tem o mesmo formato. A tela, o CSV e o PDF
// leem esta estrutura, então um relatório novo não precisa de código de exportação.

export type Formato =
  | 'moeda' // centavos
  | 'custo' // centavos com até 4 casas (custo por ml/g)
  | 'numero' // inteiro
  | 'decimal' // até 3 casas (quantidade de estoque)
  | 'pct' // fração: 0.42 = 42%
  | 'horas' // minutos
  | 'data' // YYYY-MM-DD
  | 'texto';

export type Celula = string | number | null;

export interface Indicador {
  id: string;
  rotulo: string;
  valor: number | null;
  formato: Formato;
  ajuda?: string;
}

export interface Coluna {
  id: string;
  rotulo: string;
  formato: Formato;
}

export interface Tabela {
  id: string;
  titulo: string;
  colunas: Coluna[];
  linhas: Record<string, Celula>[];
  total?: Record<string, Celula>;
  vazio: string; // o que mostrar quando não há linhas
  limitada?: boolean; // true = mostrou só as primeiras linhas
}

export interface Ponto {
  rotulo: string;
  valor: number;
}

export type Grafico =
  // Evolução no tempo (uma série)
  | { id: string; tipo: 'colunas'; titulo: string; formato: Formato; pontos: Ponto[] }
  // Comparação entre categorias (uma série, em ordem)
  | { id: string; tipo: 'barras'; titulo: string; formato: Formato; pontos: Ponto[] }
  // Dia da semana × hora
  | { id: string; tipo: 'mapa'; titulo: string; formato: Formato; linhas: string[]; colunas: string[]; valores: (number | null)[][] };

export interface Relatorio {
  tipo: string;
  titulo: string;
  descricao: string;
  periodo: { de: string; ate: string };
  profissional: string | null; // filtro aplicado
  geradoEm: string;
  indicadores: Indicador[];
  graficos: Grafico[];
  tabelas: Tabela[];
}
