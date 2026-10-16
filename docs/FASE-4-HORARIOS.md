# Fase 4 — Horários por funcionário

Requisitos aplicados: **RF16, RF17, RF18, RF19, RF20**.
Segurança: **9.2** (checagem de posse: funcionário só mexe nos próprios horários).

## Como funciona

- **Jornada da semana (RF17):** cada dia tem uma ou mais faixas, ex.: 09:00–12:00 e
  13:00–18:00. O intervalo de almoço é o espaço entre as faixas.
- **Modelos (RF16):** uma jornada pronta ("Comercial seg a sex"). Ao aplicar, ela é
  **copiada** para a pessoa, que pode ser ajustada depois sem alterar o modelo.
- **Exceções (RF17):** para uma data específica: folga ou horário diferente. Sem
  funcionário escolhido, vale para a equipe toda (feriado, empresa fechada).
- **Bloqueios (RF18):** um período sem atendimento (consulta, reunião). O motivo só a
  equipe vê; o cliente só percebe que o horário não está livre.
- **Funcionário (RF19):** vê os próprios horários em "Meus horários" e só edita se o admin
  ligar "Pode ajustar os próprios horários" na Equipe.
- **Horários livres (RF20):** para cada profissional que faz o serviço, no dia escolhido:

  ```
  faixas do dia (exceção do funcionário > feriado geral > jornada da semana)
  − bloqueios
  − agendamentos (entram na Fase 5)
  − duração do serviço + intervalo de limpeza
  − horários que já passaram
  ```

  Os horários são oferecidos de 15 em 15 minutos e só até 60 dias à frente
  (os dois viram configuração na Fase 5).

## Decisões

- **Minutos desde a meia-noite** no banco (09:30 = 570). Contas de horário viram
  contas de inteiro, sem armadilha de fuso.
- **Fuso da empresa** (`America/Sao_Paulo` por padrão) decide o que é "dia" e "hora".
  Bloqueios são gravados em UTC e convertidos na hora de mostrar.
- **Cálculo como função pura** (`disponibilidade.ts`): não depende do banco, então tem
  testes para cada caso chato (almoço, limpeza invadindo o próximo cliente, ocupação que
  vem do dia anterior, antecedência mínima).

## Passo a passo

```powershell
npm install
cd apps/api
npx prisma migrate dev --name horarios
cd ../..
npm run dev:api
npm run dev:web
```

No painel: **Horários** → escolha a pessoa → monte a jornada → salve. Depois, na aba
**Horários livres**, escolha um serviço e uma data para ver o que o cliente veria.

## Rotas criadas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| GET/POST /admin/horarios/modelos, PATCH/DELETE /admin/horarios/modelos/:id | `horarios:gerenciar` | RF16 |
| GET/PUT /admin/horarios/funcionarios/:id/jornada | `horarios:gerenciar` | RF17 |
| POST /admin/horarios/funcionarios/:id/jornada/aplicar-modelo | `horarios:gerenciar` | RF16 |
| GET/POST /admin/horarios/excecoes, DELETE /admin/horarios/excecoes/:id | `horarios:gerenciar` | RF17 |
| GET/POST /admin/horarios/bloqueios, DELETE /admin/horarios/bloqueios/:id | `horarios:gerenciar` | RF18 |
| GET /admin/horarios/disponibilidade | `horarios:gerenciar` | RF20 |
| GET /staff/horarios, PUT /staff/horarios/jornada | Logado (edição só se liberado) | RF19 |
| POST/DELETE /staff/horarios/excecoes, /staff/horarios/bloqueios | Logado + liberado + só os próprios | RF19, 9.2 |
| GET /public/disponibilidade?servicoId&data&funcionarioId | Público | RF20 |

Gerente também gerencia horários (`horarios:gerenciar`).
