import type { RequestHandler } from 'express';
import { verificar } from '../lib/jwt.js';
import { AppError } from '../lib/AppError.js';

// Seção 9.1: ações críticas (trocar perfil, recebedor, sinal...) pedem
// senha + 2FA de novo. O front chama POST /auth/reautenticar e manda o token
// recebido no header X-Reauth-Token. Ele vale 5 minutos.
export const requireReauth: RequestHandler = async (req, _res, next) => {
  const token = req.get('x-reauth-token');
  if (!token || !req.usuario) {
    throw new AppError('REAUTENTICACAO_NECESSARIA', 'Confirme sua senha para continuar', 401);
  }
  try {
    const payload = await verificar('reauth', token);
    if (payload.sub !== req.usuario.id) throw new Error('outro usuário');
  } catch {
    throw new AppError('REAUTENTICACAO_NECESSARIA', 'Confirme sua senha para continuar', 401);
  }
  next();
};
