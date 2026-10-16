import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { cifrar, decifrar, sha256 } from '../../lib/crypto.js';

// RF01: 2FA com TOTP (Google Authenticator, Authy, 1Password...).
// O segredo fica cifrado no banco (9.3) e cada código só vale uma vez.

const EMISSOR = 'Agendamento';
const TOLERANCIA_SEGUNDOS = 30; // aceita o código anterior e o próximo (relógio do celular adiantado/atrasado)
const QTD_CODIGOS_RECUPERACAO = 10;

export async function iniciarConfiguracao(usuarioId: string, email: string) {
  const segredo = generateSecret();
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { totpSecretPendente: cifrar(segredo) },
  });
  const uri = generateURI({ issuer: EMISSOR, label: email, secret: segredo });
  const qrCode = await QRCode.toDataURL(uri);
  // O segredo em texto vai junto para quem não consegue ler o QR Code.
  return { uri, qrCode, segredo };
}

async function conferirTotp(segredoCifrado: string, codigo: string, ultimoPasso: number | null) {
  const resultado = await verify({
    secret: decifrar(segredoCifrado),
    token: codigo,
    epochTolerance: TOLERANCIA_SEGUNDOS,
  });
  if (!resultado.valid || !('timeStep' in resultado)) return null;
  // Impede replay: um código já aceito não pode ser usado de novo.
  if (ultimoPasso !== null && resultado.timeStep <= ultimoPasso) return null;
  return resultado.timeStep;
}

// Confirma o primeiro código, ativa o 2FA e gera os códigos de recuperação.
export async function ativar(usuarioId: string, codigo: string): Promise<string[] | null> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!usuario.totpSecretPendente) return null;

  const passo = await conferirTotp(usuario.totpSecretPendente, codigo, null);
  if (passo === null) return null;

  const codigos = Array.from({ length: QTD_CODIGOS_RECUPERACAO }, () => formatarCodigo(randomBytes(5).toString('hex')));

  await prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      totpAtivo: true,
      totpSecret: usuario.totpSecretPendente,
      totpSecretPendente: null,
      totpUltimoPasso: passo,
      codigosRecuperacao: codigos.map((c) => sha256(normalizarCodigo(c))),
    },
  });
  // Mostrados UMA vez para o usuário guardar; no banco fica só o hash.
  return codigos;
}

export type ResultadoVerificacao = 'TOTP' | 'RECUPERACAO' | null;

export async function verificarCodigo(usuarioId: string, codigo: string): Promise<ResultadoVerificacao> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!usuario.totpAtivo || !usuario.totpSecret) return null;

  if (/^\d{6}$/.test(codigo)) {
    const passo = await conferirTotp(usuario.totpSecret, codigo, usuario.totpUltimoPasso);
    if (passo === null) return null;
    // Condição no update: duas requisições com o mesmo código, só uma passa.
    const { count } = await prisma.usuario.updateMany({
      where: { id: usuarioId, OR: [{ totpUltimoPasso: null }, { totpUltimoPasso: { lt: passo } }] },
      data: { totpUltimoPasso: passo },
    });
    return count === 1 ? 'TOTP' : null;
  }

  // Código de recuperação: uso único, removido da lista ao ser usado.
  const hash = sha256(normalizarCodigo(codigo));
  if (!usuario.codigosRecuperacao.includes(hash)) return null;
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { codigosRecuperacao: usuario.codigosRecuperacao.filter((h) => h !== hash) },
  });
  return 'RECUPERACAO';
}

function formatarCodigo(hex: string) {
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
}

function normalizarCodigo(codigo: string) {
  return codigo.replace(/[\s-]/g, '').toLowerCase();
}

export async function desativar(usuarioId: string) {
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { totpAtivo: false, totpSecret: null, totpSecretPendente: null, totpUltimoPasso: null, codigosRecuperacao: [] },
  });
}
