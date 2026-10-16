import { BarChart3, CalendarRange, Gift, Package, PiggyBank, QrCode, Users, Wallet, type LucideIcon } from 'lucide-react';

// Fase 10 (RF47–RF55): mesma estrutura que a API devolve

export type Formato = 'moeda' | 'custo' | 'numero' | 'decimal' | 'pct' | 'horas' | 'data' | 'texto';
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
  vazio: string;
  limitada?: boolean;
}
export interface Ponto {
  rotulo: string;
  valor: number;
}
export type Grafico =
  | { id: string; tipo: 'colunas' | 'barras'; titulo: string; formato: Formato; pontos: Ponto[] }
  | { id: string; tipo: 'mapa'; titulo: string; formato: Formato; linhas: string[]; colunas: string[]; valores: (number | null)[][] };

export interface Relatorio {
  tipo: TipoRelatorio;
  titulo: string;
  descricao: string;
  periodo: { de: string; ate: string };
  profissional: string | null;
  geradoEm: string;
  indicadores: Indicador[];
  graficos: Grafico[];
  tabelas: Tabela[];
}

export type TipoRelatorio = 'faturamento' | 'sinais' | 'ocupacao' | 'servicos' | 'estoque' | 'clientes' | 'fidelidade' | 'comissoes';

export const TIPOS: { tipo: TipoRelatorio; rotulo: string; icone: LucideIcon; requisito: string; porProfissional: boolean; proprio: boolean }[] = [
  { tipo: 'faturamento', rotulo: 'Faturamento', icone: Wallet, requisito: 'RF47', porProfissional: true, proprio: true },
  { tipo: 'sinais', rotulo: 'Sinais', icone: QrCode, requisito: 'RF48', porProfissional: true, proprio: false },
  { tipo: 'ocupacao', rotulo: 'Ocupação', icone: CalendarRange, requisito: 'RF49', porProfissional: true, proprio: true },
  { tipo: 'servicos', rotulo: 'Serviços', icone: BarChart3, requisito: 'RF50', porProfissional: true, proprio: false },
  { tipo: 'estoque', rotulo: 'Estoque', icone: Package, requisito: 'RF51', porProfissional: false, proprio: false },
  { tipo: 'clientes', rotulo: 'Clientes', icone: Users, requisito: 'RF52', porProfissional: true, proprio: false },
  { tipo: 'fidelidade', rotulo: 'Fidelidade', icone: Gift, requisito: 'RF53', porProfissional: false, proprio: false },
  { tipo: 'comissoes', rotulo: 'Comissões', icone: PiggyBank, requisito: 'RF54', porProfissional: true, proprio: true },
];

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const custo = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const numero = (max: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max });

export function horas(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function formatar(valor: Celula | undefined, formato: Formato): string {
  if (valor === null || valor === undefined) return '—';
  if (typeof valor === 'string') return formato === 'data' ? new Date(`${valor}T12:00:00`).toLocaleDateString('pt-BR') : valor;
  switch (formato) {
    case 'moeda':
      return moeda.format(valor / 100);
    case 'custo': // custo por ml/g: até 4 casas
      return custo.format(valor / 100);
    case 'pct':
      return `${numero(1).format(valor * 100)}%`;
    case 'horas':
      return horas(valor);
    case 'decimal':
      return numero(3).format(valor);
    default:
      return numero(0).format(valor);
  }
}

// Eixo do gráfico: números redondos e curtos (R$ 1,2 mil)
export function formatarCurto(valor: number, formato: Formato): string {
  if (formato === 'pct') return `${Math.round(valor * 100)}%`;
  if (formato === 'horas') return `${Math.round(valor / 60)}h`;
  const v = formato === 'moeda' ? valor / 100 : valor;
  const abs = Math.abs(v);
  const curto =
    abs >= 1_000_000 ? `${numero(1).format(v / 1_000_000)} mi` : abs >= 1000 ? `${numero(1).format(v / 1000)} mil` : numero(formato === 'moeda' ? 0 : 1).format(v);
  return formato === 'moeda' ? `R$ ${curto}` : curto;
}

// Escala "bonita": 0, 2, 4, 6… com teto redondo
export function escala(maximo: number, minimo = 0, marcas = 4) {
  const amplitude = Math.max(maximo - Math.min(0, minimo), 1);
  const bruto = amplitude / marcas;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto)!;
  const baixo = Math.min(0, Math.floor(minimo / passo) * passo);
  const alto = Math.max(passo, Math.ceil(maximo / passo) * passo);
  const ticks: number[] = [];
  for (let v = baixo; v <= alto + passo / 2; v += passo) ticks.push(Math.round(v * 1e6) / 1e6);
  return { baixo, alto, ticks };
}

// ─── Período ─────────────────────────────────────────────

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type Preset = 'mes' | 'mes_passado' | '7' | '30' | '90' | 'ano';
export const PRESETS: { id: Preset; rotulo: string }[] = [
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes_passado', rotulo: 'Mês passado' },
  { id: '7', rotulo: 'Últimos 7 dias' },
  { id: '30', rotulo: 'Últimos 30 dias' },
  { id: '90', rotulo: 'Últimos 90 dias' },
  { id: 'ano', rotulo: 'Este ano' },
];

export function periodoDo(preset: Preset, hoje = new Date()): { de: string; ate: string } {
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  switch (preset) {
    case 'mes':
      return { de: iso(new Date(y, m, 1)), ate: iso(hoje) };
    case 'mes_passado':
      return { de: iso(new Date(y, m - 1, 1)), ate: iso(new Date(y, m, 0)) };
    case 'ano':
      return { de: iso(new Date(y, 0, 1)), ate: iso(hoje) };
    default: {
      const dias = Number(preset);
      return { de: iso(new Date(y, m, hoje.getDate() - dias + 1)), ate: iso(hoje) };
    }
  }
}

export function presetDe(de: string, ate: string): Preset | null {
  return PRESETS.find((p) => {
    const x = periodoDo(p.id);
    return x.de === de && x.ate === ate;
  })?.id ?? null;
}
