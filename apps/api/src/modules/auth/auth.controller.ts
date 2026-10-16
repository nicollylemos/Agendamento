import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { sha256 } from '../../lib/crypto.js';
import { auditar } from '../../lib/audit.js';
import { AppError } from '../../lib/AppError.js';
import * as auth from './auth.service.js';
import { COOKIE_REFRESH, limparCookie, renovarSessao, revogarFamilia } from './sessao.service.js';
import type {
  aceitarConviteSchema,
  ativarMfaSchema,
  esqueciSenhaSchema,
  loginSchema,
  reautenticarSchema,
  redefinirSenhaSchema,
  desativarMfaSchema,
  verificarMfaSchema,
} from './auth.schemas.js';
import type { z } from 'zod';

type Body<T extends z.ZodTypeAny> = Request<Record<string, string>, unknown, z.infer<T>>;

// RF01
export async function login(req: Body<typeof loginSchema>, res: Response) {
  res.json(await auth.login(req, res, req.body.email, req.body.senha));
}

export async function verificarMfa(req: Body<typeof verificarMfaSchema>, res: Response) {
  res.json(await auth.verificarMfa(req, res, req.body.mfaToken, req.body.codigo));
}

export async function configurarMfa(req: Request, res: Response) {
  res.json(await auth.configurarMfa(req.usuario!.id));
}

export async function ativarMfa(req: Body<typeof ativarMfaSchema>, res: Response) {
  res.json(await auth.ativarMfa(req, req.usuario!.id, req.body.codigo));
}

export async function desativarMfa(req: Body<typeof desativarMfaSchema>, res: Response) {
  await auth.desativarMfa(req, req.usuario!.id, req.body.senha, req.body.codigo);
  res.status(204).end();
}

// Seção 9.1: rotação do refresh token
export async function refresh(req: Request, res: Response) {
  const resultado = await renovarSessao(req, res);
  if (!resultado.ok) {
    limparCookie(res);
    throw new AppError('SESSAO_ENCERRADA', 'Sessão encerrada, faça login novamente', 401);
  }
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: resultado.usuarioId } });
  res.json({ accessToken: resultado.accessToken, usuario: auth.dadosPublicos(usuario) });
}

export async function logout(req: Request, res: Response) {
  const refresh: unknown = req.cookies?.[COOKIE_REFRESH];
  if (typeof refresh === 'string') {
    const sessao = await prisma.sessao.findUnique({ where: { refreshHash: sha256(refresh) } });
    if (sessao) {
      await revogarFamilia(sessao.familiaId);
      await auditar('LOGOUT', req, { usuarioId: sessao.usuarioId });
    }
  }
  limparCookie(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: req.usuario!.id } });
  res.json(auth.dadosPublicos(usuario));
}

// RF03
export async function esqueciSenha(req: Body<typeof esqueciSenhaSchema>, res: Response) {
  await auth.esqueciSenha(req, req.body.email);
  res.status(202).json({ message: 'Se o e-mail estiver cadastrado, você vai receber um link em instantes.' });
}

export async function redefinirSenha(req: Body<typeof redefinirSenhaSchema>, res: Response) {
  await auth.redefinirSenha(req, req.body.token, req.body.senha);
  res.status(204).end();
}

// RF02
export async function aceitarConvite(req: Body<typeof aceitarConviteSchema>, res: Response) {
  res.status(201).json(await auth.aceitarConvite(req, req.body.token, req.body.senha));
}

// Seção 9.1
export async function reautenticar(req: Body<typeof reautenticarSchema>, res: Response) {
  res.json(await auth.reautenticar(req, req.usuario!.id, req.body.senha, req.body.codigo));
}
