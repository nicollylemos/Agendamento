import { Router } from 'express';
import { validateBody } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireCsrfHeader } from '../../middlewares/csrf.js';
import { loginEmailLimiter, loginIpLimiter, mfaLimiter, resetLimiter } from '../../middlewares/rateLimit.js';
import * as c from './auth.controller.js';
import * as s from './auth.schemas.js';

export const authRoutes = Router();

// RF01 + 9.1/9.5
authRoutes.post('/login', loginIpLimiter, validateBody(s.loginSchema), loginEmailLimiter, c.login);
authRoutes.post('/2fa/verificar', mfaLimiter, validateBody(s.verificarMfaSchema), c.verificarMfa);
// RF01: 2FA opcional, ligado e desligado pela própria pessoa logada
authRoutes.post('/2fa/configurar', authenticate, mfaLimiter, c.configurarMfa);
authRoutes.post('/2fa/ativar', authenticate, mfaLimiter, validateBody(s.ativarMfaSchema), c.ativarMfa);
authRoutes.post('/2fa/desativar', authenticate, mfaLimiter, validateBody(s.desativarMfaSchema), c.desativarMfa);

// 9.1 + 9.4: usam o cookie, então exigem o header anti-CSRF
authRoutes.post('/refresh', requireCsrfHeader, c.refresh);
authRoutes.post('/logout', requireCsrfHeader, c.logout);

authRoutes.get('/me', authenticate, c.me);
authRoutes.post('/reautenticar', authenticate, mfaLimiter, validateBody(s.reautenticarSchema), c.reautenticar);

// RF03
authRoutes.post('/senha/esqueci', resetLimiter, validateBody(s.esqueciSenhaSchema), c.esqueciSenha);
authRoutes.post('/senha/redefinir', resetLimiter, validateBody(s.redefinirSenhaSchema), c.redefinirSenha);

// RF02
authRoutes.post('/convite/aceitar', resetLimiter, validateBody(s.aceitarConviteSchema), c.aceitarConvite);
