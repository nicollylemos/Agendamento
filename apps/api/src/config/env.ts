import { z } from 'zod';

// O resto do código nunca lê process.env direto: só este objeto validado.
// Se faltar ou estiver errada alguma variável, a API nem sobe.

const base64De32Bytes = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'precisa ter 32 bytes em base64');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGIN: z.string().url(),
  APP_URL: z.string().url(), // usado nos links de convite e reset
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // Endereço público da API, para o gateway mandar o webhook (Fase 6). Precisa ser https em produção.
  API_URL: z.string().url().optional(),
  // Fase 6: filas (expiração do sinal, lembretes) rodando dentro da API.
  // Com mais de uma instância, deixe "true" em só uma (ou rode o worker separado).
  // Fase 9: onde ficam as imagens (9.4). "local" é só para desenvolvimento.
  ARMAZENAMENTO: z.enum(['local', 's3']).default('local'),
  UPLOADS_DIR: z.string().default('./uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(), // R2, MinIO etc.; vazio = AWS
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().url().optional(), // endereço público do bucket (CDN)
  WORKER_EMBUTIDO: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Chaves Ed25519 em PEM, codificadas em base64 (gere com: npm run gerar-chaves)
  JWT_PRIVATE_KEY: z.string().min(40),
  JWT_PUBLIC_KEY: z.string().min(40),
  // Chave mestra AES-256-GCM (9.3). Fica fora do banco.
  ENCRYPTION_KEY: base64De32Bytes,

  HIBP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = envSchema
  .superRefine((e, ctx) => {
    if (e.ARMAZENAMENTO === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'] as const) {
        if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'obrigatório com ARMAZENAMENTO=s3' });
      }
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const apiUrl = env.API_URL ?? `http://localhost:${env.PORT}`;
export const isProd = env.NODE_ENV === 'production';
