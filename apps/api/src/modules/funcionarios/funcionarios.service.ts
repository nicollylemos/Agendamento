import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import type { criarFuncionarioSchema, darAcessoSchema, editarFuncionarioSchema } from './funcionarios.schemas.js';
import { gerarConvite } from '../usuarios/usuarios.service.js';

const incluir = {
  usuario: { select: { email: true, perfil: true, ativo: true } },
  servicos: { select: { servicoId: true } },
} as const;

type ComUsuario = Prisma.FuncionarioGetPayload<{ include: typeof incluir }>;

// Decimal do Prisma vira número na resposta
function formatar(f: ComUsuario) {
  return {
    id: f.id,
    nome: f.nome,
    telefone: f.telefone,
    email: f.email,
    ativo: f.ativo,
    // Acesso ao painel é opcional (RF02). null = só aparece na agenda.
    acesso: f.usuario ? { usuarioId: f.usuarioId, email: f.usuario.email, perfil: f.usuario.perfil, ativo: f.usuario.ativo } : null,
    convitePendente: false,
    cargo: f.cargo,
    bio: f.bio,
    fotoUrl: f.fotoUrl,
    comissaoPadraoPct: Number(f.comissaoPadraoPct),
    podeEditarHorario: f.podeEditarHorario,
    exibirNoSite: f.exibirNoSite,
    ordem: f.ordem,
    servicoIds: f.servicos.map((s) => s.servicoId),
  };
}

export async function listar() {
  const lista = await prisma.funcionario.findMany({
    include: incluir,
    orderBy: [{ ativo: 'desc' }, { ordem: 'asc' }, { nome: 'asc' }],
  });
  // Convites ainda não aceitos, para a tela mostrar "aguardando"
  const pendentes = await prisma.tokenUso.findMany({
    where: { tipo: 'CONVITE', usadoEm: null, expiraEm: { gt: new Date() } },
    select: { dados: true },
  });
  const comConvite = new Set(
    pendentes.map((t) => (t.dados as { funcionarioId?: string } | null)?.funcionarioId).filter(Boolean),
  );
  return lista.map((f) => ({ ...formatar(f), convitePendente: !f.usuarioId && comConvite.has(f.id) }));
}

// RF13: cadastro direto do profissional (sem login).
// Com usuarioId, vincula a uma conta existente (ex.: o admin que também atende).
export async function criar(req: Request, dados: z.infer<typeof criarFuncionarioSchema>) {
  const { usuarioId, nome, fazTodosServicos, ...resto } = dados;
  let nomeFinal = nome;
  let emailFinal = resto.email;
  if (usuarioId) {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado', 404);
    nomeFinal ??= usuario.nome;
    emailFinal ??= usuario.email;
  }
  try {
    const f = await prisma.$transaction(async (tx) => {
      const criado = await tx.funcionario.create({ data: { ...resto, usuarioId, nome: nomeFinal!, email: emailFinal } });
      if (fazTodosServicos) {
        const servicos = await tx.servico.findMany({ where: { deletedAt: null }, select: { id: true } });
        await tx.servicoFuncionario.createMany({ data: servicos.map((s) => ({ servicoId: s.id, funcionarioId: criado.id })), skipDuplicates: true });
      }
      return tx.funcionario.findUniqueOrThrow({ where: { id: criado.id }, include: incluir });
    });
    await auditar('FUNCIONARIO_CRIADO', req, { usuarioId: req.usuario!.id, entidade: 'Funcionario', entidadeId: f.id });
    return formatar(f);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('JA_EXISTE', 'Esse usuário já tem perfil de atendimento', 409);
    }
    throw err;
  }
}

// RF02 + seção 9.1: gera o link de acesso ao painel para um profissional já cadastrado.
// O admin copia a mensagem pronta e manda no WhatsApp; o link vale 48 h e é de uso único.
export async function darAcesso(req: Request, id: string, dados: z.infer<typeof darAcessoSchema>) {
  const f = await prisma.funcionario.findUnique({ where: { id } });
  if (!f) throw new AppError('NAO_ENCONTRADO', 'Profissional não encontrado', 404);
  if (f.usuarioId) throw new AppError('JA_TEM_ACESSO', 'Esse profissional já tem acesso ao painel', 409);
  if (!f.ativo) throw new AppError('INATIVO', 'Reative o profissional antes de dar acesso', 409);
  const email = dados.email ?? f.email;
  if (!email) throw new AppError('VALIDACAO', 'Informe o e-mail que ele vai usar para entrar', 400);
  if (email !== f.email) await prisma.funcionario.update({ where: { id }, data: { email } });
  return gerarConvite(req, { nome: f.nome, email, perfil: dados.perfil, funcionarioId: f.id });
}

export async function editar(req: Request, id: string, dados: z.infer<typeof editarFuncionarioSchema>) {
  const existe = await prisma.funcionario.findUnique({ where: { id } });
  if (!existe) throw new AppError('NAO_ENCONTRADO', 'Funcionário não encontrado', 404);
  const f = await prisma.funcionario.update({ where: { id }, data: dados, include: incluir });
  await auditar('FUNCIONARIO_ALTERADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Funcionario',
    entidadeId: id,
    detalhes: { campos: Object.keys(dados) },
  });
  return formatar(f);
}
