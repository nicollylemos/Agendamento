import { SignJWT, jwtVerify, importPKCS8, importSPKI, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

// Seção 9.1: JWT assinado com chave assimétrica (EdDSA / Ed25519).
// Quem só tem a chave pública consegue validar, mas não consegue emitir.

const ALG = 'EdDSA';
const ISSUER = 'agendamento-api';

const privada = importPKCS8(Buffer.from(env.JWT_PRIVATE_KEY, 'base64').toString('utf8'), ALG);
const publica = importSPKI(Buffer.from(env.JWT_PUBLIC_KEY, 'base64').toString('utf8'), ALG);

// Cada tipo de token tem um "typ" próprio: um token de 2FA nunca serve como token de acesso.
export type TipoJwt = 'access' | 'mfa' | 'reauth' | 'cliente';

const DURACAO: Record<TipoJwt, string> = {
  access: '15m',
  mfa: '5m',
  reauth: '5m',
  cliente: '30m',
};

export async function assinar(tipo: TipoJwt, sub: string, extra: Record<string, unknown> = {}) {
  return new SignJWT({ ...extra, typ: tipo })
    .setProtectedHeader({ alg: ALG })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(tipo)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(DURACAO[tipo])
    .sign(await privada);
}

export async function verificar<T extends JWTPayload>(tipo: TipoJwt, token: string): Promise<T & { sub: string }> {
  const { payload } = await jwtVerify(token, await publica, {
    algorithms: [ALG],
    issuer: ISSUER,
    audience: tipo,
  });
  if (payload.typ !== tipo || !payload.sub) throw new Error('Tipo de token inválido');
  return payload as T & { sub: string };
}
