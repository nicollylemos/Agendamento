import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Gera chaves descartáveis só para os testes (nunca use essas em dev/produção).
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.APP_URL = 'http://localhost:5173';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey).toString('base64');
process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.HIBP_ENABLED = 'false';
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), 'agendamento-uploads-')); // imagens dos testes ficam fora do projeto
