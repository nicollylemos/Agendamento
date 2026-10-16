import type { Request, Response } from 'express';
import type { Perfil, TipoToken, Usuario } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { assinar, verificar } from '../../lib/jwt.js';
import { conferirSenha, gerarHash, validarNovaSenha } from '../../lib/password.js';
import { sha256, tokenAleatorio } from '../../lib/crypto.js';
import { enviarEmail } from '../../lib/mailer.js';
import { env } from '../../config/env.js';
import { estaBloqueado, minutosDeBloqueio } from './bloqueio.js';
import { iniciarSessao, revogarTodasDoUsuario } from './sessao.service.js';
import * as mfa from './mfa.service.js';
import { permissoesDo } from './permissoes.js';

// Resposta genérica: não revela se o e-mail existe, se a senha errou
// ou se a conta está bloqueada/desativada (9.1).
const credenciaisInvalidas = () =>
  new AppError(
    'CREDENCIAIS_INVALIDAS',
    'E-mail ou senha inválidos. Depois de várias tentativas o acesso fica bloqueado por alguns minutos.',
    401,
  );

export function dadosPublicos(u: Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil' | 'totpAtivo'>) {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, totpAtivo: u.totpAtivo, permissoes: permissoesDo(u.perfil) };
}

async function registrarFalha(req: Request, usuarioId: string) {
  const { tentativasFalhas } = await prisma.usuario.update({
    where: { id: usuarioId },
    data: { tentativasFalhas: { increment: 1 } },
    select: { tentativasFalhas: true },
  });
  const minutos = minutosDeBloqueio(tentativasFalhas);
  if (minutos) {
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { bloqueadoAte: new Date(Date.now() + minutos * 60_000) },
    });
    await auditar('CONTA_BLOQUEADA', req, { usuarioId, detalhes: { minutos, tentativasFalhas } });
  }
}

async function concluirLogin(req: Request, res: Response, usuario: Usuario) {
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { tentativasFalhas: 0, bloqueadoAte: null },
  });
  const accessToken = await iniciarSessao(req, res, usuario.id);
  await auditar('LOGIN_SUCESSO', req, { usuarioId: usuario.id });
  return { etapa: 'OK' as const, accessToken, usuario: dadosPublicos(usuario) };
}

// ─── RF01: login ─────────────────────────────────────────

export async function login(req: Request, res: Response, email: string, senha: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  // Sempre roda o argon2, mesmo sem usuário: o tempo de resposta não entrega nada.
  const senhaOk = await conferirSenha(usuario?.senhaHash, senha);

  if (!usuario) {
    await auditar('LOGIN_FALHA', req, { detalhes: { motivo: 'email_inexistente' } });
    throw credenciaisInvalidas();
  }
  if (estaBloqueado(usuario.bloqueadoAte)) {
    await auditar('LOGIN_FALHA', req, { usuarioId: usuario.id, detalhes: { motivo: 'bloqueado' } });
    throw credenciaisInvalidas();
  }
  if (!senhaOk) {
    await registrarFalha(req, usuario.id);
    await auditar('LOGIN_FALHA', req, { usuarioId: usuario.id, detalhes: { motivo: 'senha' } });
    throw credenciaisInvalidas();
  }
  if (!usuario.ativo) {
    await auditar('LOGIN_FALHA', req, { usuarioId: usuario.id, detalhes: { motivo: 'inativo' } });
    throw credenciaisInvalidas();
  }

  // Senha certa. Agora o 2FA:
  if (usuario.totpAtivo) {
    return { etapa: 'MFA' as const, mfaToken: await assinar('mfa', usuario.id) };
  }
  // 2FA é opcional para todos os perfis (decisão do projeto). O painel recomenda ativar.
  return concluirLogin(req, res, usuario);
}

async function usuarioLiberado(usuarioId: string) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.ativo || estaBloqueado(usuario.bloqueadoAte)) throw credenciaisInvalidas();
  return usuario;
}

export async function verificarMfa(req: Request, res: Response, mfaToken: string, codigo: string) {
  const payload = await verificar('mfa', mfaToken).catch(() => {
    throw new AppError('MFA_TOKEN_INVALIDO', 'Tempo esgotado, faça login de novo', 401);
  });
  const usuario = await usuarioLiberado(payload.sub);

  const resultado = await mfa.verificarCodigo(usuario.id, codigo);
  if (!resultado) {
    await registrarFalha(req, usuario.id);
    await auditar('MFA_FALHA', req, { usuarioId: usuario.id });
    throw new AppError('CODIGO_INVALIDO', 'Código inválido', 401);
  }
  if (resultado === 'RECUPERACAO') {
    await auditar('MFA_CODIGO_RECUPERACAO_USADO', req, { usuarioId: usuario.id });
  }
  return concluirLogin(req, res, usuario);
}

// ─── RF01: configuração do 2FA (opcional, pela tela "Minha conta") ─

export async function configurarMfa(usuarioId: string) {
  const usuario = await usuarioLiberado(usuarioId);
  if (usuario.totpAtivo) throw new AppError('MFA_JA_ATIVO', '2FA já está ativo nessa conta', 409);
  return mfa.iniciarConfiguracao(usuario.id, usuario.email);
}

export async function ativarMfa(req: Request, usuarioId: string, codigo: string) {
  const usuario = await usuarioLiberado(usuarioId);
  const codigosRecuperacao = await mfa.ativar(usuario.id, codigo);
  if (!codigosRecuperacao) {
    await registrarFalha(req, usuario.id);
    throw new AppError('CODIGO_INVALIDO', 'Código inválido. Confira o horário do celular e tente de novo.', 400);
  }
  await auditar('MFA_ATIVADO', req, { usuarioId: usuario.id });
  return { codigosRecuperacao };
}

// Desligar o 2FA pede a senha e um código válido (do app ou de recuperação)
export async function desativarMfa(req: Request, usuarioId: string, senha: string, codigo: string) {
  const usuario = await usuarioLiberado(usuarioId);
  if (!usuario.totpAtivo) throw new AppError('MFA_INATIVO', '2FA não está ativo nessa conta', 409);
  const senhaOk = await conferirSenha(usuario.senhaHash, senha);
  const codigoOk = senhaOk && Boolean(await mfa.verificarCodigo(usuario.id, codigo));
  if (!codigoOk) {
    await registrarFalha(req, usuario.id);
    throw new AppError('REAUTENTICACAO_FALHOU', 'Senha ou código inválido', 401);
  }
  await mfa.desativar(usuario.id);
  await auditar('MFA_DESATIVADO', req, { usuarioId: usuario.id });
}

// ─── Tokens de uso único (RF02, RF03) ────────────────────

const VALIDADE_MS: Record<TipoToken, number> = {
  CONVITE: 48 * 60 * 60 * 1000, // RF02: 48 h
  RESET_SENHA: 30 * 60 * 1000, // RF03: 30 min
  ALERTA_RECEBEDOR: 7 * 24 * 60 * 60 * 1000, // RF36: link "não fui eu" vale 7 dias
};

export async function criarTokenUso(tipo: TipoToken, email: string, dados?: Prisma.InputJsonValue, criadoPor?: string) {
  const token = tokenAleatorio();
  await prisma.$transaction([
    // Um link novo invalida os anteriores do mesmo tipo
    prisma.tokenUso.updateMany({ where: { email, tipo, usadoEm: null }, data: { usadoEm: new Date() } }),
    prisma.tokenUso.create({
      data: { tipo, email, dados, criadoPor, tokenHash: sha256(token), expiraEm: new Date(Date.now() + VALIDADE_MS[tipo]) },
    }),
  ]);
  return token;
}

// Marca como usado de forma atômica: dois cliques no mesmo link, só um vale.
export async function consumirToken(tx: Prisma.TransactionClient, tipo: TipoToken, token: string) {
  const tokenHash = sha256(token);
  const { count } = await tx.tokenUso.updateMany({
    where: { tokenHash, tipo, usadoEm: null, expiraEm: { gt: new Date() } },
    data: { usadoEm: new Date() },
  });
  if (count !== 1) throw new AppError('LINK_INVALIDO', 'Link inválido ou expirado. Peça um novo.', 400);
  return tx.tokenUso.findUniqueOrThrow({ where: { tokenHash } });
}

// ─── RF03: recuperação de senha ──────────────────────────

export async function esqueciSenha(req: Request, email: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  // Mesma resposta exista ou não a conta (o controller sempre devolve 202).
  if (!usuario || !usuario.ativo) return;

  const token = await criarTokenUso('RESET_SENHA', email);
  await auditar('SENHA_RESET_SOLICITADO', req, { usuarioId: usuario.id });
  const link = `${env.APP_URL}/redefinir-senha?token=${token}`;
  await enviarEmail(
    email,
    'Redefinição de senha — Agendamento',
    `Para criar uma nova senha, acesse:\n${link}\n\nO link vale 30 minutos e só pode ser usado uma vez.\nSe não foi você, ignore este e-mail.`,
  );
}

export async function redefinirSenha(req: Request, token: string, senha: string) {
  // Valida a senha ANTES de gastar o link
  await validarNovaSenha(senha);
  const senhaHash = await gerarHash(senha);

  const usuario = await prisma.$transaction(async (tx) => {
    const registro = await consumirToken(tx, 'RESET_SENHA', token);
    return tx.usuario.update({
      where: { email: registro.email },
      data: { senhaHash, tentativasFalhas: 0, bloqueadoAte: null },
    });
  });

  // Senha nova = todo mundo que estava logado sai (inclusive um invasor).
  await revogarTodasDoUsuario(usuario.id);
  await auditar('SENHA_REDEFINIDA', req, { usuarioId: usuario.id });
}

// ─── RF02: aceitar convite ───────────────────────────────

export async function aceitarConvite(req: Request, token: string, senha: string) {
  await validarNovaSenha(senha);
  const senhaHash = await gerarHash(senha);

  try {
    const usuario = await prisma.$transaction(async (tx) => {
      const registro = await consumirToken(tx, 'CONVITE', token);
      const dados = registro.dados as { nome: string; perfil: Perfil; funcionarioId?: string };
      const usuario = await tx.usuario.create({
        data: { nome: dados.nome, email: registro.email, perfil: dados.perfil, senhaHash },
      });
      if (dados.funcionarioId) {
        // Profissional já cadastrado (RF13): só vincula o login. Se alguém já vinculou, o link não vale.
        const { count } = await tx.funcionario.updateMany({
          where: { id: dados.funcionarioId, usuarioId: null, ativo: true },
          data: { usuarioId: usuario.id },
        });
        if (count !== 1) throw new AppError('LINK_INVALIDO', 'Link inválido ou expirado. Peça um novo.', 400);
      } else if (dados.perfil === 'FUNCIONARIO') {
        // Funcionário convidado sem cadastro prévio ganha o perfil de atendimento (Fase 3)
        await tx.funcionario.create({ data: { usuarioId: usuario.id, nome: dados.nome, email: registro.email } });
      }
      return usuario;
    });
    await auditar('CONVITE_ACEITO', req, { usuarioId: usuario.id, entidade: 'Usuario', entidadeId: usuario.id });
    return dadosPublicos(usuario);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('EMAIL_EM_USO', 'Já existe uma conta com esse e-mail', 409);
    }
    throw err;
  }
}

// ─── Seção 9.1: reautenticação para ações críticas ───────

export async function reautenticar(req: Request, usuarioId: string, senha: string, codigo?: string) {
  const usuario = await usuarioLiberado(usuarioId);
  const senhaOk = await conferirSenha(usuario.senhaHash, senha);
  const codigoOk = !usuario.totpAtivo || (codigo ? Boolean(await mfa.verificarCodigo(usuario.id, codigo)) : false);

  if (!senhaOk || !codigoOk) {
    await registrarFalha(req, usuario.id);
    throw new AppError('REAUTENTICACAO_FALHOU', usuario.totpAtivo ? 'Senha ou código inválido' : 'Senha inválida', 401);
  }
  await auditar('REAUTENTICACAO', req, { usuarioId: usuario.id });
  return { reauthToken: await assinar('reauth', usuario.id), expiraEmSegundos: 300 };
}
