// Fase 8: tipos e textos da fidelidade (RF43–RF46)

export type TipoPrograma = 'PONTOS' | 'SELOS';
export type TipoRecompensa = 'DESCONTO' | 'SERVICO' | 'PRODUTO';
export type StatusVoucher = 'DISPONIVEL' | 'USADO' | 'CANCELADO' | 'EXPIRADO';

export interface Programa {
  ativo: boolean;
  tipo: TipoPrograma;
  pontosPorReal: number;
  pontosPorAtendimento: number;
  servicosElegiveis: string[];
  validadeDias: number | null;
}

export interface Recompensa {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: TipoRecompensa;
  custoPontos: number;
  valorCentavos: number | null;
  servicoId: string | null;
  validadeDias: number;
  ativo: boolean;
}

export interface Voucher {
  id: string;
  codigo: string;
  status: StatusVoucher;
  pontos: number;
  expiraEm: string;
  usadoEm: string | null;
  criadoEm: string;
  recompensa: { id: string; nome: string; tipo: TipoRecompensa; valorCentavos: number | null };
}

export interface LinhaExtrato {
  id: string;
  tipo: 'CREDITO' | 'ESTORNO' | 'RESGATE' | 'DEVOLUCAO' | 'AJUSTE' | 'EXPIRACAO';
  descricao: string;
  pontos: number;
  criadoEm: string;
  motivo?: string | null;
  usuario?: string | null;
}

export interface ResumoCliente {
  cliente: { id: string; nome: string; telefone?: string; email?: string | null };
  saldo: number;
  proximoVencimento: { pontos: number; em: string } | null;
  extrato: LinhaExtrato[];
  vouchers: Voucher[];
}

export const NOME_TIPO_RECOMPENSA: Record<TipoRecompensa, string> = { DESCONTO: 'Desconto', SERVICO: 'Serviço grátis', PRODUTO: 'Brinde' };

export const NOME_VOUCHER: Record<StatusVoucher, string> = { DISPONIVEL: 'Disponível', USADO: 'Usado', CANCELADO: 'Cancelado', EXPIRADO: 'Vencido' };

export function unidade(tipo: TipoPrograma | undefined, n: number) {
  const [um, varios] = tipo === 'SELOS' ? ['selo', 'selos'] : ['ponto', 'pontos'];
  return `${n.toLocaleString('pt-BR')} ${Math.abs(n) === 1 ? um : varios}`;
}

// "Cada R$ 1 vale 1 ponto, +10 por visita"
export function regraTexto(p: Pick<Programa, 'tipo' | 'pontosPorReal' | 'pontosPorAtendimento' | 'validadeDias'>) {
  const partes =
    p.tipo === 'SELOS'
      ? ['Cada atendimento vale 1 selo']
      : [
          p.pontosPorReal ? `Cada R$ 1 gasto vale ${unidade('PONTOS', p.pontosPorReal)}` : null,
          p.pontosPorAtendimento ? `${p.pontosPorReal ? '+' : 'Cada visita vale'} ${unidade('PONTOS', p.pontosPorAtendimento)}${p.pontosPorReal ? ' por visita' : ''}` : null,
        ].filter(Boolean);
  const anos = p.validadeDias && p.validadeDias % 365 === 0 ? p.validadeDias / 365 : null;
  const meses = p.validadeDias && !anos && p.validadeDias % 30 === 0 ? p.validadeDias / 30 : null;
  const prazo = anos ? `${anos} ${anos === 1 ? 'ano' : 'anos'}` : meses ? `${meses} meses` : `${p.validadeDias} dias`;
  const validade = p.validadeDias ? `Valem por ${prazo}.` : 'Não vencem.';
  return `${partes.join(', ')}. ${validade}`;
}

export const dataBr = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
