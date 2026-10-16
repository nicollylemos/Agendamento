import type { Request } from 'express';
import type { Perfil } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { enviarEmail } from '../../lib/mailer.js';
import { env } from '../../config/env.js';
import { criarTokenUso } from '../auth/auth.service.js';
import { revogarTodasDoUsuario } from '../auth/sessao.service.js';

const camposPublicos = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  ativo: true,
  totpAtivo: true,
  createdAt: true,
} as const;

export function listar() {
  return prisma.usuario.findMany({ select: camposPublicos, orderBy: { nome: 'asc' } });
}

interface DadosConvite {
  nome: string;
  email: string;
  perfil: Perfil;
  funcionarioId?: string; // convite para um profissional já cadastrado
}

// RF02: gera o link de uso único (48 h) e devolve uma mensagem pronta para o admin
// copiar e mandar no WhatsApp. O token só existe nessa resposta; no banco fica o hash (seção 9.1).
export async function gerarConvite(req: Request, dados: DadosConvite) {
  const existente = await prisma.usuario.findUnique({ where: { email: dados.email } });
  if (existente) throw new AppError('EMAIL_EM_USO', 'Já existe uma conta com esse e-mail', 409);

  const token = await criarTokenUso(
    'CONVITE',
    dados.email,
    { nome: dados.nome, perfil: dados.perfil, ...(dados.funcionarioId && { funcionarioId: dados.funcionarioId }) },
    req.usuario!.id,
  );
  await auditar('CONVITE_CRIADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Convite',
    detalhes: { email: dados.email, perfil: dados.perfil, funcionarioId: dados.funcionarioId },
  });

  const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { nome: true } });
  const link = `${env.APP_URL}/convite?token=${token}`;
  const primeiroNome = dados.nome.split(' ')[0];
  const mensagem =
    `Oi, ${primeiroNome}! Criei seu acesso ao painel de agendamentos${empresa ? ` da ${empresa.nome}` : ''}.\n\n` +
    `É só abrir o link, criar sua senha e entrar com o e-mail ${dados.email}:\n${link}\n\n` +
    `O link vale 48 horas e só funciona uma vez.`;

  // Também vai por e-mail quando o envio estiver configurado
  await enviarEmail(dados.email, 'Seu acesso ao Agendamento', mensagem);
  return { link, mensagem, expiraEm: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() };
}

// RF02 (convite avulso: gerente ou funcionário sem cadastro prévio)
export function convidar(req: Request, dados: { nome: string; email: string; perfil: Perfil }) {
  return gerarConvite(req, dados);
}

async function garantirOutroAdminAtivo(usuarioId: string) {
  const outros = await prisma.usuario.count({ where: { perfil: 'ADMIN', ativo: true, id: { not: usuarioId } } });
  if (outros === 0) throw new AppError('ULTIMO_ADMIN', 'O sistema precisa de pelo menos um admin ativo', 409);
}

// RF05: desativar derruba todas as sessões na hora
export async function alterarStatus(req: Request, id: string, ativo: boolean) {
  if (id === req.usuario!.id) throw new AppError('PROPRIA_CONTA', 'Você não pode alterar o status da própria conta', 409);

  const alvo = await prisma.usuario.findUnique({ where: { id } });
  if (!alvo) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado', 404);
  if (!ativo && alvo.perfil === 'ADMIN') await garantirOutroAdminAtivo(id);

  await prisma.usuario.update({ where: { id }, data: { ativo } });
  // RF05: quem sai da equipe também deixa de receber agendamentos
  if (!ativo) await prisma.funcionario.updateMany({ where: { usuarioId: id }, data: { ativo: false } });
  if (!ativo) await revogarTodasDoUsuario(id);

  await auditar(ativo ? 'USUARIO_REATIVADO' : 'USUARIO_DESATIVADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Usuario',
    entidadeId: id,
  });
}

// Seção 9.2: mudar permissão é ação crítica (exige reautenticação na rota)
export async function alterarPerfil(req: Request, id: string, perfil: Perfil) {
  if (id === req.usuario!.id) throw new AppError('PROPRIA_CONTA', 'Você não pode alterar o próprio perfil', 409);

  const alvo = await prisma.usuario.findUnique({ where: { id } });
  if (!alvo) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado', 404);
  if (alvo.perfil === perfil) return;
  if (alvo.perfil === 'ADMIN') await garantirOutroAdminAtivo(id);

  await prisma.usuario.update({ where: { id }, data: { perfil } });
  await auditar('PERFIL_ALTERADO', req, {
    usuarioId: req.usuario!.id,
    entidade: 'Usuario',
    entidadeId: id,
    detalhes: { de: alvo.perfil, para: perfil },
  });
}
