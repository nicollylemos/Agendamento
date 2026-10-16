import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env, isProd } from '../config/env.js';
import { logger } from './logger.js';

// Fase 9 (9.4): imagens ficam fora do servidor da API em produção (S3 compatível).
// Em desenvolvimento, numa pasta local servida pela própria API.

export const CHAVE_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
export const pastaLocal = path.resolve(env.UPLOADS_DIR);

export const baseUrlArquivos = env.ARMAZENAMENTO === 's3' ? `${env.S3_PUBLIC_URL!.replace(/\/$/, '')}/` : '/api/v1/arquivos/';

// Só aceitamos URLs de imagens que nós mesmos guardamos (nada de link externo, "javascript:" etc.)
export function ehUrlDeArquivo(url: string) {
  return url.startsWith(baseUrlArquivos) && CHAVE_VALIDA.test(url.slice(baseUrlArquivos.length));
}

if (isProd && env.ARMAZENAMENTO === 'local') {
  logger.warn('ARMAZENAMENTO=local em produção: as imagens ficam no servidor da API. Use s3.');
}

let s3: S3Client | null = null;
function cliente() {
  s3 ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  return s3;
}

export async function salvar(chave: string, conteudo: Buffer, contentType: string) {
  if (!CHAVE_VALIDA.test(chave)) throw new Error('Chave de arquivo inválida');
  if (env.ARMAZENAMENTO === 's3') {
    await cliente().send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: chave, Body: conteudo, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
  } else {
    await mkdir(pastaLocal, { recursive: true });
    await writeFile(path.join(pastaLocal, chave), conteudo, { flag: 'wx' });
  }
  return `${baseUrlArquivos}${chave}`;
}

export async function remover(chave: string) {
  if (!CHAVE_VALIDA.test(chave)) return;
  try {
    if (env.ARMAZENAMENTO === 's3') await cliente().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: chave }));
    else await unlink(path.join(pastaLocal, chave));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, chave }, 'Não foi possível remover o arquivo');
  }
}
