import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { assinar } from '../../lib/jwt.js';

// Testes que barram antes de chegar no banco
describe('rotas protegidas (9.2 / 9.4)', () => {
  it('login valida o corpo', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'não é e-mail' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rota admin sem token = 401', async () => {
    const res = await request(app).get('/api/v1/admin/usuarios');
    expect(res.status).toBe(401);
  });

  it('token de 2FA não abre rota protegida', async () => {
    const token = await assinar('mfa', '00000000-0000-0000-0000-000000000000');
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('refresh sem header anti-CSRF = 403', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
  });
});
