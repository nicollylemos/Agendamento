import type { Request, Response, CookieOptions } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { sha256, tokenAleatorio } from '../../lib/crypto.js';
import { assinar } from '../../lib/jwt.js';
import { isProd } from '../../config/env.js';
import { auditar } from '../../lib/audit.js';

// Seção 9.1: refresh token aleatório de 256 bits em cookie httpOnly,
// rotacionado a cada uso. Se um token antigo for reutilizado, alguém
// roubou o cookie: a família inteira de sessões é revogada.

export const COOKIE_REFRESH = 'agendamento_rt';
const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // renova a cada uso
const DURACAO_MAXIMA_MS = 30 * 24 * 60 * 60 * 1000; // depois disso, login de novo
const TOLERANCIA_CONCORRENCIA_MS = 10_000; // abas renovando ao mesmo tempo

const opcoesCookie: CookieOptions = {
  httpOnly: true, // JavaScript do navegador não lê
  secure: isProd, // só HTTPS em produção
  sameSite: 'strict', // não vai em requisições de outros sites
  path: '/api/v1/auth', // só é enviado para as rotas de auth
};

function definirCookie(res: Response, token: string, expiraEm: Date) {
  res.cookie(COOKIE_REFRESH, token, { ...opcoesCookie, expires: expiraEm });
}

export function limparCookie(res: Response) {
  res.clearCookie(COOKIE_REFRESH, opcoesCookie);
}

function metadados(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 255) ?? null };
}

// Cria a sessão no fim de um login bem-sucedido e devolve o access token.
export async function iniciarSessao(req: Request, res: Response, usuarioId: string) {
  const refresh = tokenAleatorio();
  const familiaId = randomUUID();
  const agora = Date.now();
  const familiaExpiraEm = new Date(agora + DURACAO_MAXIMA_MS);
  const expiraEm = new Date(agora + DURACAO_SESSAO_MS);

  await prisma.sessao.create({
    data: { usuarioId, familiaId, refreshHash: sha256(refresh), expiraEm, familiaExpiraEm, ...metadados(req) },
  });

  definirCookie(res, refresh, expiraEm);
  return assinar('access', usuarioId, { fam: familiaId });
}

export type ResultadoRenovacao =
  | { ok: true; accessToken: string; usuarioId: string }
  | { ok: false; motivo: 'AUSENTE' | 'INVALIDO' | 'EXPIRADO' | 'REUSO' | 'INATIVO' };

export async function renovarSessao(req: Request, res: Response): Promise<ResultadoRenovacao> {
  const refresh: unknown = req.cookies?.[COOKIE_REFRESH];
  if (typeof refresh !== 'string' || refresh.length < 20) return { ok: false, motivo: 'AUSENTE' };

  const sessao = await prisma.sessao.findUnique({
    where: { refreshHash: sha256(refresh) },
    include: { usuario: { select: { ativo: true } } },
  });
  if (!sessao) return { ok: false, motivo: 'INVALIDO' };

  if (sessao.revogadaEm) {
    // Duas abas renovando juntas mandam o mesmo cookie quase ao mesmo tempo.
    // Dentro dessa janela curta, só recusa (o navegador já recebeu o cookie novo).
    const recemTrocado = Date.now() - sessao.revogadaEm.getTime() < TOLERANCIA_CONCORRENCIA_MS;
    if (sessao.substituidaPor && recemTrocado) return { ok: false, motivo: 'INVALIDO' };

    // Fora da janela: token antigo reaparecendo = provável roubo. Derruba a família toda.
    if (sessao.substituidaPor) {
      await revogarFamilia(sessao.familiaId);
      await auditar('SESSAO_REUSO_DETECTADO', req, { usuarioId: sessao.usuarioId, entidade: 'Sessao', entidadeId: sessao.familiaId });
      return { ok: false, motivo: 'REUSO' };
    }
    return { ok: false, motivo: 'INVALIDO' };
  }

  const agora = new Date();
  if (sessao.expiraEm <= agora || sessao.familiaExpiraEm <= agora) return { ok: false, motivo: 'EXPIRADO' };
  if (!sessao.usuario.ativo) {
    await revogarFamilia(sessao.familiaId);
    return { ok: false, motivo: 'INATIVO' };
  }

  const novoRefresh = tokenAleatorio();
  const expiraEm = new Date(Math.min(agora.getTime() + DURACAO_SESSAO_MS, sessao.familiaExpiraEm.getTime()));

  // Transação + condição "revogadaEm: null": se duas abas renovarem ao mesmo
  // tempo, só uma ganha; a outra cai como reuso na próxima tentativa.
  const resultado = await prisma.$transaction(async (tx) => {
    const nova = await tx.sessao.create({
      data: {
        usuarioId: sessao.usuarioId,
        familiaId: sessao.familiaId,
        refreshHash: sha256(novoRefresh),
        expiraEm,
        familiaExpiraEm: sessao.familiaExpiraEm,
        ...metadados(req),
      },
    });
    const { count } = await tx.sessao.updateMany({
      where: { id: sessao.id, revogadaEm: null },
      data: { revogadaEm: agora, substituidaPor: nova.id },
    });
    if (count !== 1) throw new Error('CORRIDA');
    return nova;
  }).catch(() => null);

  if (!resultado) return { ok: false, motivo: 'INVALIDO' };

  definirCookie(res, novoRefresh, expiraEm);
  const accessToken = await assinar('access', sessao.usuarioId, { fam: sessao.familiaId });
  return { ok: true, accessToken, usuarioId: sessao.usuarioId };
}

export async function revogarFamilia(familiaId: string) {
  await prisma.sessao.updateMany({ where: { familiaId, revogadaEm: null }, data: { revogadaEm: new Date() } });
}

// RF05 e RF03: derruba todos os logins do usuário
export async function revogarTodasDoUsuario(usuarioId: string) {
  await prisma.sessao.updateMany({ where: { usuarioId, revogadaEm: null }, data: { revogadaEm: new Date() } });
}
