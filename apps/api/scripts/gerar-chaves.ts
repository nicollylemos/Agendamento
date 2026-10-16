// Gera as chaves para o .env. Rode uma vez por ambiente (dev, produção...).
// Uso: npm run gerar-chaves
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

console.log('# Cole no apps/api/.env (nunca suba para o git):');
console.log(`JWT_PRIVATE_KEY=${b64(privateKey)}`);
console.log(`JWT_PUBLIC_KEY=${b64(publicKey)}`);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
