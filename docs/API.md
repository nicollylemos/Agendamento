# API REST

Base: `http://localhost:3333/api/v1` (em desenvolvimento o front acessa por `http://localhost:5173/api/v1` via proxy do Vite).

## Convenções

- Corpo e respostas em JSON (limite de 100 kB no body).
- Erros seguem o formato `{ "code": "CODIGO", "message": "Texto legível" }`. Erros de validação trazem também os campos inválidos.
- Valores monetários sempre em **centavos** (inteiro). Datas em ISO 8601.
- Campos que não existem no schema são descartados (proteção contra mass assignment).

## Autenticação

| Quem | Como |
| --- | --- |
| Equipe | `POST /auth/login` devolve o access token (JWT, 15 min) e grava o refresh token em cookie `httpOnly`. Envie `Authorization: Bearer <token>`. Renove com `POST /auth/refresh` (exige o header CSRF). |
| Cliente | `POST /public/clientes/codigo` envia um código por e-mail; `POST /public/clientes/entrar` troca o código por um token enviado em `Authorization`. |
| Link de gestão | Cada agendamento online gera um token próprio, usado nas rotas `/public/agendamentos/*`. |
| Gateway | Webhook validado por assinatura HMAC. |

Ações críticas (alterar recebedor, exportar relatórios) exigem antes `POST /auth/reautenticar`.

Legenda: 🌐 pública · 👤 cliente · 🔐 equipe logada · 🛡️ exige reautenticação

---

## Saúde

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | 🌐 Status da API |

## Autenticação — `/auth`

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/auth/login` | 🌐 Login com e-mail e senha |
| POST | `/auth/2fa/verificar` | 🌐 Segunda etapa do login (código TOTP ou de recuperação) |
| POST | `/auth/2fa/configurar` | 🔐 Gera o segredo e o QR Code do 2FA |
| POST | `/auth/2fa/ativar` | 🔐 Confirma o código e ativa o 2FA |
| POST | `/auth/2fa/desativar` | 🔐 Desativa o 2FA |
| POST | `/auth/refresh` | 🌐 Renova o access token (cookie + header CSRF) |
| POST | `/auth/logout` | 🌐 Encerra a sessão |
| GET | `/auth/me` | 🔐 Usuário logado e permissões |
| POST | `/auth/reautenticar` | 🔐 Confirma senha/2FA para ações críticas |
| POST | `/auth/senha/esqueci` | 🌐 Envia link de redefinição |
| POST | `/auth/senha/redefinir` | 🌐 Redefine a senha com o token |
| POST | `/auth/convite/aceitar` | 🌐 Aceita o convite e cria a senha |

## Público — `/public`

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/public/empresa` | 🌐 Dados públicos da empresa |
| GET | `/public/personalizacao` | 🌐 Configuração publicada do site |
| GET | `/public/equipe` | 🌐 Profissionais visíveis |
| GET | `/public/servicos` | 🌐 Serviços visíveis no site |
| GET | `/public/dias-livres` | 🌐 Dias com horário livre para um serviço/profissional |
| GET | `/public/disponibilidade` | 🌐 Horários livres de um dia |
| GET | `/public/fidelidade` | 🌐 Regras públicas do programa de fidelidade |
| POST | `/public/agendamentos` | 🌐 Cria agendamento online (gera Pix se houver sinal) |
| POST | `/public/agendamentos/consultar` | 🌐 Detalhes pelo link de gestão |
| POST | `/public/agendamentos/status-sinal` | 🌐 Situação do pagamento do sinal |
| POST | `/public/agendamentos/simular-pix` | 🌐 Simula o pagamento (só com gateway simulado) |
| POST | `/public/agendamentos/cancelar` | 🌐 Cancela pelo link de gestão |
| POST | `/public/agendamentos/reagendar` | 🌐 Remarca pelo link de gestão |
| POST | `/public/clientes/codigo` | 🌐 Envia código de acesso por e-mail |
| POST | `/public/clientes/entrar` | 🌐 Troca o código por token do cliente |
| GET | `/public/clientes/agendamentos` | 👤 Histórico do cliente |
| POST | `/public/clientes/agendamentos/:id/cancelar` | 👤 Cancela um agendamento próprio |
| GET | `/public/clientes/fidelidade` | 👤 Saldo e extrato de pontos |
| POST | `/public/clientes/fidelidade/resgatar` | 👤 Resgata uma recompensa |
| POST | `/public/seguranca/nao-fui-eu` | 🌐 Reverte alteração do recebedor não reconhecida |
| GET | `/arquivos/:chave` | 🌐 Imagem armazenada localmente |

## Webhooks

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/webhooks/pagamentos/:gateway` | Notificação de pagamento (`mercado_pago` ou `simulado`) |

## Administração — `/admin`

Todas exigem 🔐 e a permissão correspondente.

### Usuários e equipe

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/admin/usuarios` | Lista usuários |
| POST | `/admin/usuarios/convites` | Gera convite de acesso |
| PATCH | `/admin/usuarios/:id/perfil` | Altera o perfil |
| PATCH | `/admin/usuarios/:id/status` | Ativa/desativa (derruba sessões) |
| GET | `/admin/funcionarios` | Lista profissionais |
| POST | `/admin/funcionarios` | Cadastra profissional |
| PATCH | `/admin/funcionarios/:id` | Edita profissional |
| POST | `/admin/funcionarios/:id/acesso` | Gera acesso ao painel para o profissional |

### Empresa e site

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / PUT | `/admin/empresa` | Lê / salva os dados da empresa |
| GET | `/admin/personalizacao` | Rascunho e versão publicada |
| PUT | `/admin/personalizacao/rascunho` | Salva o rascunho |
| POST | `/admin/personalizacao/publicar` | Publica o rascunho |
| POST | `/admin/personalizacao/descartar` | Descarta o rascunho |
| POST | `/admin/arquivos` | Envia imagem (logo, banner, foto) |

### Serviços

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / POST | `/admin/servicos/categorias` | Lista / cria categorias |
| PATCH / DELETE | `/admin/servicos/categorias/:id` | Edita / remove categoria |
| PUT | `/admin/servicos/ordem` | Define a ordem no site |
| GET / POST | `/admin/servicos` | Lista / cria serviços |
| GET / PATCH / DELETE | `/admin/servicos/:id` | Detalha / edita / remove |
| PUT | `/admin/servicos/:id/equipe` | Quem executa, com preço e duração próprios |
| GET / PUT | `/admin/servicos/:id/ficha` | Ficha técnica (produtos e custos extras) |
| PUT | `/admin/servicos/:id/sinal` | Sinal específico do serviço |

### Horários

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / POST | `/admin/horarios/modelos` | Lista / cria modelos de jornada |
| PATCH / DELETE | `/admin/horarios/modelos/:id` | Edita / remove modelo |
| GET / PUT | `/admin/horarios/funcionarios/:id/jornada` | Lê / salva a jornada do profissional |
| POST | `/admin/horarios/funcionarios/:id/jornada/aplicar-modelo` | Aplica um modelo |
| GET / POST | `/admin/horarios/excecoes` | Lista / cria exceções (feriados, folgas) |
| DELETE | `/admin/horarios/excecoes/:id` | Remove exceção |
| GET / POST | `/admin/horarios/bloqueios` | Lista / cria bloqueios |
| DELETE | `/admin/horarios/bloqueios/:id` | Remove bloqueio |
| GET | `/admin/horarios/diagnostico` | Aponta profissionais/serviços sem horário |
| GET | `/admin/horarios/disponibilidade` | Horários livres (visão interna) |

### Agenda

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / PUT | `/admin/agenda/config` | Antecedência mínima/máxima e regras |
| GET | `/admin/agenda/visual` | Configuração visual da agenda |
| PUT | `/admin/agenda/cores` | Cores por status/serviço |
| PUT | `/admin/agenda/meta` | Metas exibidas no painel |
| GET | `/admin/agenda/opcoes` | Serviços e profissionais para o formulário |
| GET | `/admin/agenda/horarios-livres` | Horários livres para agendamento manual |
| GET | `/admin/agenda/profissionais` | Agenda do dia em grade, por profissional |
| GET / POST | `/admin/agenda` | Lista / cria agendamento manual (com encaixe) |
| PATCH | `/admin/agenda/:id/status` | Muda o status (concluir faz baixa no estoque e credita pontos) |
| PATCH | `/admin/agenda/:id/reagendar` | Remarca |
| GET | `/admin/agenda/:id/consumo` | Produtos previstos para a conclusão |

### Pagamentos

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/admin/pagamentos/situacao` | Situação do recebedor e do sinal |
| GET / PUT | `/admin/pagamentos/config` | Regras do sinal e da devolução |
| GET | `/admin/pagamentos/recebedor` | Recebedor (só os 4 últimos caracteres) |
| PUT | `/admin/pagamentos/recebedor` | 🛡️ Altera o recebedor |
| POST | `/admin/pagamentos/recebedor/testar` | Testa a conexão com o gateway |
| GET | `/admin/pagamentos` | Lista pagamentos |
| POST | `/admin/pagamentos/:id/reembolsar` | Devolve o sinal |

### Estoque

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / POST | `/admin/estoque/produtos` | Lista / cria produtos |
| PATCH / DELETE | `/admin/estoque/produtos/:id` | Edita / remove |
| GET | `/admin/estoque/produtos/:id/movimentos` | Histórico do produto |
| POST | `/admin/estoque/movimentos` | Lança entrada, saída, inventário ou perda |
| GET | `/admin/estoque/alertas` | Estoque baixo e validade próxima |

### Fidelidade

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / PUT | `/admin/fidelidade/programa` | Regras do programa |
| GET / POST | `/admin/fidelidade/recompensas` | Lista / cria recompensas |
| PUT / DELETE | `/admin/fidelidade/recompensas/:id` | Edita / remove |
| GET | `/admin/fidelidade/clientes` | Clientes e saldos |
| GET | `/admin/fidelidade/clientes/:id` | Extrato do cliente |
| POST | `/admin/fidelidade/clientes/:id/ajuste` | Ajuste manual com justificativa |
| POST | `/admin/fidelidade/clientes/:id/resgates` | Resgate feito no balcão |
| GET | `/admin/fidelidade/vouchers/:codigo` | Consulta voucher |
| POST | `/admin/fidelidade/vouchers/:id/usar` | Marca voucher como usado |
| POST | `/admin/fidelidade/vouchers/:id/cancelar` | Cancela voucher |

### Relatórios

`:tipo` = `faturamento`, `sinais`, `ocupacao`, `servicos`, `estoque`, `clientes`, `fidelidade` ou `comissoes`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/admin/relatorios/profissionais` | Profissionais para o filtro |
| GET | `/admin/relatorios/:tipo` | Dados do relatório (filtros por período e profissional na query) |
| GET | `/admin/relatorios/:tipo/exportar` | 🛡️ Exporta em CSV ou PDF |

### Instagram

| Método | Rota | Descrição |
| --- | --- | --- |
| GET / POST | `/admin/posts` | Lista / cria posts |
| GET / PATCH / DELETE | `/admin/posts/:id` | Detalha / edita / remove |

## Equipe — `/staff`

Mesmas operações do admin, mas sempre limitadas ao profissional logado (o id vem do token, nunca da requisição).

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/staff/horarios` | Minha jornada, exceções e bloqueios |
| PUT | `/staff/horarios/jornada` | Edita minha jornada (se liberado) |
| POST / DELETE | `/staff/horarios/excecoes[/:id]` | Minhas exceções |
| POST / DELETE | `/staff/horarios/bloqueios[/:id]` | Meus bloqueios |
| GET / POST | `/staff/agenda` | Minha agenda / novo agendamento |
| GET | `/staff/agenda/visual`, `/staff/agenda/profissionais`, `/staff/agenda/opcoes`, `/staff/agenda/horarios-livres` | Apoio à agenda |
| PATCH | `/staff/agenda/:id/status`, `/staff/agenda/:id/reagendar` | Status e remarcação |
| GET | `/staff/agenda/:id/consumo` | Consumo previsto |
| GET | `/staff/relatorios/:tipo` | Meus relatórios (faturamento, ocupação, comissões) |
| GET | `/staff/relatorios/:tipo/exportar` | 🛡️ Exporta meus relatórios |

## Testando manualmente

Os arquivos em `apps/api/requests/*.http` têm exemplos prontos para a extensão **REST Client** do VS Code.
