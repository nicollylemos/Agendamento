import type { Request } from 'express';
import { randomInt } from 'node:crypto';
import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { sha256, iguaisSemVazarTempo } from '../../lib/crypto.js';
import { assinar, verificar } from '../../lib/jwt.js';
import { enviarEmail } from '../../lib/mailer.js';
import { aposEncerrar } from '../pagamentos/pagamentos.service.js';
import { obterConfigAgenda } from '../agenda/config.service.js';
import { zonaDaEmpresa } from '../horarios/horarios.service.js';

// RF04: o cliente não tem senha. Para ver os agendamentos, recebe um código de
// 6 dígitos no e-mail (vale 10 min, 5 tentativas) e ganha uma sessão de 30 min.

const VALIDADE_MS = 10 * 60_000;
const MAX_TENTATIVAS = 5;

const hashCodigo = (email: string, codigo: string) => sha256(`${email}:${codigo}`);

export async function solicitarCodigo(email: string) {
  // Mesma resposta exista ou não cliente com esse e-mail (não revela quem é cliente)
  const existe = await prisma.cliente.findFirst({ where: { email }, select: { id: true } });
  if (!existe) return;

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.$transaction([
    prisma.codigoCliente.updateMany({ where: { email, usadoEm: null }, data: { usadoEm: new Date() } }),
    prisma.codigoCliente.create({ data: { email, codigoHash: hashCodigo(email, codigo), expiraEm: new Date(Date.now() + VALIDADE_MS) } }),
  ]);
  await enviarEmail(email, 'Seu código de acesso', `Seu código para ver seus agendamentos: ${codigo}\n\nEle vale 10 minutos. Se não foi você, ignore este e-mail.`);
}

export async function entrar(req: Request, email: string, codigo: string) {
  const registro = await prisma.codigoCliente.findFirst({
    where: { email, usadoEm: null, expiraEm: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const invalido = new AppError('CODIGO_INVALIDO', 'Código inválido ou expirado. Peça um novo.', 401);
  if (!registro || registro.tentativas >= MAX_TENTATIVAS) throw invalido;

  if (!iguaisSemVazarTempo(registro.codigoHash, hashCodigo(email, codigo))) {
    await prisma.codigoCliente.update({ where: { id: registro.id }, data: { tentativas: { increment: 1 } } });
    throw invalido;
  }
  // Uso único (condicional: dois envios simultâneos, só um vale)
  const { count } = await prisma.codigoCliente.updateMany({ where: { id: registro.id, usadoEm: null }, data: { usadoEm: new Date() } });
  if (!count) throw invalido;

  await auditar('CLIENTE_ACESSO_CODIGO', req, { entidade: 'Cliente', detalhes: { email } });
  return { token: await assinar('cliente', email), expiraEmMinutos: 30 };
}

export async function emailDoToken(header: string | undefined) {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new AppError('NAO_AUTENTICADO', 'Entre com o código enviado por e-mail', 401);
  try {
    return (await verificar('cliente', token)).sub;
  } catch {
    throw new AppError('SESSAO_ENCERRADA', 'Sua sessão expirou. Peça um novo código.', 401);
  }
}

// Agendamentos de todos os cadastros com esse e-mail
export async function meusAgendamentos(email: string) {
  const [zona, config] = await Promise.all([zonaDaEmpresa(), obterConfigAgenda()]);
  const lista = await prisma.agendamento.findMany({
    where: { cliente: { email }, inicio: { gte: DateTime.now().minus({ months: 6 }).toJSDate() } },
    include: { servico: { select: { nome: true } }, funcionario: { select: { nome: true } } },
    orderBy: { inicio: 'desc' },
    take: 100,
  });
  const local = (d: Date) => DateTime.fromJSDate(d).setZone(zona).toFormat("yyyy-MM-dd'T'HH:mm");
  return lista.map((a) => ({
    id: a.id,
    inicio: local(a.inicio),
    status: a.status,
    valorCentavos: a.valorCentavos,
    servico: a.servico.nome,
    profissional: a.funcionario.nome,
    podeCancelar:
      ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(a.status) &&
      (a.inicio.getTime() - Date.now()) / 3_600_000 >= config.prazoCancelamentoHoras,
  }));
}

// 9.2: só cancela se o agendamento for de um cadastro com o e-mail da sessão
export async function cancelar(req: Request, email: string, id: string) {
  const config = await obterConfigAgenda();
  const a = await prisma.agendamento.findFirst({ where: { id, cliente: { email } } });
  if (!a) throw new AppError('NAO_ENCONTRADO', 'Agendamento não encontrado', 404);
  if (!['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(a.status)) {
    throw new AppError('STATUS_INVALIDO', 'Esse agendamento não pode mais ser cancelado', 409);
  }
  if ((a.inicio.getTime() - Date.now()) / 3_600_000 < config.prazoCancelamentoHoras) {
    throw new AppError('FORA_DO_PRAZO', `Cancelamentos pelo site só até ${config.prazoCancelamentoHoras} h antes. Fale com a empresa.`, 409);
  }
  const { count } = await prisma.agendamento.updateMany({
    where: { id, status: a.status },
    data: { status: 'CANCELADO', canceladoEm: new Date(), motivoCancelamento: 'Cancelado pelo cliente', expiraSinalEm: null },
  });
  if (!count) throw new AppError('STATUS_MUDOU', 'O agendamento mudou enquanto isso. Atualize a tela.', 409);
  await auditar('AGENDAMENTO_CANCELADO_CLIENTE', req, { entidade: 'Agendamento', entidadeId: id });
  // RF32: devolve o sinal se cancelou com antecedência suficiente
  return { sinal: await aposEncerrar(req, id, 'CANCELADO') };
}
