import { describe, it, expect } from 'vitest';
import { minutosDeBloqueio, estaBloqueado } from './bloqueio.js';
import { temPermissao } from './permissoes.js';
import { assinar, verificar } from '../../lib/jwt.js';
import { validarNovaSenha, gerarHash, conferirSenha } from '../../lib/password.js';

describe('bloqueio progressivo (9.1)', () => {
  it('bloqueia 15 min no 5º erro e 1 h nos seguintes', () => {
    expect(minutosDeBloqueio(4)).toBeNull();
    expect(minutosDeBloqueio(5)).toBe(15);
    expect(minutosDeBloqueio(7)).toBeNull();
    expect(minutosDeBloqueio(10)).toBe(60);
  });
  it('libera depois do prazo', () => {
    expect(estaBloqueado(new Date(Date.now() - 1000))).toBe(false);
    expect(estaBloqueado(new Date(Date.now() + 1000))).toBe(true);
  });
});

describe('RBAC (9.2)', () => {
  it('admin pode tudo, funcionário não gerencia usuários nem recebedor', () => {
    expect(temPermissao('ADMIN', 'recebedor:gerenciar')).toBe(true);
    expect(temPermissao('FUNCIONARIO', 'usuarios:gerenciar')).toBe(false);
    expect(temPermissao('GERENTE', 'recebedor:gerenciar')).toBe(false);
    expect(temPermissao('GERENTE', 'estoque:editar')).toBe(true);
  });
});

describe('JWT (9.1)', () => {
  it('um token de 2FA não serve como token de acesso', async () => {
    const mfa = await assinar('mfa', 'u1');
    await expect(verificar('access', mfa)).rejects.toThrow();
    await expect(verificar('mfa', mfa)).resolves.toMatchObject({ sub: 'u1' });
  });
});

describe('senha (9.1)', () => {
  it('recusa senha curta', async () => {
    await expect(validarNovaSenha('curta')).rejects.toMatchObject({ code: 'SENHA_FRACA' });
  });
  it('usa argon2id e confere certo', async () => {
    const hash = await gerarHash('uma senha bem longa');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await conferirSenha(hash, 'uma senha bem longa')).toBe(true);
    expect(await conferirSenha(hash, 'errada')).toBe(false);
    expect(await conferirSenha(null, 'qualquer')).toBe(false);
  });
});
