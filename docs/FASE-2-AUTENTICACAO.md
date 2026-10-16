# Fase 2 — Autenticação e permissões

> **Atualização (Fase 5):** o 2FA agora é **opcional** para todos, inclusive o admin.
> Não existe mais a etapa `MFA_SETUP`. A pessoa liga e desliga o 2FA em
> **Minha conta** (`POST /auth/2fa/configurar`, `/auth/2fa/ativar` e `/auth/2fa/desativar`,
> todas com login).

Requisitos aplicados: **RF01, RF02, RF03, RF05** e itens **9.1, 9.2, 9.3, 9.4, 9.5, 9.7** de segurança.
O que ficou para depois está em `REQUISITOS-STATUS.md`.

## Como os pedaços se encaixam

1. **Login** (`POST /auth/login`) confere a senha. Se der certo, responde uma `etapa`:
   - `MFA`: conta com 2FA. Precisa mandar o código do app.
   - `OK`: conta sem 2FA. Já recebe o `accessToken`.
2. O **mfaToken** é um JWT de 5 min que só serve para a etapa do 2FA.
3. Quando o login termina, a API devolve um **access token** (15 min, vai no header
   `Authorization`) e grava um **refresh token** num cookie httpOnly.
4. Quando o access token vence, o front chama `POST /auth/refresh` (com o header
   `X-Requested-With: agendamento`) e recebe outro. O cookie é trocado a cada uso.
5. Em toda rota protegida, o middleware `authenticate` confere no banco se a sessão
   ainda vale e se o usuário está ativo. Por isso desativar alguém derruba o acesso na hora (RF05).

## Passo a passo

### 1. Instalar as dependências novas

```powershell
npm install
npm audit
```

### 2. Gerar as chaves e completar o `.env` da API

```powershell
npm run gerar-chaves -w apps/api
```

Cole as 3 linhas no `apps/api/.env` e adicione também:

```
APP_URL=http://localhost:5173
HIBP_ENABLED=true
```

Cada ambiente (dev, produção) tem suas próprias chaves. Se a `ENCRYPTION_KEY` for perdida,
os 2FA cadastrados param de funcionar.

### 3. Criar as tabelas

```powershell
cd apps/api
npx prisma migrate dev --name auth
cd ../..
```

### 4. Criar o primeiro admin

```powershell
npm run criar-admin -w apps/api -- --nome "Seu Nome" --email voce@exemplo.com
```

A senha é pedida no terminal e não aparece enquanto você digita.

### 5. Testar na mão

```powershell
npm run dev:api
```

Abra `apps/api/requests/auth.http` no VS Code (extensão **REST Client**) e siga os blocos na ordem:

1. Login → copie o `accessToken`.
2. (Opcional) Configurar 2FA → copie o valor de `qrCode` e cole na barra do navegador.
   Escaneie com o Google Authenticator (ou digite o `segredo`).
3. (Opcional) Ativar 2FA com o código do app → **guarde os 10 códigos de recuperação**.
4. Teste o convite: o link aparece no terminal da API (o envio de e-mail de verdade entra depois).

### 6. Rodar os testes

Testes que não precisam de banco:

```powershell
npm test
```

Testes de integração (fluxo completo com banco). Use um banco separado, porque o teste apaga os dados:

```powershell
docker compose exec postgres createdb -U agendamento agendamento_test
cd apps/api
$env:DATABASE_URL="postgresql://agendamento:SUA_SENHA@localhost:5432/agendamento_test"; npx prisma migrate deploy
$env:TEST_DATABASE_URL=$env:DATABASE_URL; npm test
Remove-Item Env:DATABASE_URL, Env:TEST_DATABASE_URL
cd ../..
```

Devem passar todos os testes (o número cresce a cada fase).

## Rotas criadas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| POST /auth/login | Público | RF01 |
| POST /auth/2fa/configurar | mfaToken ou logado | RF01 |
| POST /auth/2fa/ativar | mfaToken ou logado | RF01 |
| POST /auth/2fa/verificar | mfaToken | RF01 |
| POST /auth/refresh | Cookie + header CSRF | 9.1 |
| POST /auth/logout | Cookie + header CSRF | 9.1 |
| GET /auth/me | Logado | — |
| POST /auth/reautenticar | Logado | 9.1 |
| POST /auth/senha/esqueci | Público | RF03 |
| POST /auth/senha/redefinir | Link | RF03 |
| POST /auth/convite/aceitar | Link | RF02 |
| GET /admin/usuarios | `usuarios:gerenciar` | 9.2 |
| POST /admin/usuarios/convites | `usuarios:gerenciar` | RF02 |
| PATCH /admin/usuarios/:id/status | `usuarios:gerenciar` | RF05 |
| PATCH /admin/usuarios/:id/perfil | `usuarios:gerenciar` + reautenticação | 9.2 |

## Decisões tomadas

- **Sem camada de repositório separada:** os services usam o Prisma direto. O Prisma já faz o papel
  de repositório e queries parametrizadas; uma camada extra só duplicaria código por enquanto.
- **Rate limit em memória:** funciona com uma instância da API. Vai para o Redis na Fase 6, junto com as filas.
- **Novos admins não entram por convite:** o convite só cria gerente ou funcionário.
  Para promover alguém a admin, use a troca de perfil (exige reautenticação).
- **Sempre existe pelo menos um admin ativo:** a API não deixa desativar ou rebaixar o último.
