import type { Request } from 'express';
import { DateTime } from 'luxon';
import type { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { achatarSemana, agruparPorDia, paraHHMM, paraMinutos, type FaixaMin, type Semana } from './faixas.js';
import { calcularHorariosLivres, diaDaSemana, inicioDoDia, type Ocupado } from './disponibilidade.js';
import type { bloqueioSchema, excecaoSchema } from './horarios.schemas.js';
import { obterConfigAgenda, type ConfigAgenda } from '../agenda/config.service.js';

const ZONA_PADRAO = 'America/Sao_Paulo';

export async function zonaDaEmpresa() {
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { fusoHorario: true } });
  return e?.fusoHorario ?? ZONA_PADRAO;
}

// Datas "só dia" ficam à meia-noite UTC no banco (coluna DATE)
const paraColunaData = (data: string) => new Date(`${data}T00:00:00Z`);
const daColunaData = (d: Date) => d.toISOString().slice(0, 10);

function quem(req: Request) {
  return req.usuario!.id;
}

// ─── RF16: modelos de jornada ────────────────────────────

export async function listarModelos() {
  const modelos = await prisma.modeloJornada.findMany({ include: { faixas: true }, orderBy: { nome: 'asc' } });
  return modelos.map(({ faixas, ...m }) => ({ ...m, semana: agruparPorDia(faixas) }));
}

function nomeDuplicado(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError('NOME_EM_USO', 'Já existe um modelo com esse nome', 409);
  }
  throw err;
}

export async function criarModelo(req: Request, dados: { nome: string; semana: Semana }) {
  const m = await prisma.modeloJornada
    .create({ data: { nome: dados.nome, faixas: { create: achatarSemana(dados.semana) } } })
    .catch(nomeDuplicado);
  await auditar('MODELO_JORNADA_SALVO', req, { usuarioId: quem(req), entidade: 'ModeloJornada', entidadeId: m.id });
  return m;
}

export async function editarModelo(req: Request, id: string, dados: { nome?: string; semana?: Semana }) {
  if (!(await prisma.modeloJornada.findUnique({ where: { id } }))) throw new AppError('NAO_ENCONTRADO', 'Modelo não encontrado', 404);
  await prisma
    .$transaction(async (tx) => {
      if (dados.nome) await tx.modeloJornada.update({ where: { id }, data: { nome: dados.nome } });
      if (dados.semana) {
        await tx.modeloJornadaFaixa.deleteMany({ where: { modeloId: id } });
        await tx.modeloJornadaFaixa.createMany({ data: achatarSemana(dados.semana).map((f) => ({ ...f, modeloId: id })) });
      }
    })
    .catch(nomeDuplicado);
  await auditar('MODELO_JORNADA_SALVO', req, { usuarioId: quem(req), entidade: 'ModeloJornada', entidadeId: id });
}

export async function removerModelo(id: string) {
  const { count } = await prisma.modeloJornada.deleteMany({ where: { id } });
  if (!count) throw new AppError('NAO_ENCONTRADO', 'Modelo não encontrado', 404);
}

// ─── RF17: jornada do funcionário ────────────────────────

async function garantirFuncionario(id: string) {
  const f = await prisma.funcionario.findUnique({ where: { id } });
  if (!f) throw new AppError('NAO_ENCONTRADO', 'Funcionário não encontrado', 404);
  return f;
}

export async function obterJornada(funcionarioId: string) {
  await garantirFuncionario(funcionarioId);
  const faixas = await prisma.jornadaFaixa.findMany({ where: { funcionarioId } });
  return agruparPorDia(faixas);
}

export async function definirJornada(req: Request, funcionarioId: string, semana: Semana) {
  await garantirFuncionario(funcionarioId);
  await prisma.$transaction([
    prisma.jornadaFaixa.deleteMany({ where: { funcionarioId } }),
    prisma.jornadaFaixa.createMany({ data: achatarSemana(semana).map((f) => ({ ...f, funcionarioId })) }),
  ]);
  await auditar('JORNADA_ALTERADA', req, { usuarioId: quem(req), entidade: 'Funcionario', entidadeId: funcionarioId });
  return obterJornada(funcionarioId);
}

// RF16: o modelo é copiado; depois dá para personalizar sem mexer no modelo
export async function aplicarModelo(req: Request, funcionarioId: string, modeloId: string) {
  const modelo = await prisma.modeloJornada.findUnique({ where: { id: modeloId }, include: { faixas: true } });
  if (!modelo) throw new AppError('NAO_ENCONTRADO', 'Modelo não encontrado', 404);
  const semana = Array.from({ length: 7 }, (_, diaSemana) => ({
    diaSemana,
    faixas: modelo.faixas.filter((f) => f.diaSemana === diaSemana).map(({ inicioMin, fimMin }) => ({ inicioMin, fimMin })),
  }));
  return definirJornada(req, funcionarioId, semana);
}

// ─── RF17: exceções ──────────────────────────────────────

function formatarExcecao(e: Prisma.ExcecaoHorarioGetPayload<object>) {
  return {
    id: e.id,
    funcionarioId: e.funcionarioId,
    data: daColunaData(e.data),
    tipo: e.tipo,
    faixas: (e.faixas as unknown as FaixaMin[]).map((f) => ({ inicio: paraHHMM(f.inicioMin), fim: paraHHMM(f.fimMin) })),
    motivo: e.motivo,
  };
}

export async function listarExcecoes(p: { de: string; ate: string; funcionarioId?: string }) {
  const lista = await prisma.excecaoHorario.findMany({
    where: {
      data: { gte: paraColunaData(p.de), lte: paraColunaData(p.ate) },
      // Do funcionário OU da equipe toda (feriados)
      ...(p.funcionarioId && { OR: [{ funcionarioId: p.funcionarioId }, { funcionarioId: null }] }),
    },
    orderBy: { data: 'asc' },
  });
  return lista.map(formatarExcecao);
}

export async function criarExcecao(req: Request, dados: z.infer<typeof excecaoSchema>) {
  if (dados.funcionarioId) await garantirFuncionario(dados.funcionarioId);
  const data = paraColunaData(dados.data);
  const funcionarioId = dados.funcionarioId ?? null;

  // Uma exceção por pessoa (ou geral) por dia: a nova substitui a anterior
  const e = await prisma.$transaction(async (tx) => {
    await tx.excecaoHorario.deleteMany({ where: { data, funcionarioId } });
    return tx.excecaoHorario.create({
      data: {
        funcionarioId,
        data,
        tipo: dados.tipo,
        faixas: dados.tipo === 'HORARIO_ESPECIAL' ? (dados.faixas ?? []) : [],
        motivo: dados.motivo,
        criadoPor: quem(req),
      },
    });
  });
  await auditar('EXCECAO_SALVA', req, { usuarioId: quem(req), entidade: 'ExcecaoHorario', entidadeId: e.id, detalhes: { data: dados.data, tipo: dados.tipo } });
  return formatarExcecao(e);
}

// 9.2: "dono" limita o que pode ser apagado (funcionário só apaga o que é dele)
export async function removerExcecao(req: Request, id: string, dono?: string) {
  const { count } = await prisma.excecaoHorario.deleteMany({ where: { id, ...(dono && { funcionarioId: dono }) } });
  if (!count) throw new AppError('NAO_ENCONTRADO', 'Exceção não encontrada', 404);
  await auditar('EXCECAO_REMOVIDA', req, { usuarioId: quem(req), entidade: 'ExcecaoHorario', entidadeId: id });
}

// ─── RF18: bloqueios ─────────────────────────────────────

function formatarBloqueio(b: Prisma.BloqueioGetPayload<object>, zona: string) {
  const local = (d: Date) => DateTime.fromJSDate(d).setZone(zona).toFormat("yyyy-MM-dd'T'HH:mm");
  return { id: b.id, funcionarioId: b.funcionarioId, inicio: local(b.inicio), fim: local(b.fim), motivo: b.motivo };
}

export async function listarBloqueios(p: { de: string; ate: string; funcionarioId?: string }) {
  const zona = await zonaDaEmpresa();
  const lista = await prisma.bloqueio.findMany({
    where: {
      ...(p.funcionarioId && { funcionarioId: p.funcionarioId }),
      inicio: { lt: inicioDoDia(p.ate, zona).plus({ days: 1 }).toJSDate() },
      fim: { gt: inicioDoDia(p.de, zona).toJSDate() },
    },
    orderBy: { inicio: 'asc' },
  });
  return lista.map((b) => formatarBloqueio(b, zona));
}

export async function criarBloqueio(req: Request, dados: z.infer<typeof bloqueioSchema>) {
  await garantirFuncionario(dados.funcionarioId);
  const zona = await zonaDaEmpresa();
  const b = await prisma.bloqueio.create({
    data: {
      funcionarioId: dados.funcionarioId,
      inicio: DateTime.fromISO(dados.inicio, { zone: zona }).toJSDate(),
      fim: DateTime.fromISO(dados.fim, { zone: zona }).toJSDate(),
      motivo: dados.motivo,
      criadoPor: quem(req),
    },
  });
  await auditar('BLOQUEIO_CRIADO', req, { usuarioId: quem(req), entidade: 'Bloqueio', entidadeId: b.id });
  return formatarBloqueio(b, zona);
}

export async function removerBloqueio(req: Request, id: string, dono?: string) {
  const { count } = await prisma.bloqueio.deleteMany({ where: { id, ...(dono && { funcionarioId: dono }) } });
  if (!count) throw new AppError('NAO_ENCONTRADO', 'Bloqueio não encontrado', 404);
  await auditar('BLOQUEIO_REMOVIDO', req, { usuarioId: quem(req), entidade: 'Bloqueio', entidadeId: id });
}

// ─── RF20: disponibilidade ───────────────────────────────

// Prioridade: exceção do funcionário > exceção geral (feriado) > jornada da semana
async function faixasDoDia(funcionarioId: string, data: string, zona: string): Promise<FaixaMin[]> {
  const excecoes = await prisma.excecaoHorario.findMany({
    where: { data: paraColunaData(data), OR: [{ funcionarioId }, { funcionarioId: null }] },
  });
  const excecao = excecoes.find((e) => e.funcionarioId === funcionarioId) ?? excecoes.find((e) => e.funcionarioId === null);
  if (excecao) return excecao.tipo === 'FOLGA' ? [] : (excecao.faixas as unknown as FaixaMin[]);

  const dia = diaDaSemana(data, zona);
  const [daSemana, temJornada] = await Promise.all([
    prisma.jornadaFaixa.findMany({ where: { funcionarioId, diaSemana: dia }, select: { inicioMin: true, fimMin: true } }),
    prisma.jornadaFaixa.count({ where: { funcionarioId } }),
  ]);
  if (temJornada) return daSemana;
  // Profissional sem jornada cadastrada: vale o horário de funcionamento da empresa (RF06)
  return horarioDaEmpresa(dia);
}

// Horário de funcionamento da empresa num dia da semana, em faixas de minutos
export async function horarioDaEmpresa(diaSemana: number): Promise<FaixaMin[]> {
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { horarioFuncionamento: true } });
  const lista = (e?.horarioFuncionamento as { diaSemana: number; abre: string; fecha: string }[] | null) ?? [];
  const h = lista.find((x) => x.diaSemana === diaSemana);
  return h ? [{ inicioMin: paraMinutos(h.abre), fimMin: paraMinutos(h.fecha) }] : [];
}

// Para a tela do cliente: quais dos próximos dias têm algum horário livre
export async function diasComHorario(p: { servicoId: string; funcionarioId?: string }, dias = 14, agora = new Date()) {
  const zona = await zonaDaEmpresa();
  const hoje = DateTime.fromJSDate(agora).setZone(zona);
  const config = await obterConfigAgenda();
  const limite = Math.min(dias, config.diasAFrente + 1);
  const lista = Array.from({ length: limite }, (_, i) => hoje.plus({ days: i }).toISODate()!);
  const r = await Promise.all(
    lista.map(async (data) => {
      const d = await disponibilidade({ ...p, data }, agora).catch(() => null);
      return { data, livres: d ? new Set(d.profissionais.flatMap((x) => x.horarios)).size : 0 };
    }),
  );
  return r;
}

// Painel: quem atende e não tem horário nenhum (nem jornada, nem horário da empresa)
export async function diagnostico() {
  const [funcionarios, empresa] = await Promise.all([
    prisma.funcionario.findMany({ where: { ativo: true }, select: { id: true, nome: true, _count: { select: { jornada: true } } } }),
    prisma.empresa.findUnique({ where: { id: 1 }, select: { horarioFuncionamento: true } }),
  ]);
  const empresaTemHorario = ((empresa?.horarioFuncionamento as unknown[] | null) ?? []).length > 0;
  const semJornada = funcionarios.filter((f) => f._count.jornada === 0).map((f) => f.nome);
  return { empresaTemHorario, semJornada, semHorarioNenhum: empresaTemHorario ? [] : semJornada };
}

// Status que ocupam a agenda (os mesmos da trava no banco)
export const STATUS_ATIVOS = ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'EM_ATENDIMENTO'] as const;

async function ocupacoes(funcionarioId: string, data: string, zona: string, ignorarAgendamentoId?: string): Promise<Ocupado[]> {
  const ini = inicioDoDia(data, zona).minus({ hours: 12 }).toJSDate();
  const fim = inicioDoDia(data, zona).plus({ hours: 36 }).toJSDate();
  const [bloqueios, agendamentos] = await Promise.all([
    prisma.bloqueio.findMany({
      where: { funcionarioId, inicio: { lt: fim }, fim: { gt: ini } },
      select: { inicio: true, fim: true },
    }),
    prisma.agendamento.findMany({
      where: {
        funcionarioId,
        status: { in: [...STATUS_ATIVOS] },
        inicio: { lt: fim },
        fimOcupado: { gt: ini },
        ...(ignorarAgendamentoId && { id: { not: ignorarAgendamentoId } }),
      },
      select: { inicio: true, fimOcupado: true },
    }),
  ]);
  // O agendamento ocupa até o fim da limpeza dele
  return [...bloqueios, ...agendamentos.map((a) => ({ inicio: a.inicio, fim: a.fimOcupado }))];
}

export interface OpcoesHorarios {
  zona: string;
  config: ConfigAgenda;
  agora?: Date;
  ignorarAgendamentoId?: string; // ao reagendar, o próprio horário não conta como ocupado
}

// Horários livres de UMA pessoa para um serviço numa data
export async function horariosLivresDoFuncionario(
  funcionarioId: string,
  data: string,
  servico: { duracaoMin: number; limpezaMin: number },
  o: OpcoesHorarios,
) {
  const [faixas, ocupados] = await Promise.all([
    faixasDoDia(funcionarioId, data, o.zona),
    ocupacoes(funcionarioId, data, o.zona, o.ignorarAgendamentoId),
  ]);
  return calcularHorariosLivres({
    data,
    zona: o.zona,
    faixas,
    ocupados,
    duracaoMin: servico.duracaoMin,
    limpezaMin: servico.limpezaMin,
    passoMin: o.config.passoMin,
    agora: o.agora ?? new Date(),
    antecedenciaMinimaMin: o.config.antecedenciaMinimaMin,
  });
}

// Só deixa escolher de hoje até o limite configurado (RF22)
export function garantirDataNoPeriodo(data: string, zona: string, config: ConfigAgenda, agora = new Date()) {
  const hoje = DateTime.fromJSDate(agora).setZone(zona).toISODate()!;
  const ultimoDia = DateTime.fromJSDate(agora).setZone(zona).plus({ days: config.diasAFrente }).toISODate()!;
  if (data < hoje || data > ultimoDia) {
    throw new AppError('DATA_FORA_DO_PERIODO', `Escolha uma data entre hoje e os próximos ${config.diasAFrente} dias`, 400);
  }
}

export async function disponibilidade(p: { servicoId: string; data: string; funcionarioId?: string }, agora = new Date()) {
  const [zona, config] = await Promise.all([zonaDaEmpresa(), obterConfigAgenda()]);
  garantirDataNoPeriodo(p.data, zona, config, agora);

  const servico = await prisma.servico.findFirst({
    where: { id: p.servicoId, ativo: true, deletedAt: null },
    include: {
      funcionarios: {
        where: {
          funcionario: { exibirNoSite: true, ativo: true },
          ...(p.funcionarioId && { funcionarioId: p.funcionarioId }),
        },
        include: { funcionario: true },
        orderBy: { funcionario: { ordem: 'asc' } },
      },
    },
  });
  if (!servico) throw new AppError('NAO_ENCONTRADO', 'Serviço não encontrado', 404);

  const profissionais = await Promise.all(
    servico.funcionarios.map(async (sf) => {
      const duracaoMin = sf.duracaoMin ?? servico.duracaoMin;
      return {
        id: sf.funcionarioId,
        nome: sf.funcionario.nome,
        duracaoMin,
        horarios: await horariosLivresDoFuncionario(
          sf.funcionarioId,
          p.data,
          { duracaoMin, limpezaMin: servico.intervaloLimpezaMin },
          { zona, config, agora },
        ),
      };
    }),
  );

  return { data: p.data, fusoHorario: zona, profissionais };
}
