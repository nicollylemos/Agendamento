# Primeiros passos — Fase 1 (Fundação)

Faça um passo de cada vez e confira o resultado antes de seguir.

## 0. Antes de tudo: tire o projeto do OneDrive

A pasta está dentro do OneDrive. O `node_modules` tem milhares de arquivos e o
OneDrive vai tentar sincronizar todos (fica lento e pode corromper a instalação).
Mova a pasta para algo como `C:\Projetos\AgendaProjeto` antes do `npm install`.

## 1. Requisitos

- Node.js 22 LTS ou mais novo (`node -v`)
- Docker Desktop (para o Postgres e o Redis)
- Git

## 2. Git

```bash
git init
git add .
git commit -m "estrutura inicial"
```

Confira que o `.env` NÃO aparece no `git status` depois do passo 3.

## 3. Variáveis de ambiente

```bash
copy .env.example .env
copy apps\api\.env.example apps\api\.env
```

Troque as senhas nos dois arquivos (as mesmas senhas do Postgres/Redis
precisam aparecer na `DATABASE_URL` e na `REDIS_URL` da API).

## 4. Instalar dependências

```bash
npm install
```

## 5. Subir banco e Redis

```bash
npm run db:up
```

Eles ficam presos ao 127.0.0.1, ninguém na rede consegue acessar.

## 6. Primeira migration

```bash
cd apps/api
npx prisma migrate dev --name init
cd ../..
```

Cria a tabela `empresas` e confirma que a API fala com o banco.

## 7. Rodar

Em dois terminais:

```bash
npm run dev:api   # http://localhost:3333/api/v1/health
npm run dev:web   # http://localhost:5173
```

A tela do front deve mostrar "Status da API: ok".

## 8. Testes

```bash
npm test
```

Os testes checam a rota de saúde e os headers de segurança.

## O que já vem pronto de segurança

| Item | Onde |
| --- | --- |
| Env validado no boot (API não sobe com config errada) | `apps/api/src/config/env.ts` |
| Helmet (headers de segurança), sem `x-powered-by` | `apps/api/src/app.ts` |
| CORS só para o front | `apps/api/src/app.ts` |
| Limite de 100 kB no body | `apps/api/src/app.ts` |
| Rate limit geral (100 req/min) | `apps/api/src/middlewares/rateLimit.ts` |
| Erros sem stack trace para o cliente | `apps/api/src/middlewares/errorHandler.ts` |
| Logs escondendo senha, token, e-mail, telefone | `apps/api/src/lib/logger.ts` |
| Validação de body com Zod (bloqueia mass assignment) | `apps/api/src/middlewares/validate.ts` |
| Postgres/Redis com senha e só no localhost | `docker-compose.yml` |
| CI com gitleaks, npm audit, lint e testes | `.github/workflows/ci.yml` |

## Próximo: Fase 2 (autenticação)

Modelos `Usuario` e `Sessao` no Prisma, hash com argon2id, login, refresh
token em cookie httpOnly e RBAC.
