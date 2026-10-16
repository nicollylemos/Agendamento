import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

// Seção 9.3: dados sensíveis cifrados com AES-256-GCM.
// Formato salvo: v1:<iv>:<tag>:<conteúdo>, tudo em base64url.
// O "v1" permite trocar a chave no futuro sem perder o que já foi cifrado.

const VERSAO = 'v1';
const chave = Buffer.from(env.ENCRYPTION_KEY, 'base64');

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chave, iv);
  const conteudo = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSAO, iv, tag, conteudo].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':');
}

export function decifrar(valor: string): string {
  const [versao, iv, tag, conteudo] = valor.split(':');
  if (versao !== VERSAO || !iv || !tag || !conteudo) throw new Error('Formato cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(conteudo, 'base64url')), decipher.final()]).toString('utf8');
}

// Token aleatório de 256 bits (refresh, convite, reset). Seção 9.1.
export function tokenAleatorio(): string {
  return randomBytes(32).toString('base64url');
}

// Tokens são guardados só como hash: quem lê o banco não consegue usá-los.
export function sha256(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

export function iguaisSemVazarTempo(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
