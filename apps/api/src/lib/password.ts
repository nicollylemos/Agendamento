import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';
import { logger } from './logger.js';

// Seção 9.1: argon2id, 19 MiB de memória, 2 iterações (recomendação OWASP).
const OPCOES = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const SENHA_MIN = 10;
export const SENHA_MAX = 128;

export function gerarHash(senha: string) {
  return argon2.hash(senha, OPCOES);
}

// Hash "de mentira" usado quando o e-mail não existe, para o login demorar
// o mesmo tempo nos dois casos e não revelar quais contas existem.
let hashFalso: Promise<string> | undefined;
function obterHashFalso() {
  hashFalso ??= argon2.hash('senha-que-nunca-sera-usada', OPCOES);
  return hashFalso;
}

export async function conferirSenha(hash: string | null | undefined, senha: string): Promise<boolean> {
  try {
    return await argon2.verify(hash ?? (await obterHashFalso()), senha);
  } catch {
    return false;
  }
}

// Seção 9.1: recusa senhas que já apareceram em vazamentos.
// Usa k-anonymity: só os 5 primeiros caracteres do SHA-1 saem daqui.
export async function senhaVazada(senha: string): Promise<boolean> {
  if (!env.HIBP_ENABLED) return false;
  const sha1 = createHash('sha1').update(senha).digest('hex').toUpperCase();
  const prefixo = sha1.slice(0, 5);
  const sufixo = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefixo}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const corpo = await res.text();
    return corpo.split('\n').some((linha) => {
      const [suf, qtd] = linha.trim().split(':');
      return suf === sufixo && Number(qtd) > 0;
    });
  } catch (err) {
    // Se o serviço cair, não trava o cadastro; só registra.
    logger.warn({ err }, 'Não foi possível consultar senhas vazadas');
    return false;
  }
}

export async function validarNovaSenha(senha: string) {
  if (senha.length < SENHA_MIN || senha.length > SENHA_MAX) {
    throw new AppError('SENHA_FRACA', `A senha precisa ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres`);
  }
  if (await senhaVazada(senha)) {
    throw new AppError('SENHA_VAZADA', 'Essa senha já apareceu em vazamentos. Escolha outra.');
  }
}
