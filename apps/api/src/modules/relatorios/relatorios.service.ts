import { DateTime } from 'luxon';
import type { FormaPagamento, StatusAgendamento, StatusPagamento } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { zonaDaEmpresa } from '../horarios/horarios.service.js';
import { situacao as situacaoProduto } from '../estoque/estoque.service.js';
import { ocupacaoDoDia, type Intervalo } from './intervalos.js';
import type { Filtro, TipoRelatorio } from './relatorios.schemas.js';
import type { Celula, Grafico, Indicador, Ponto, Relatorio, Tabela } from './relatorios.tipos.js';

// RF47–RF54. Só leitura: nada aqui altera o banco.
// Período sempre no fuso da empresa, pela data do atendimento (início).

const LIMITE_DETALHE = 500;

interface Contexto {
  zona: string;
  ini: DateTime;
  fim: DateTime; // exclusivo (meia-noite do dia seguinte ao "até")
  filtro: Filtro;
  profissional: string | null;
}

async function contexto(filtro: Filtro): Promise<Contexto> {
  const zona = await zonaDaEmpresa();
  const ini = DateTime.fromISO(filtro.de, { zone: zona }).startOf('day');
  const fim = DateTime.fromISO(filtro.ate, { zone: zona }).plus({ days: 1 }).startOf('day');
  let profissional: string | null = null;
  if (filtro.funcionarioId) {
    const f = await prisma.funcionario.findUnique({ where: { id: filtro.funcionarioId }, select: { nome: true } });
    if (!f) throw new AppError('NAO_ENCONTRADO', 'Profissional não encontrado', 404);
    profissional = f.nome;
  }
  return { zona, ini, fim, filtro, profissional };
}

const periodo = (c: Contexto) => ({ inicio: { gte: c.ini.toJSDate(), lt: c.fim.toJSDate() } });
const doProfissional = (c: Contexto) => (c.filtro.funcionarioId ? { funcionarioId: c.filtro.funcionarioId } : {});

function montar(
  c: Contexto,
  tipo: TipoRelatorio,
  titulo: string,
  descricao: string,
  partes: { indicadores: Indicador[]; graficos: Grafico[]; tabelas: Tabela[] },
): Relatorio {
  return {
    tipo,
    titulo,
    descricao,
    periodo: { de: c.filtro.de, ate: c.filtro.ate },
    profissional: c.profissional,
    geradoEm: new Date().toISOString(),
    ...partes,
  };
}

// Soma agrupada por chave, mantendo um rótulo
class Agrupador<T extends Record<string, number>> {
  private mapa = new Map<string, { rotulo: string; v: T }>();
  constructor(private zero: () => T) {}
  somar(chave: string, rotulo: string, valores: Partial<T>) {
    let item = this.mapa.get(chave);
    if (!item) {
      item = { rotulo, v: this.zero() };
      this.mapa.set(chave, item);
    }
    for (const [k, n] of Object.entries(valores)) (item.v as Record<string, number>)[k]! += n as number;
  }
  lista() {
    return [...this.mapa.entries()].map(([chave, { rotulo, v }]) => ({ chave, rotulo, ...v }));
  }
}

// Eixo do tempo: por dia até ~2 meses, por mês acima disso. Sem buracos: dia sem venda = 0.
function eixoDoTempo(c: Contexto) {
  const porDia = c.fim.diff(c.ini, 'days').days <= 62;
  const chaveDe = (d: DateTime) => (porDia ? d.toISODate()! : d.toFormat('yyyy-MM'));
  const baldes: { chave: string; rotulo: string }[] = [];
  for (let d = c.ini; d < c.fim; d = d.plus({ days: 1 })) {
    const chave = chaveDe(d);
    if (baldes.at(-1)?.chave !== chave) {
      baldes.push({ chave, rotulo: porDia ? d.toFormat('dd/MM') : d.setLocale('pt-BR').toFormat('LLL/yy').replace('.', '') });
    }
  }
  return { baldes, chave: (data: Date) => chaveDe(DateTime.fromJSDate(data).setZone(c.zona)), porDia };
}

const FORMAS: Record<FormaPagamento, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  OUTRO: 'Outro',
};

const STATUS: Record<StatusAgendamento, string> = {
  AGUARDANDO_PAGAMENTO: 'Aguardando sinal',
  CONFIRMADO: 'Confirmado',
  EM_ATENDIMENTO: 'Em atendimento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado (sinal não pago)',
  NAO_COMPARECEU: 'Não compareceu',
};

const pct = (parte: number, todo: number) => (todo > 0 ? parte / todo : null);
const valorPago = (p: { valorCentavos: number; valorPagoCentavos: number | null }) => p.valorPagoCentavos ?? p.valorCentavos;
const dataLocal = (d: Date, zona: string) => DateTime.fromJSDate(d).setZone(zona).toISODate()!;

// RF54: comissão congelada ao concluir; atendimentos antigos (antes da Fase 10) usam o % atual
async function regrasDeComissao() {
  const [sfs, fs] = await Promise.all([
    prisma.servicoFuncionario.findMany({ where: { comissaoPct: { not: null } }, select: { servicoId: true, funcionarioId: true, comissaoPct: true } }),
    prisma.funcionario.findMany({ select: { id: true, comissaoPadraoPct: true } }),
  ]);
  const porServico = new Map(sfs.map((s) => [`${s.servicoId}|${s.funcionarioId}`, Number(s.comissaoPct)]));
  const padrao = new Map(fs.map((f) => [f.id, Number(f.comissaoPadraoPct)]));
  return (a: { servicoId: string; funcionarioId: string; valorCentavos: number; comissaoCentavos: number | null }) =>
    a.comissaoCentavos ??
    Math.round((a.valorCentavos * (porServico.get(`${a.servicoId}|${a.funcionarioId}`) ?? padrao.get(a.funcionarioId) ?? 0)) / 100);
}

// ─── RF47: faturamento ───────────────────────────────────

async function faturamento(c: Contexto): Promise<Relatorio> {
  const ags = await prisma.agendamento.findMany({
    where: { ...periodo(c), ...doProfissional(c), status: { in: ['CONCLUIDO', 'CANCELADO', 'NAO_COMPARECEU'] } },
    select: {
      inicio: true,
      status: true,
      valorCentavos: true,
      formaPagamento: true,
      servico: { select: { id: true, nome: true } },
      funcionario: { select: { id: true, nome: true } },
      pagamentos: { select: { status: true, valorCentavos: true, valorPagoCentavos: true } },
    },
  });
  const tempo = eixoDoTempo(c);
  const porTempo = new Map<string, number>();
  const formas = new Agrupador(() => ({ valor: 0, qtd: 0 }));
  const servicos = new Agrupador(() => ({ valor: 0, qtd: 0 }));
  const pessoas = new Agrupador(() => ({ valor: 0, qtd: 0 }));
  let receita = 0;
  let concluidos = 0;
  let retido = 0;

  for (const a of ags) {
    const soma = (s: StatusPagamento) => a.pagamentos.filter((p) => p.status === s).reduce((t, p) => t + valorPago(p), 0);
    if (a.status !== 'CONCLUIDO') {
      // RF32: sinal que a empresa ficou (cancelou fora do prazo ou faltou) também é faturamento
      const r = soma('RETIDO');
      if (r) {
        retido += r;
        formas.somar('RETIDO', 'Sinal retido (Pix)', { valor: r, qtd: 1 });
        porTempo.set(tempo.chave(a.inicio), (porTempo.get(tempo.chave(a.inicio)) ?? 0) + r);
      }
      continue;
    }
    concluidos++;
    receita += a.valorCentavos;
    porTempo.set(tempo.chave(a.inicio), (porTempo.get(tempo.chave(a.inicio)) ?? 0) + a.valorCentavos);
    // RF33: o sinal pago pelo Pix foi abatido; o restante foi pago no balcão
    const sinal = Math.min(soma('APROVADO'), a.valorCentavos);
    if (sinal) formas.somar('SINAL', 'Pix (sinal)', { valor: sinal, qtd: 1 });
    const restante = a.valorCentavos - sinal;
    if (restante > 0) {
      const f = a.formaPagamento;
      formas.somar(f ?? 'NAO_INFORMADO', f ? FORMAS[f] : 'Não informado', { valor: restante, qtd: 1 });
    }
    servicos.somar(a.servico.id, a.servico.nome, { valor: a.valorCentavos, qtd: 1 });
    pessoas.somar(a.funcionario.id, a.funcionario.nome, { valor: a.valorCentavos, qtd: 1 });
  }
  const total = receita + retido;
  const ordenar = <T extends { valor: number }>(l: T[]) => l.sort((x, y) => y.valor - x.valor);

  return montar(c, 'faturamento', 'Faturamento', 'Atendimentos concluídos no período, mais os sinais que a empresa reteve.', {
    indicadores: [
      { id: 'total', rotulo: 'Faturamento', valor: total, formato: 'moeda' },
      { id: 'concluidos', rotulo: 'Atendimentos concluídos', valor: concluidos, formato: 'numero' },
      { id: 'ticket', rotulo: 'Ticket médio', valor: concluidos ? Math.round(receita / concluidos) : null, formato: 'moeda' },
      { id: 'retido', rotulo: 'Sinais retidos', valor: retido, formato: 'moeda', ajuda: 'Cancelamentos fora do prazo e faltas' },
    ],
    graficos: [
      {
        id: 'evolucao',
        tipo: 'colunas',
        titulo: tempo.porDia ? 'Faturamento por dia' : 'Faturamento por mês',
        formato: 'moeda',
        pontos: tempo.baldes.map((b) => ({ rotulo: b.rotulo, valor: porTempo.get(b.chave) ?? 0 })),
      },
      { id: 'formas', tipo: 'barras', titulo: 'Por forma de pagamento', formato: 'moeda', pontos: ordenar(formas.lista()).map((f) => ({ rotulo: f.rotulo, valor: f.valor })) },
    ],
    tabelas: [
      {
        id: 'formas',
        titulo: 'Por forma de pagamento',
        colunas: [
          { id: 'forma', rotulo: 'Forma', formato: 'texto' },
          { id: 'valor', rotulo: 'Valor', formato: 'moeda' },
          { id: 'participacao', rotulo: 'Participação', formato: 'pct' },
        ],
        linhas: ordenar(formas.lista()).map((f) => ({ forma: f.rotulo, valor: f.valor, participacao: pct(f.valor, total) })),
        total: { forma: 'Total', valor: total, participacao: total ? 1 : null },
        vazio: 'Nenhum valor recebido no período.',
      },
      {
        id: 'servicos',
        titulo: 'Por serviço',
        colunas: [
          { id: 'servico', rotulo: 'Serviço', formato: 'texto' },
          { id: 'qtd', rotulo: 'Atendimentos', formato: 'numero' },
          { id: 'valor', rotulo: 'Receita', formato: 'moeda' },
          { id: 'participacao', rotulo: 'Participação', formato: 'pct' },
        ],
        linhas: ordenar(servicos.lista()).map((s) => ({ servico: s.rotulo, qtd: s.qtd, valor: s.valor, participacao: pct(s.valor, receita) })),
        vazio: 'Nenhum atendimento concluído no período.',
      },
      {
        id: 'profissionais',
        titulo: 'Por profissional',
        colunas: [
          { id: 'profissional', rotulo: 'Profissional', formato: 'texto' },
          { id: 'qtd', rotulo: 'Atendimentos', formato: 'numero' },
          { id: 'valor', rotulo: 'Receita', formato: 'moeda' },
          { id: 'ticket', rotulo: 'Ticket médio', formato: 'moeda' },
        ],
        linhas: ordenar(pessoas.lista()).map((p) => ({ profissional: p.rotulo, qtd: p.qtd, valor: p.valor, ticket: Math.round(p.valor / p.qtd) })),
        vazio: 'Nenhum atendimento concluído no período.',
      },
    ],
  });
}

// ─── RF48: sinais ────────────────────────────────────────

function situacaoSinal(p: { status: StatusPagamento; pagoEm: Date | null }, statusAgendamento: StatusAgendamento) {
  switch (p.status) {
    case 'PENDENTE':
      return 'Aguardando pagamento';
    case 'APROVADO':
      return statusAgendamento === 'CONCLUIDO' ? 'Abatido no atendimento' : 'Pago, atendimento a fazer';
    case 'RETIDO':
      return 'Retido';
    case 'REEMBOLSADO':
      return 'Devolvido';
    case 'REEMBOLSO_PENDENTE':
    case 'RECEBIDO_APOS_EXPIRAR':
      return 'Devolução pendente';
    case 'CANCELADO':
      return p.pagoEm ? 'Devolvido' : 'Não pago (expirou ou cancelado)';
  }
}

async function sinais(c: Contexto): Promise<Relatorio> {
  const pags = await prisma.pagamento.findMany({
    where: { agendamento: { ...periodo(c), ...doProfissional(c) } },
    orderBy: { createdAt: 'asc' },
    select: {
      status: true,
      valorCentavos: true,
      valorPagoCentavos: true,
      pagoEm: true,
      agendamento: { select: { inicio: true, status: true, cliente: { select: { nome: true } }, servico: { select: { nome: true } } } },
    },
  });
  const grupos = new Agrupador(() => ({ valor: 0, qtd: 0 }));
  let recebido = 0;
  let retido = 0;
  let devolvido = 0;
  let pendente = 0;
  let expirados = 0;
  const linhas = pags.map((p) => {
    const s = situacaoSinal(p, p.agendamento.status);
    const valor = p.pagoEm ? valorPago(p) : p.valorCentavos;
    if (p.pagoEm) recebido += valor;
    if (s === 'Retido') retido += valor;
    if (s === 'Devolvido') devolvido += valor;
    if (s === 'Devolução pendente') pendente += valor;
    if (s.startsWith('Não pago')) expirados++;
    grupos.somar(s, s, { valor, qtd: 1 });
    return { data: dataLocal(p.agendamento.inicio, c.zona), cliente: p.agendamento.cliente.nome, servico: p.agendamento.servico.nome, valor, situacao: s };
  });
  const lista = grupos.lista().sort((a, b) => b.valor - a.valor);

  return montar(c, 'sinais', 'Sinais (Pix)', 'Sinais dos agendamentos do período: o que entrou, ficou com a empresa, voltou ao cliente ou não foi pago.', {
    indicadores: [
      { id: 'recebido', rotulo: 'Recebido via Pix', valor: recebido, formato: 'moeda' },
      { id: 'retido', rotulo: 'Retido', valor: retido, formato: 'moeda', ajuda: 'Cancelamento fora do prazo ou falta' },
      { id: 'devolvido', rotulo: 'Devolvido', valor: devolvido, formato: 'moeda' },
      { id: 'pendente', rotulo: 'Devolução pendente', valor: pendente, formato: 'moeda' },
      { id: 'expirados', rotulo: 'Não pagos', valor: expirados, formato: 'numero', ajuda: 'Cobranças que expiraram ou foram canceladas antes do pagamento' },
    ],
    graficos: [{ id: 'situacao', tipo: 'barras', titulo: 'Valor por situação', formato: 'moeda', pontos: lista.map((g) => ({ rotulo: g.rotulo, valor: g.valor })) }],
    tabelas: [
      {
        id: 'situacao',
        titulo: 'Por situação',
        colunas: [
          { id: 'situacao', rotulo: 'Situação', formato: 'texto' },
          { id: 'qtd', rotulo: 'Cobranças', formato: 'numero' },
          { id: 'valor', rotulo: 'Valor', formato: 'moeda' },
        ],
        linhas: lista.map((g) => ({ situacao: g.rotulo, qtd: g.qtd, valor: g.valor })),
        vazio: 'Nenhuma cobrança de sinal no período.',
      },
      {
        id: 'detalhe',
        titulo: 'Cobranças',
        colunas: [
          { id: 'data', rotulo: 'Atendimento', formato: 'data' },
          { id: 'cliente', rotulo: 'Cliente', formato: 'texto' },
          { id: 'servico', rotulo: 'Serviço', formato: 'texto' },
          { id: 'valor', rotulo: 'Valor', formato: 'moeda' },
          { id: 'situacao', rotulo: 'Situação', formato: 'texto' },
        ],
        linhas: linhas.slice(0, LIMITE_DETALHE),
        limitada: linhas.length > LIMITE_DETALHE,
        vazio: 'Nenhuma cobrança de sinal no período.',
      },
    ],
  });
}

// ─── RF49: ocupação ──────────────────────────────────────

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

async function ocupacao(c: Contexto): Promise<Relatorio> {
  const funcionarios = await prisma.funcionario.findMany({
    where: c.filtro.funcionarioId ? { id: c.filtro.funcionarioId } : { ativo: true },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    select: { id: true, nome: true },
  });
  const ids = funcionarios.map((f) => f.id);
  const [jornada, excecoes, bloqueios, ags] = await Promise.all([
    prisma.jornadaFaixa.findMany({ where: { funcionarioId: { in: ids } } }),
    prisma.excecaoHorario.findMany({
      where: {
        data: { gte: new Date(`${c.filtro.de}T00:00:00Z`), lte: new Date(`${c.filtro.ate}T00:00:00Z`) },
        OR: [{ funcionarioId: { in: ids } }, { funcionarioId: null }],
      },
    }),
    prisma.bloqueio.findMany({
      where: { funcionarioId: { in: ids }, inicio: { lt: c.fim.toJSDate() }, fim: { gt: c.ini.toJSDate() } },
      select: { funcionarioId: true, inicio: true, fim: true },
    }),
    prisma.agendamento.findMany({
      where: { funcionarioId: { in: ids }, ...periodo(c), status: { notIn: ['CANCELADO', 'EXPIRADO'] } },
      select: { funcionarioId: true, inicio: true, fim: true, status: true },
    }),
  ]);

  // Distribui intervalos absolutos pelos dias que tocam, em minutos do dia
  const porDia = new Map<string, Intervalo[]>();
  const distribuir = (prefixo: string, fid: string, inicio: Date, fim: Date) => {
    let dia = DateTime.fromJSDate(inicio).setZone(c.zona).startOf('day');
    const fimDt = DateTime.fromJSDate(fim).setZone(c.zona);
    for (; dia < fimDt; dia = dia.plus({ days: 1 })) {
      const a = Math.max(0, DateTime.fromJSDate(inicio).setZone(c.zona).diff(dia, 'minutes').minutes);
      const b = Math.min(1440, fimDt.diff(dia, 'minutes').minutes);
      const chave = `${prefixo}|${fid}|${dia.toISODate()}`;
      porDia.set(chave, [...(porDia.get(chave) ?? []), [a, b]]);
    }
  };
  for (const b of bloqueios) distribuir('b', b.funcionarioId, b.inicio, b.fim);
  for (const a of ags) {
    distribuir('a', a.funcionarioId, a.inicio, a.fim);
    if (a.status === 'NAO_COMPARECEU') distribuir('f', a.funcionarioId, a.inicio, a.fim);
  }

  const mapaDisp = DIAS.map(() => Array<number>(24).fill(0));
  const mapaOcup = DIAS.map(() => Array<number>(24).fill(0));
  const linhas: Record<string, Celula>[] = [];
  let disponivelTotal = 0;
  let ocupadoTotal = 0;
  let faltasTotal = 0;

  for (const f of funcionarios) {
    let disp = 0;
    let ocup = 0;
    for (let dia = c.ini; dia < c.fim; dia = dia.plus({ days: 1 })) {
      const iso = dia.toISODate()!;
      // Mesma prioridade da agenda (RF20): exceção do profissional > exceção geral > jornada
      const doDia = excecoes.filter((e) => e.data.toISOString().slice(0, 10) === iso);
      const excecao = doDia.find((e) => e.funcionarioId === f.id) ?? doDia.find((e) => e.funcionarioId === null);
      const faixas = excecao
        ? excecao.tipo === 'FOLGA'
          ? []
          : (excecao.faixas as unknown as { inicioMin: number; fimMin: number }[])
        : jornada.filter((j) => j.funcionarioId === f.id && j.diaSemana === dia.weekday % 7);
      if (!faixas.length) continue;
      const r = ocupacaoDoDia({
        jornada: faixas.map((x) => [x.inicioMin, x.fimMin] as Intervalo),
        bloqueios: porDia.get(`b|${f.id}|${iso}`) ?? [],
        agendados: porDia.get(`a|${f.id}|${iso}`) ?? [],
      });
      disp += r.disponivelMin;
      ocup += r.ocupadoMin;
      faltasTotal += ocupacaoDoDia({ jornada: faixas.map((x) => [x.inicioMin, x.fimMin] as Intervalo), bloqueios: [], agendados: porDia.get(`f|${f.id}|${iso}`) ?? [] }).ocupadoMin;
      const linha = dia.weekday - 1; // 0 = segunda
      r.disponivelPorHora.forEach((m, h) => (mapaDisp[linha]![h]! += m));
      r.ocupadoPorHora.forEach((m, h) => (mapaOcup[linha]![h]! += m));
    }
    disponivelTotal += disp;
    ocupadoTotal += ocup;
    const deles = ags.filter((a) => a.funcionarioId === f.id);
    linhas.push({
      profissional: f.nome,
      disponivel: disp,
      ocupado: ocup,
      taxa: pct(ocup, disp),
      atendimentos: deles.length,
      faltas: deles.filter((a) => a.status === 'NAO_COMPARECEU').length,
    });
  }

  // Só as horas em que alguém trabalha
  const horas = [...Array(24).keys()].filter((h) => mapaDisp.some((l) => l[h]! > 0));
  return montar(c, 'ocupacao', 'Ocupação da agenda', 'Horas agendadas sobre as horas disponíveis (jornada, exceções e bloqueios). Cancelados e expirados não contam.', {
    indicadores: [
      { id: 'taxa', rotulo: 'Taxa de ocupação', valor: pct(ocupadoTotal, disponivelTotal), formato: 'pct' },
      { id: 'disponivel', rotulo: 'Horas disponíveis', valor: disponivelTotal, formato: 'horas' },
      { id: 'ocupado', rotulo: 'Horas agendadas', valor: ocupadoTotal, formato: 'horas' },
      { id: 'faltas', rotulo: 'Horas perdidas com faltas', valor: faltasTotal, formato: 'horas' },
    ],
    graficos: horas.length
      ? [
          {
            id: 'mapa',
            tipo: 'mapa',
            titulo: 'Ocupação por dia da semana e hora',
            formato: 'pct',
            linhas: DIAS,
            colunas: horas.map((h) => `${String(h).padStart(2, '0')}h`),
            valores: DIAS.map((_, l) => horas.map((h) => pct(mapaOcup[l]![h]!, mapaDisp[l]![h]!))),
          },
        ]
      : [],
    tabelas: [
      {
        id: 'profissionais',
        titulo: 'Por profissional',
        colunas: [
          { id: 'profissional', rotulo: 'Profissional', formato: 'texto' },
          { id: 'disponivel', rotulo: 'Disponível', formato: 'horas' },
          { id: 'ocupado', rotulo: 'Agendado', formato: 'horas' },
          { id: 'taxa', rotulo: 'Ocupação', formato: 'pct' },
          { id: 'atendimentos', rotulo: 'Agendamentos', formato: 'numero' },
          { id: 'faltas', rotulo: 'Faltas', formato: 'numero' },
        ],
        linhas,
        vazio: 'Nenhum profissional com jornada no período.',
      },
    ],
  });
}

// ─── RF50: rentabilidade por serviço ─────────────────────

async function servicos(c: Contexto): Promise<Relatorio> {
  const [ags, comissao] = await Promise.all([
    prisma.agendamento.findMany({
      where: { ...periodo(c), ...doProfissional(c), status: 'CONCLUIDO' },
      select: {
        servicoId: true,
        funcionarioId: true,
        valorCentavos: true,
        custoCentavos: true,
        comissaoCentavos: true,
        servico: { select: { nome: true } },
      },
    }),
    regrasDeComissao(),
  ]);
  const g = new Agrupador(() => ({ qtd: 0, receita: 0, custo: 0, comissao: 0, semCusto: 0 }));
  for (const a of ags) {
    g.somar(a.servicoId, a.servico.nome, {
      qtd: 1,
      receita: a.valorCentavos,
      custo: a.custoCentavos ?? 0,
      comissao: comissao(a),
      semCusto: a.custoCentavos === null ? 1 : 0,
    });
  }
  const lista = g
    .lista()
    .map((s) => ({ ...s, margem: s.receita - s.custo - s.comissao }))
    .sort((a, b) => b.margem - a.margem);
  const soma = (k: 'receita' | 'custo' | 'comissao' | 'margem') => lista.reduce((t, s) => t + s[k], 0);
  const semCusto = lista.reduce((t, s) => t + s.semCusto, 0);

  return montar(c, 'servicos', 'Rentabilidade por serviço', 'Receita dos atendimentos concluídos, menos o custo dos produtos (ficha técnica) e a comissão.', {
    indicadores: [
      { id: 'receita', rotulo: 'Receita', valor: soma('receita'), formato: 'moeda' },
      { id: 'custo', rotulo: 'Custo de produtos', valor: soma('custo'), formato: 'moeda' },
      { id: 'comissao', rotulo: 'Comissões', valor: soma('comissao'), formato: 'moeda' },
      {
        id: 'margem',
        rotulo: 'Margem',
        valor: pct(soma('margem'), soma('receita')),
        formato: 'pct',
        ...(semCusto && { ajuda: `${semCusto} atendimento(s) sem custo registrado` }),
      },
    ],
    graficos: [{ id: 'margem', tipo: 'barras', titulo: 'Margem por serviço', formato: 'moeda', pontos: lista.slice(0, 12).map((s) => ({ rotulo: s.rotulo, valor: s.margem })) }],
    tabelas: [
      {
        id: 'servicos',
        titulo: 'Por serviço',
        colunas: [
          { id: 'servico', rotulo: 'Serviço', formato: 'texto' },
          { id: 'qtd', rotulo: 'Atendimentos', formato: 'numero' },
          { id: 'receita', rotulo: 'Receita', formato: 'moeda' },
          { id: 'custo', rotulo: 'Custo', formato: 'moeda' },
          { id: 'comissao', rotulo: 'Comissão', formato: 'moeda' },
          { id: 'margem', rotulo: 'Margem', formato: 'moeda' },
          { id: 'margemPct', rotulo: 'Margem %', formato: 'pct' },
        ],
        linhas: lista.map((s) => ({
          servico: s.rotulo,
          qtd: s.qtd,
          receita: s.receita,
          custo: s.custo,
          comissao: s.comissao,
          margem: s.margem,
          margemPct: pct(s.margem, s.receita),
        })),
        total: {
          servico: 'Total',
          qtd: ags.length,
          receita: soma('receita'),
          custo: soma('custo'),
          comissao: soma('comissao'),
          margem: soma('margem'),
          margemPct: pct(soma('margem'), soma('receita')),
        },
        vazio: 'Nenhum atendimento concluído no período.',
      },
    ],
  });
}

// ─── RF51: estoque ───────────────────────────────────────

const UNIDADE = { ML: 'ml', G: 'g', UN: 'un' } as const;

async function estoque(c: Contexto): Promise<Relatorio> {
  const [produtos, movs] = await Promise.all([
    prisma.produto.findMany({ where: { deletedAt: null }, orderBy: { nome: 'asc' } }),
    prisma.movimentacaoEstoque.findMany({
      where: { createdAt: { gte: c.ini.toJSDate(), lt: c.fim.toJSDate() } },
      select: { produtoId: true, tipo: true, quantidade: true, custoUnitario: true, produto: { select: { nome: true, unidade: true } } },
    }),
  ]);
  const g = new Agrupador(() => ({ entrada: 0, consumoQtd: 0, consumoValor: 0, perdaQtd: 0, perdaValor: 0, ajuste: 0, saida: 0 }));
  const unidades = new Map<string, string>();
  for (const m of movs) {
    const q = Number(m.quantidade);
    const valor = Math.round(Math.abs(q) * Number(m.custoUnitario));
    unidades.set(m.produtoId, UNIDADE[m.produto.unidade]);
    const v: Record<string, number> = {};
    if (m.tipo === 'ENTRADA') v.entrada = q;
    if (m.tipo === 'CONSUMO') Object.assign(v, { consumoQtd: -q, consumoValor: valor });
    if (m.tipo === 'PERDA') Object.assign(v, { perdaQtd: -q, perdaValor: valor });
    if (m.tipo === 'AJUSTE') v.ajuste = q;
    if (m.tipo === 'SAIDA') v.saida = -q;
    g.somar(m.produtoId, m.produto.nome, v);
  }
  const movimento = g.lista().sort((a, b) => b.consumoValor + b.perdaValor - (a.consumoValor + a.perdaValor));
  const posicao = produtos.map((p) => {
    const s = situacaoProduto(p);
    return {
      produto: p.nome,
      unidade: UNIDADE[p.unidade],
      estoque: Number(p.estoqueAtual),
      minimo: Number(p.estoqueMinimo),
      custo: Number(p.custoMedio),
      valor: Math.round(Math.max(0, Number(p.estoqueAtual)) * Number(p.custoMedio)),
      situacao: s.vencido
        ? 'Vencido'
        : s.semEstoque
          ? 'Sem estoque'
          : s.abaixoDoMinimo
            ? 'Abaixo do mínimo'
            : s.venceEmBreve
              ? `Vence em ${s.diasParaVencer} dia(s)`
              : 'OK',
      abaixo: s.abaixoDoMinimo,
    };
  });
  const somaMov = (k: 'consumoValor' | 'perdaValor') => movimento.reduce((t, m) => t + m[k], 0);

  return montar(c, 'estoque', 'Estoque', 'Posição de hoje e o que entrou, foi consumido ou perdido no período (todos os profissionais).', {
    indicadores: [
      { id: 'valor', rotulo: 'Valor em estoque hoje', valor: posicao.reduce((t, p) => t + p.valor, 0), formato: 'moeda', ajuda: 'Pelo custo médio' },
      { id: 'consumo', rotulo: 'Consumo no período', valor: somaMov('consumoValor'), formato: 'moeda' },
      { id: 'perdas', rotulo: 'Perdas no período', valor: somaMov('perdaValor'), formato: 'moeda' },
      { id: 'abaixo', rotulo: 'Abaixo do mínimo', valor: posicao.filter((p) => p.abaixo).length, formato: 'numero' },
    ],
    graficos: [
      {
        id: 'consumo',
        tipo: 'barras',
        titulo: 'Consumo por produto (R$)',
        formato: 'moeda',
        pontos: movimento
          .filter((m) => m.consumoValor > 0)
          .sort((a, b) => b.consumoValor - a.consumoValor)
          .slice(0, 12)
          .map((m) => ({ rotulo: m.rotulo, valor: m.consumoValor })),
      },
    ],
    tabelas: [
      {
        id: 'movimento',
        titulo: 'Movimento no período',
        colunas: [
          { id: 'produto', rotulo: 'Produto', formato: 'texto' },
          { id: 'unidade', rotulo: 'Un.', formato: 'texto' },
          { id: 'entrada', rotulo: 'Entradas', formato: 'decimal' },
          { id: 'consumoQtd', rotulo: 'Consumo', formato: 'decimal' },
          { id: 'consumoValor', rotulo: 'Consumo (R$)', formato: 'moeda' },
          { id: 'perdaQtd', rotulo: 'Perdas', formato: 'decimal' },
          { id: 'perdaValor', rotulo: 'Perdas (R$)', formato: 'moeda' },
          { id: 'ajuste', rotulo: 'Ajustes', formato: 'decimal' },
        ],
        linhas: movimento.map((m) => ({
          produto: m.rotulo,
          unidade: unidades.get(m.chave) ?? '',
          entrada: m.entrada,
          consumoQtd: m.consumoQtd,
          consumoValor: m.consumoValor,
          perdaQtd: m.perdaQtd,
          perdaValor: m.perdaValor,
          ajuste: m.ajuste,
        })),
        vazio: 'Nenhuma movimentação no período.',
      },
      {
        id: 'posicao',
        titulo: 'Posição atual',
        colunas: [
          { id: 'produto', rotulo: 'Produto', formato: 'texto' },
          { id: 'unidade', rotulo: 'Un.', formato: 'texto' },
          { id: 'estoque', rotulo: 'Estoque', formato: 'decimal' },
          { id: 'minimo', rotulo: 'Mínimo', formato: 'decimal' },
          { id: 'custo', rotulo: 'Custo médio', formato: 'custo' },
          { id: 'valor', rotulo: 'Valor', formato: 'moeda' },
          { id: 'situacao', rotulo: 'Situação', formato: 'texto' },
        ],
        linhas: posicao.map(({ abaixo: _a, ...p }) => p),
        vazio: 'Nenhum produto cadastrado.',
      },
    ],
  });
}

// ─── RF52: clientes ──────────────────────────────────────

async function clientes(c: Contexto): Promise<Relatorio> {
  const ags = await prisma.agendamento.findMany({
    where: { ...periodo(c), ...doProfissional(c) },
    select: { clienteId: true, status: true, valorCentavos: true, inicio: true, cliente: { select: { nome: true } } },
  });
  const concluidos = ags.filter((a) => a.status === 'CONCLUIDO');
  const atendidos = [...new Set(concluidos.map((a) => a.clienteId))];
  // Novo = a primeira visita concluída na empresa caiu dentro do período
  const primeiras = atendidos.length
    ? await prisma.agendamento.groupBy({ by: ['clienteId'], where: { status: 'CONCLUIDO', clienteId: { in: atendidos } }, _min: { inicio: true } })
    : [];
  const novos = primeiras.filter((p) => p._min.inicio && p._min.inicio >= c.ini.toJSDate()).length;
  const receita = concluidos.reduce((t, a) => t + a.valorCentavos, 0);
  const faltas = ags.filter((a) => a.status === 'NAO_COMPARECEU').length;

  const porStatus = new Agrupador(() => ({ qtd: 0 }));
  for (const a of ags) porStatus.somar(a.status, STATUS[a.status], { qtd: 1 });
  const status = porStatus.lista().sort((a, b) => b.qtd - a.qtd);

  const ranking = new Agrupador(() => ({ qtd: 0, valor: 0, faltas: 0, ultima: 0 }));
  for (const a of ags) {
    if (a.status === 'CONCLUIDO') ranking.somar(a.clienteId, a.cliente.nome, { qtd: 1, valor: a.valorCentavos });
    if (a.status === 'NAO_COMPARECEU') ranking.somar(a.clienteId, a.cliente.nome, { faltas: 1 });
  }
  const ultimas = new Map<string, Date>();
  for (const a of concluidos) if (!ultimas.has(a.clienteId) || ultimas.get(a.clienteId)! < a.inicio) ultimas.set(a.clienteId, a.inicio);
  const top = ranking
    .lista()
    .filter((r) => r.qtd > 0)
    .sort((a, b) => b.valor - a.valor || b.qtd - a.qtd)
    .slice(0, 20);

  return montar(c, 'clientes', 'Clientes', 'Quem foi atendido no período, quem voltou e quem faltou.', {
    indicadores: [
      { id: 'atendidos', rotulo: 'Clientes atendidos', valor: atendidos.length, formato: 'numero' },
      { id: 'novos', rotulo: 'Novos', valor: novos, formato: 'numero', ajuda: 'Primeira visita no período' },
      { id: 'recorrentes', rotulo: 'Recorrentes', valor: atendidos.length - novos, formato: 'numero' },
      { id: 'ticket', rotulo: 'Ticket médio', valor: concluidos.length ? Math.round(receita / concluidos.length) : null, formato: 'moeda' },
      { id: 'faltas', rotulo: 'Taxa de faltas', valor: pct(faltas, faltas + concluidos.length), formato: 'pct', ajuda: 'Faltas ÷ (faltas + concluídos)' },
    ],
    graficos: [{ id: 'status', tipo: 'barras', titulo: 'Agendamentos por situação', formato: 'numero', pontos: status.map((s) => ({ rotulo: s.rotulo, valor: s.qtd })) }],
    tabelas: [
      {
        id: 'ranking',
        titulo: 'Clientes que mais gastaram',
        colunas: [
          { id: 'cliente', rotulo: 'Cliente', formato: 'texto' },
          { id: 'qtd', rotulo: 'Atendimentos', formato: 'numero' },
          { id: 'valor', rotulo: 'Total gasto', formato: 'moeda' },
          { id: 'faltas', rotulo: 'Faltas', formato: 'numero' },
          { id: 'ultima', rotulo: 'Última visita', formato: 'data' },
        ],
        linhas: top.map((r) => ({
          cliente: r.rotulo,
          qtd: r.qtd,
          valor: r.valor,
          faltas: r.faltas,
          ultima: ultimas.has(r.chave) ? dataLocal(ultimas.get(r.chave)!, c.zona) : null,
        })),
        vazio: 'Nenhum cliente atendido no período.',
      },
      {
        id: 'status',
        titulo: 'Agendamentos por situação',
        colunas: [
          { id: 'situacao', rotulo: 'Situação', formato: 'texto' },
          { id: 'qtd', rotulo: 'Agendamentos', formato: 'numero' },
          { id: 'participacao', rotulo: 'Participação', formato: 'pct' },
        ],
        linhas: status.map((s) => ({ situacao: s.rotulo, qtd: s.qtd, participacao: pct(s.qtd, ags.length) })),
        total: { situacao: 'Total', qtd: ags.length, participacao: ags.length ? 1 : null },
        vazio: 'Nenhum agendamento no período.',
      },
    ],
  });
}

// ─── RF53: fidelidade ────────────────────────────────────

const TIPOS_FIDELIDADE = {
  CREDITO: 'Ganhos em atendimentos',
  ESTORNO: 'Estornados (atendimento cancelado)',
  RESGATE: 'Trocados por recompensas',
  DEVOLUCAO: 'Devolvidos (voucher cancelado)',
  AJUSTE_MAIS: 'Ajustes a mais',
  AJUSTE_MENOS: 'Ajustes a menos',
  EXPIRACAO: 'Vencidos',
} as const;

async function fidelidade(c: Contexto): Promise<Relatorio> {
  const quando = { createdAt: { gte: c.ini.toJSDate(), lt: c.fim.toJSDate() } };
  const agora = new Date();
  const [programa, positivos, negativos, circulacao, comSaldo, resgates] = await Promise.all([
    prisma.programaFidelidade.findUnique({ where: { id: 1 } }),
    prisma.transacaoFidelidade.groupBy({ by: ['tipo'], where: { ...quando, pontos: { gt: 0 } }, _sum: { pontos: true }, _count: true }),
    prisma.transacaoFidelidade.groupBy({ by: ['tipo'], where: { ...quando, pontos: { lt: 0 } }, _sum: { pontos: true }, _count: true }),
    prisma.transacaoFidelidade.aggregate({
      where: { pontos: { gt: 0 }, disponivel: { gt: 0 }, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
      _sum: { disponivel: true },
    }),
    prisma.transacaoFidelidade.groupBy({
      by: ['clienteId'],
      where: { pontos: { gt: 0 }, disponivel: { gt: 0 }, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
    }),
    prisma.resgateFidelidade.findMany({ where: quando, select: { status: true, pontos: true, recompensaId: true, recompensa: { select: { nome: true } } } }),
  ]);
  const unidade = programa?.tipo === 'SELOS' ? 'selos' : 'pontos';
  const linhas = new Map<keyof typeof TIPOS_FIDELIDADE, { qtd: number; pontos: number }>();
  for (const g of positivos) linhas.set(g.tipo === 'AJUSTE' ? 'AJUSTE_MAIS' : g.tipo, { qtd: g._count, pontos: g._sum.pontos ?? 0 });
  for (const g of negativos) {
    const k = g.tipo === 'AJUSTE' ? 'AJUSTE_MENOS' : g.tipo;
    linhas.set(k, { qtd: g._count, pontos: Math.abs(g._sum.pontos ?? 0) });
  }
  const valor = (k: keyof typeof TIPOS_FIDELIDADE) => linhas.get(k)?.pontos ?? 0;
  const mov = (Object.keys(TIPOS_FIDELIDADE) as (keyof typeof TIPOS_FIDELIDADE)[]).map((k) => ({
    tipo: TIPOS_FIDELIDADE[k],
    qtd: linhas.get(k)?.qtd ?? 0,
    pontos: valor(k),
  }));

  const rec = new Agrupador(() => ({ qtd: 0, usados: 0, cancelados: 0, pontos: 0 }));
  for (const r of resgates) {
    rec.somar(r.recompensaId, r.recompensa.nome, {
      qtd: 1,
      usados: r.status === 'USADO' ? 1 : 0,
      cancelados: r.status === 'CANCELADO' ? 1 : 0,
      pontos: r.status === 'CANCELADO' ? 0 : r.pontos,
    });
  }

  return montar(c, 'fidelidade', 'Fidelidade', `Movimento de ${unidade} no período (todos os clientes) e o saldo em aberto hoje.`, {
    indicadores: [
      { id: 'emitidos', rotulo: `${unidade[0]!.toUpperCase()}${unidade.slice(1)} emitidos`, valor: valor('CREDITO') + valor('AJUSTE_MAIS'), formato: 'numero' },
      { id: 'resgatados', rotulo: 'Trocados', valor: valor('RESGATE') - valor('DEVOLUCAO'), formato: 'numero' },
      { id: 'vencidos', rotulo: 'Vencidos', valor: valor('EXPIRACAO'), formato: 'numero' },
      { id: 'estornados', rotulo: 'Estornados', valor: valor('ESTORNO'), formato: 'numero' },
      { id: 'circulacao', rotulo: 'Saldo em aberto hoje', valor: circulacao._sum.disponivel ?? 0, formato: 'numero', ajuda: `${comSaldo.length} cliente(s) com saldo` },
    ],
    graficos: [{ id: 'movimento', tipo: 'barras', titulo: `Movimento de ${unidade}`, formato: 'numero', pontos: mov.filter((m) => m.pontos > 0).map((m) => ({ rotulo: m.tipo, valor: m.pontos })) }],
    tabelas: [
      {
        id: 'movimento',
        titulo: `Movimento de ${unidade}`,
        colunas: [
          { id: 'tipo', rotulo: 'Tipo', formato: 'texto' },
          { id: 'qtd', rotulo: 'Lançamentos', formato: 'numero' },
          { id: 'pontos', rotulo: unidade[0]!.toUpperCase() + unidade.slice(1), formato: 'numero' },
        ],
        linhas: mov,
        vazio: 'Nenhum movimento no período.',
      },
      {
        id: 'recompensas',
        titulo: 'Recompensas resgatadas',
        colunas: [
          { id: 'recompensa', rotulo: 'Recompensa', formato: 'texto' },
          { id: 'qtd', rotulo: 'Resgates', formato: 'numero' },
          { id: 'usados', rotulo: 'Usados', formato: 'numero' },
          { id: 'cancelados', rotulo: 'Cancelados', formato: 'numero' },
          { id: 'pontos', rotulo: unidade[0]!.toUpperCase() + unidade.slice(1), formato: 'numero' },
        ],
        linhas: rec
          .lista()
          .sort((a, b) => b.qtd - a.qtd)
          .map((r) => ({ recompensa: r.rotulo, qtd: r.qtd, usados: r.usados, cancelados: r.cancelados, pontos: r.pontos })),
        vazio: 'Nenhum resgate no período.',
      },
    ],
  });
}

// ─── RF54: comissões ─────────────────────────────────────

async function comissoes(c: Contexto): Promise<Relatorio> {
  const [ags, comissao] = await Promise.all([
    prisma.agendamento.findMany({
      where: { ...periodo(c), ...doProfissional(c), status: 'CONCLUIDO' },
      orderBy: { inicio: 'asc' },
      select: {
        inicio: true,
        servicoId: true,
        funcionarioId: true,
        valorCentavos: true,
        comissaoCentavos: true,
        servico: { select: { nome: true } },
        funcionario: { select: { nome: true } },
        cliente: { select: { nome: true } },
      },
    }),
    regrasDeComissao(),
  ]);
  const g = new Agrupador(() => ({ qtd: 0, receita: 0, comissao: 0 }));
  const detalhe = ags.map((a) => {
    const valor = comissao(a);
    g.somar(a.funcionarioId, a.funcionario.nome, { qtd: 1, receita: a.valorCentavos, comissao: valor });
    return {
      data: dataLocal(a.inicio, c.zona),
      profissional: a.funcionario.nome,
      servico: a.servico.nome,
      cliente: a.cliente.nome,
      valor: a.valorCentavos,
      comissao: valor,
    };
  });
  const pessoas = g.lista().sort((a, b) => b.comissao - a.comissao);
  const receita = pessoas.reduce((t, p) => t + p.receita, 0);
  const total = pessoas.reduce((t, p) => t + p.comissao, 0);
  const tabelas: Tabela[] = [
    {
      id: 'profissionais',
      titulo: 'Por profissional',
      colunas: [
        { id: 'profissional', rotulo: 'Profissional', formato: 'texto' },
        { id: 'qtd', rotulo: 'Atendimentos', formato: 'numero' },
        { id: 'receita', rotulo: 'Receita', formato: 'moeda' },
        { id: 'comissao', rotulo: 'Comissão', formato: 'moeda' },
        { id: 'pct', rotulo: '% efetivo', formato: 'pct' },
      ],
      linhas: pessoas.map((p) => ({ profissional: p.rotulo, qtd: p.qtd, receita: p.receita, comissao: p.comissao, pct: pct(p.comissao, p.receita) })),
      total: { profissional: 'Total', qtd: ags.length, receita, comissao: total, pct: pct(total, receita) },
      vazio: 'Nenhum atendimento concluído no período.',
    },
  ];
  // Detalhe por atendimento: quando filtra uma pessoa (é o "extrato" dela)
  if (c.filtro.funcionarioId) {
    tabelas.push({
      id: 'atendimentos',
      titulo: 'Atendimentos',
      colunas: [
        { id: 'data', rotulo: 'Data', formato: 'data' },
        { id: 'servico', rotulo: 'Serviço', formato: 'texto' },
        { id: 'cliente', rotulo: 'Cliente', formato: 'texto' },
        { id: 'valor', rotulo: 'Valor', formato: 'moeda' },
        { id: 'comissao', rotulo: 'Comissão', formato: 'moeda' },
      ],
      linhas: detalhe.slice(0, LIMITE_DETALHE).map(({ profissional: _p, ...d }) => d),
      limitada: detalhe.length > LIMITE_DETALHE,
      vazio: 'Nenhum atendimento concluído no período.',
    });
  }
  const pontos: Ponto[] = pessoas.map((p) => ({ rotulo: p.rotulo, valor: p.comissao }));

  return montar(c, 'comissoes', 'Comissões', 'Comissão de cada atendimento concluído, pelo % do serviço para o profissional (ou o % padrão dele).', {
    indicadores: [
      { id: 'total', rotulo: 'Total de comissões', valor: total, formato: 'moeda' },
      { id: 'receita', rotulo: 'Receita dos atendimentos', valor: receita, formato: 'moeda' },
      { id: 'pct', rotulo: 'Percentual médio', valor: pct(total, receita), formato: 'pct' },
    ],
    graficos: pessoas.length > 1 ? [{ id: 'profissionais', tipo: 'barras', titulo: 'Comissão por profissional', formato: 'moeda', pontos }] : [],
    tabelas,
  });
}

const GERADORES: Record<TipoRelatorio, (c: Contexto) => Promise<Relatorio>> = {
  faturamento,
  sinais,
  ocupacao,
  servicos,
  estoque,
  clientes,
  fidelidade,
  comissoes,
};

export async function gerar(tipo: TipoRelatorio, filtro: Filtro) {
  return GERADORES[tipo](await contexto(filtro));
}

// Lista de profissionais para o filtro
export function profissionais() {
  return prisma.funcionario.findMany({ orderBy: [{ ativo: 'desc' }, { ordem: 'asc' }, { nome: 'asc' }], select: { id: true, nome: true, ativo: true } });
}
