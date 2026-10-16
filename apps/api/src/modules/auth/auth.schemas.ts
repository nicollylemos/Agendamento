import { z } from 'zod';
import { SENHA_MAX, SENHA_MIN } from '../../lib/password.js';

// Seção 9.4: todo body é validado. Campos fora do schema são descartados.
const email = z.string().trim().toLowerCase().email().max(254);
const senha = z.string().min(1).max(SENHA_MAX);
const novaSenha = z.string().min(SENHA_MIN).max(SENHA_MAX);
const codigoTotp = z.string().trim().regex(/^\d{6}$/, 'Código de 6 dígitos');
const codigo2fa = z.string().trim().min(6).max(20); // TOTP ou código de recuperação
const token = z.string().min(20).max(200); // links de convite/reset
const jwt = z.string().min(20).max(2000); // mfaToken

export const loginSchema = z.object({ email, senha });
export const verificarMfaSchema = z.object({ mfaToken: jwt, codigo: codigo2fa });
export const ativarMfaSchema = z.object({ codigo: codigoTotp });
export const desativarMfaSchema = z.object({ senha, codigo: codigo2fa });
export const esqueciSenhaSchema = z.object({ email });
export const redefinirSenhaSchema = z.object({ token, senha: novaSenha });
export const aceitarConviteSchema = z.object({ token, senha: novaSenha });
export const reautenticarSchema = z.object({ senha, codigo: codigo2fa.optional() });
