import { describe, it, expect } from 'vitest';
import { cifrar, decifrar, sha256, tokenAleatorio } from './crypto.js';

describe('crypto (9.3)', () => {
  it('cifra e decifra', () => {
    const cifrado = cifrar('chave-pix-secreta');
    expect(cifrado).not.toContain('chave-pix-secreta');
    expect(decifrar(cifrado)).toBe('chave-pix-secreta');
  });

  it('gera um resultado diferente a cada vez (IV aleatório)', () => {
    expect(cifrar('igual')).not.toBe(cifrar('igual'));
  });

  it('recusa conteúdo adulterado', () => {
    const partes = cifrar('valor').split(':');
    partes[3] = Buffer.from('outro').toString('base64url');
    expect(() => decifrar(partes.join(':'))).toThrow();
  });

  it('token aleatório tem 256 bits e o hash é estável', () => {
    expect(Buffer.from(tokenAleatorio(), 'base64url')).toHaveLength(32);
    expect(sha256('a')).toBe(sha256('a'));
  });
});
