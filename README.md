# Agendamento

Sistema web de agendamento online para negócios de serviços (salões, barbearias, estúdios, clínicas de estética). O cliente marca o horário pelo site da empresa e paga um sinal via Pix; a equipe administra agenda, serviços, horários, estoque, programa de fidelidade e relatórios num painel único.

> Documentação completa do projeto (objetivo, problema, escopo, requisitos e arquitetura): [`docs/DOCUMENTACAO.md`](docs/DOCUMENTACAO.md)
> Referência da API REST: [`docs/API.md`](docs/API.md)

## Funcionalidades

- Site público personalizável (cores, fontes, logo, banner, seções) com prévia antes de publicar
- Agendamento online sem senha, com cálculo de horários livres por profissional
- Sinal via Pix (QR Code e copia e cola) confirmado automaticamente por webhook
- Agenda em grade por profissional, agendamento manual, remarcação e cancelamento
- Jornadas, modelos de jornada, exceções (feriados) e bloqueios
- Estoque com ficha técnica por serviço, baixa automática e custo médio
- Fidelidade por pontos ou cartão de selos, com recompensas e vouchers
- Relatórios (faturamento, ocupação, rentabilidade, comissões, clientes) com exportação CSV/PDF
- Lembretes por e-mail 24 h e 2 h antes do atendimento
- Login com 2FA opcional, RBAC por perfil (Admin, Gerente, Funcionário) e log de auditoria

## Tecnologias

| Camada | Stack |
| --- | --- |
| Backend | Node.js 22, Express 5, TypeScript, Prisma ORM, Zod |
| Banco de dados | PostgreSQL 16 |
| Filas e cache | Redis 7 + BullMQ |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query, React Hook Form, React Router 7 |
| Segurança | argon2id, JWT EdDSA (jose), TOTP (otplib), Helmet, rate limit em Redis, AES-256-GCM |
| Pagamentos | Mercado Pago (Pix) e gateway simulado para desenvolvimento |
| Testes | Vitest + Supertest |
| CI | GitHub Actions (gitleaks, npm audit, typecheck, testes) |

## Estrutura do repositório

```
AgendaProjeto/
├── apps/
│   ├── api/                 # API REST (Express + Prisma)
│   │   ├── prisma/          # schema, migrations e SQL da trava da agenda
│   │   ├── scripts/         # gerar-chaves, criar-admin, trava-agenda
│   │   ├── src/
│   │   │   ├── config/      # validação das variáveis de ambiente
│   │   │   ├── jobs/        # fila BullMQ (sinal, lembretes, alertas)
│   │   │   ├── lib/         # prisma, redis, jwt, crypto, logger, mailer...
│   │   │   ├── middlewares/ # auth, permissões, CSRF, rate limit, validação
│   │   │   └── modules/     # um módulo por domínio (rotas, schemas, service)
│   │   └── tests/           # setup e helpers dos testes
│   └── web/                 # Painel e site público (React + Vite)
│       └── src/
│           ├── pages/       # public/, admin/, staff/, agenda/
│           ├── components/  # agenda, horários, pagamento, site, relatórios...
│           ├── layouts/     # público, acesso e painel
│           └── lib/         # cliente HTTP e hooks por domínio
├── packages/shared/         # enums e tipos compartilhados entre API e web
├── docs/                    # documentação do projeto e de cada fase
├── docker-compose.yml       # Postgres e Redis para desenvolvimento
└── .github/workflows/ci.yml
```

## Pré-requisitos

- [Node.js](https://nodejs.org/) **22 LTS** ou superior (`node -v`)
- npm 10+ (vem com o Node)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (para PostgreSQL e Redis)
- Git

> **Windows + OneDrive:** não deixe o projeto dentro de uma pasta sincronizada pelo OneDrive. O `node_modules` tem milhares de arquivos e a sincronização deixa tudo lento ou corrompe a instalação. Use algo como `C:\Projetos\AgendaProjeto`.

## Instalação

```bash
git clone https://github.com/nicollylemos/Agendamento.git
cd Agendamento
npm install
```

O `npm install` na raiz instala as dependências de todos os workspaces (`apps/api`, `apps/web` e `packages/shared`).

## Configuração

### 1. Variáveis de ambiente

São dois arquivos: um na raiz (usado pelo Docker Compose) e um na API.

```bash
# Linux / macOS
cp .env.example .env
cp apps/api/.env.example apps/api/.env

# Windows (PowerShell / CMD)
copy .env.example .env
copy apps\api\.env.example apps\api\.env
```

Troque as senhas nos dois arquivos. A senha do Postgres e do Redis definidas no `.env` da raiz precisam ser as mesmas que aparecem em `DATABASE_URL` e `REDIS_URL` no `.env` da API.

### 2. Chaves de criptografia

```bash
npm run gerar-chaves -w apps/api
```

O comando imprime `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` e `ENCRYPTION_KEY`. Cole as três linhas no `apps/api/.env`.

### 3. Banco e Redis

```bash
npm run db:up
```

Sobe PostgreSQL (porta 5432) e Redis (porta 6379), ambos presos ao `127.0.0.1`.

### 4. Migrations

```bash
cd apps/api
npx prisma migrate dev
cd ../..
```

Aplica todas as migrations, incluindo a trava que impede agendamentos sobrepostos no mesmo profissional.

### 5. Primeiro administrador

```bash
npm run criar-admin -w apps/api -- --nome "Seu Nome" --email voce@exemplo.com
```

A senha é pedida no terminal (mínimo de 10 caracteres e checagem contra senhas vazadas).

### Variáveis de ambiente

**Raiz (`.env`)**

| Variável | Descrição |
| --- | --- |
| `POSTGRES_USER` | Usuário do PostgreSQL |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL (obrigatória) |
| `POSTGRES_DB` | Nome do banco |
| `REDIS_PASSWORD` | Senha do Redis (obrigatória) |

**API (`apps/api/.env`)** — validadas no boot; se alguma estiver errada a API não sobe.

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `NODE_ENV` | não | `development` | `development`, `test` ou `production` |
| `PORT` | não | `3333` | Porta HTTP da API |
| `CORS_ORIGIN` | sim | — | Origem do front autorizada a chamar a API |
| `APP_URL` | sim | — | URL do front, usada nos links de convite e redefinição de senha |
| `API_URL` | não | `http://localhost:PORT` | URL pública da API para o webhook do gateway (https em produção) |
| `DATABASE_URL` | sim | — | String de conexão do PostgreSQL |
| `REDIS_URL` | sim | — | String de conexão do Redis |
| `JWT_PRIVATE_KEY` | sim | — | Chave privada Ed25519 (PEM em base64) |
| `JWT_PUBLIC_KEY` | sim | — | Chave pública Ed25519 (PEM em base64) |
| `ENCRYPTION_KEY` | sim | — | Chave AES-256-GCM, 32 bytes em base64 |
| `HIBP_ENABLED` | não | `true` | Consulta de senhas vazadas (Have I Been Pwned) |
| `WORKER_EMBUTIDO` | não | `true` | Roda a fila de tarefas dentro da API |
| `ARMAZENAMENTO` | não | `local` | `local` (dev) ou `s3` |
| `UPLOADS_DIR` | não | `./uploads` | Pasta das imagens quando `ARMAZENAMENTO=local` |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` | com `s3` | — | Bucket e credenciais (AWS S3, Cloudflare R2, MinIO) |
| `S3_REGION` | não | `auto` | Região do bucket |
| `S3_ENDPOINT` | não | — | Endpoint customizado (R2, MinIO); vazio usa AWS |

As credenciais do Mercado Pago **não** ficam no `.env`: são cadastradas pelo painel (Pagamentos → Recebedor), guardadas cifradas no banco e só podem ser alteradas com senha + 2FA.

## Execução

Em dois terminais, na raiz:

```bash
npm run dev:api   # API em http://localhost:3333  (saúde: /api/v1/health)
npm run dev:web   # Web em http://localhost:5173
```

Abra http://localhost:5173 para ver o site público e http://localhost:5173/login para entrar no painel. Em desenvolvimento o Vite repassa `/api` para a API, então front e API ficam na mesma origem.

Os e-mails (convites, códigos, lembretes) aparecem no terminal da API em desenvolvimento.

### Scripts

| Comando (na raiz) | O que faz |
| --- | --- |
| `npm run dev:api` | API com recarga automática |
| `npm run dev:web` | Front com Vite |
| `npm run build` | Compila todos os workspaces |
| `npm run lint` | Checagem de tipos (TypeScript) |
| `npm test` | Roda os testes |
| `npm run db:up` / `npm run db:down` | Sobe / derruba Postgres e Redis |

## Testes

```bash
npm test
```

São cerca de 190 testes com Vitest e Supertest, divididos em:

- **Unitários** (`*.test.ts`): criptografia, validação de documento, cálculo de disponibilidade, intervalos de relatório, regras de autenticação.
- **Integração** (`*.int.test.ts`): fluxos completos por fase — autenticação, serviços, horários, agendamento (incluindo 20 requisições simultâneas no mesmo horário), sinal Pix e webhook, estoque, fidelidade, site e relatórios.

Os testes de integração só rodam quando existe um banco de teste. Crie um banco separado e informe:

```bash
# Linux / macOS
TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/agendamento_test npm test

# Windows (PowerShell)
$env:TEST_DATABASE_URL="postgresql://usuario:senha@localhost:5432/agendamento_test"; npm test
```

As chaves usadas nos testes são geradas na hora (`apps/api/tests/setup.ts`) e os uploads vão para uma pasta temporária. Os arquivos de integração rodam um por vez porque compartilham o mesmo banco.

Também há arquivos `.http` em `apps/api/requests/` para testar a API manualmente pelo VS Code (extensão REST Client).

## Integração contínua

A cada push e pull request o GitHub Actions (`.github/workflows/ci.yml`):

1. Procura segredos no histórico com **gitleaks**
2. Instala com `npm ci`
3. Roda `npm audit --audit-level=high`
4. Roda `npm run lint` (typecheck)
5. Roda `npm test`

## Deploy

Passo a passo para um servidor Linux (VPS) com Nginx:

1. Provisione PostgreSQL 16 e Redis 7 com senha, sem expor as portas na internet.
2. Configure `apps/api/.env` com `NODE_ENV=production`, URLs `https`, `ARMAZENAMENTO=s3` e chaves novas.
3. Instale e compile: `npm ci && npm run build`.
4. Aplique as migrations: `cd apps/api && npx prisma migrate deploy`.
5. Suba a API com um gerenciador de processos (ex.: `pm2 start "npm start" --name agenda-api` dentro de `apps/api`).
6. Sirva `apps/web/dist` pelo Nginx e faça proxy de `/api` para a porta da API, com HTTPS.
7. Cadastre o recebedor Pix pelo painel e aponte o webhook do Mercado Pago para `https://<API_URL>/api/v1/webhooks/pagamentos/mercado_pago`.

Com mais de uma instância da API, deixe `WORKER_EMBUTIDO=true` em apenas uma.

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [`docs/DOCUMENTACAO.md`](docs/DOCUMENTACAO.md) | Documento de software: objetivo, problema, escopo, requisitos, arquitetura, banco, testes e deploy |
| [`docs/API.md`](docs/API.md) | Endpoints da API REST |
| [`docs/REQUISITOS-STATUS.md`](docs/REQUISITOS-STATUS.md) | Rastreabilidade de cada requisito até o código |
| [`docs/PRIMEIROS-PASSOS.md`](docs/PRIMEIROS-PASSOS.md) | Guia da fase de fundação |
| `docs/FASE-*.md` | Detalhes de cada fase de desenvolvimento |
| [`docs/PAINEL-WEB.md`](docs/PAINEL-WEB.md) | Telas do painel |

## Licença

Projeto acadêmico, desenvolvido por Nicolly Lemos da Silva — ADS, FATEC Sorocaba.
