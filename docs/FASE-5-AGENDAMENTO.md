# Fase 5 — Agendamento

Requisitos aplicados: **RF04, RF21, RF22, RF23, RF24, RF25, RF26** e **RNF02** (zero
horários sobrepostos, garantido pelo banco). Segurança: **9.2** (posse), **9.5** (limites),
**9.6** (LGPD) e o item **9.9** "teste de concorrência".

Junto com esta fase, o **2FA ficou opcional** para todos os perfis (decisão do projeto).
O início do painel mostra um aviso para quem não ativou.

## A trava da agenda

O banco tem uma "exclusion constraint" (`agendamentos_sem_sobreposicao`): dois
agendamentos ativos do mesmo profissional não podem ter horários que se cruzam,
contando o intervalo de limpeza. Mesmo que duas pessoas cliquem no mesmo segundo, só uma
grava. O teste dispara **20 agendamentos simultâneos no mesmo horário**: 1 passa, 19
recebem "horário indisponível".

O Prisma não gera esse tipo de trava sozinho, então a migration desta fase tem um
passo a mais (veja abaixo). Defesas extras:

- A API confere se a trava existe ao iniciar. Em desenvolvimento, avisa no terminal;
  em produção, **nem sobe** sem ela.
- **Se uma migration futura tiver `DROP CONSTRAINT "agendamentos_sem_sobreposicao"` ou
  `DROP INDEX "agendamentos_sem_sobreposicao"`, apague essa linha antes de aplicar.**

## Passo a passo

Pare a API e o front (Ctrl+C) e, na raiz do projeto:

```powershell
npm install
cd apps/api
npx prisma migrate dev --create-only --name agendamentos
npm run trava-agenda
npx prisma migrate dev
cd ../..
npm run dev:api
```

Em outro terminal, `npm run dev:web`.

- `--create-only` cria a migration sem aplicar.
- `npm run trava-agenda` acrescenta a trava nela (`prisma/sql/trava-agenda.sql`).
- O último comando aplica tudo.

Se você ainda não tinha rodado a migration da Fase 4, essa já leva as tabelas de horários juntas.

## O que entrou

| Requisito | Como funciona |
| --- | --- |
| RF21 | Página `/agendar`: serviço → profissional (ou sem preferência) → dia e horário → dados. |
| RF22 | Painel → Agenda → **Regras de agendamento**: antecedência mínima, até quantos dias à frente, intervalo entre horários. A antecedência vale só para o site; no painel dá para encaixar já. |
| RF23 | O horário fica reservado na hora. Por enquanto entra direto como **Confirmado**; na Fase 6, serviços com sinal entram como **Aguardando sinal**. |
| RF24 | Painel → Agenda → **Novo agendamento**. Com **Encaixe**, aceita horário fora da jornada, mas nunca por cima de outro cliente. |
| RF25 | O e-mail de confirmação tem um link para o cliente remarcar ou cancelar, dentro dos prazos configurados. A equipe remarca pelo painel a qualquer momento. |
| RF26 | Confirmado → Em atendimento → Concluído, além de Cancelado e Não compareceu. Falta só pode ser marcada depois do horário; status final não muda mais. |
| RF04 | `/meus-agendamentos`: o cliente informa o e-mail, recebe um código de 6 dígitos (vale 10 min, 5 tentativas) e vê e cancela os agendamentos. Sem senha. |

## Segurança desta fase

- **Preço e duração copiados** no agendamento: mudar o serviço depois não altera o que
  já foi combinado com o cliente.
- **O site nunca sobrescreve dados de cliente que já existe.** Senão, quem soubesse o
  telefone de alguém poderia trocar o e-mail dela e receber os links.
- **Link de gestão:** token aleatório de 256 bits guardado só como hash. Vai no corpo
  da requisição, nunca na URL da API (URLs vão para logs).
- **Funcionário vê o telefone do cliente mascarado** e sem e-mail (9.6, só o necessário).
- **Funcionário só mexe na própria agenda**: o id vem sempre do login (testado tentando
  mexer em agendamento de outra pessoa).
- **Limites por IP:** 10 agendamentos por hora; 3 pedidos de código a cada 15 min.
- **Consentimento LGPD e aceite da política** obrigatórios e gravados com data.

## Ficou para depois

- **RF27 (lembretes 24 h e 2 h antes):** precisa da fila com Redis, que entra na Fase 6.
- **Captcha no agendamento público (9.5):** Fase 11, junto com o resto do endurecimento.
- **Envio real de e-mail:** por enquanto os e-mails aparecem no terminal da API.

## Rotas criadas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| POST /public/agendamentos | Público (10/h por IP) | RF21, RF23 |
| POST /public/agendamentos/consultar, /cancelar, /reagendar | Token do link | RF25 |
| POST /public/clientes/codigo, /public/clientes/entrar | Público (limitado) | RF04 |
| GET /public/clientes/agendamentos, POST /public/clientes/agendamentos/:id/cancelar | Sessão do cliente | RF04 |
| GET/PUT /admin/agenda/config | `empresa:gerenciar` | RF22 |
| GET /admin/agenda, /admin/agenda/opcoes, /admin/agenda/horarios-livres | `agenda:ver_todas` / `agenda:gerenciar` | RF24 |
| POST /admin/agenda, PATCH /admin/agenda/:id/status, /:id/reagendar | `agenda:gerenciar` | RF24–RF26 |
| GET/POST /staff/agenda, PATCH /staff/agenda/:id/status, /:id/reagendar | Funcionário (só a própria) | RF24–RF26 |
| POST /auth/2fa/desativar | Logado + senha + código | RF01 |
