# Status dos requisitos

Atualizado a cada fase. Os códigos RF/RNF e as seções 9.x são os da documentação do sistema.
Nos arquivos, procure o código no comentário (ex.: `// RF05`) para achar onde cada um foi aplicado.

## Requisitos funcionais

| Código | Requisito | Status | Onde |
| --- | --- | --- | --- |
| RF01 | Login com e-mail e senha; 2FA **opcional** para todos (decisão de 13/10, com aviso no painel) | ✅ Fase 2 / ajustado na Fase 5 | `modules/auth/auth.service.ts` (login, verificarMfa, configurarMfa, ativarMfa), `mfa.service.ts` |
| RF02 | Acesso ao painel por link de uso único (48 h). **Opcional** desde 14/10: o admin gera o link e recebe uma mensagem pronta para colar no WhatsApp | ✅ Fase 2 / ajustado em 14/10 | `usuarios.service.ts` (gerarConvite), `funcionarios.service.ts` (darAcesso), `auth.service.ts` (aceitarConvite vincula ao profissional) |
| RF03 | Recuperação de senha, link de uso único de 30 min | ✅ Fase 2 | `auth.service.ts` (esqueciSenha, redefinirSenha) |
| RF04 | Cliente agenda sem senha, código por e-mail para ver histórico | ✅ Fase 5 | `modules/clientes/clientes.service.ts`, `/meus-agendamentos` |
| RF05 | Desativar funcionário derruba as sessões na hora (e tira o profissional da agenda) | ✅ Fase 2 | `usuarios.service.ts` (alterarStatus), `middlewares/authenticate.ts` |
| RF06 | Dados da empresa | ✅ Fase 3 | `modules/empresa/` (logo fica na personalização, Fase 9) |
| RF07 | Personalização: cores, fontes, logo, banner, textos, ordem dos serviços, perguntas extras | ✅ Fase 9 | `modules/personalizacao/`, `modules/arquivos/`, tela Site |
| RF08 | Prévia ao vivo antes de publicar (rascunho × publicado) | ✅ Fase 9 | `personalizacao.service.ts` (salvarRascunho, publicar), `pages/admin/Personalizacao.tsx` |
| RF09 | Landing com serviços, equipe, galeria, depoimentos, mapa e contato | ✅ Fase 9 | `components/site/Landing.tsx`, rota `/` |
| RF10 | Admin escolhe as seções e a ordem | ✅ Fase 9 | `personalizacao.schemas.ts` (secoes) |
| RF11 | Botão do serviço leva direto a ele no agendamento | ✅ Fase 9 | `/agendar?servico=…` |
| RF12 | CRUD de serviços com foto; a lista mostra se o serviço aparece no site e o motivo quando não aparece | ✅ Fase 3 / foto na Fase 9 | `modules/servicos/servicos.service.ts` (motivoForaDoSite) |
| RF13 | Profissional cadastrado direto (só o nome é obrigatório, login opcional); quem executa cada serviço, com preço/duração próprios | ✅ Fase 3 / refeito em 14/10 | `funcionarios.service.ts` (criar), `servicos.service.ts` (definirEquipe), `modules/publico/`, migration `20261014013000_profissionais` |
| RF14 | Ficha técnica: produtos por atendimento e custos extras | ✅ Fase 7 | `modules/estoque/ficha.service.ts`, formulário do serviço |
| RF15 | Custo e margem de cada serviço | ✅ Fase 7 | `ficha.service.ts` (custoDaFicha, margem), lista de serviços |
| RF16 | Modelos de jornada | ✅ Fase 4 | `modules/horarios/` (copiado ao aplicar) |
| RF17 | Jornada por funcionário, faixas, exceções por data | ✅ Fase 4 | `horarios.service.ts`, exceção geral = feriado |
| RF18 | Bloqueios manuais | ✅ Fase 4 | `horarios.service.ts` (motivo nunca vai para o público) |
| RF19 | Funcionário edita os próprios horários se liberado | ✅ Fase 4 | `horarios.routes.ts` (rotas /staff) |
| RF20 | Cálculo de horários livres | ✅ Fase 4 | `disponibilidade.ts` (agendamentos entram na Fase 5) |
| RF21 | Fluxo de agendamento pelo site | ✅ Fase 5 | `/agendar`, `agendamentos.service.ts` (criarOnline) |
| RF22 | Antecedência mínima e máxima configuráveis | ✅ Fase 5 | `modules/agenda/config.service.ts` |
| RF23 | Horário reservado ao agendar (com sinal, fica "Aguardando sinal" até pagar ou expirar) | ✅ Fase 5 / Fase 6 | `agendamentos.service.ts` (criarOnline) |
| RF24 | Agendamento manual pelo painel, com encaixe | ✅ Fase 5 | `agendamentos.service.ts` (criarPainel) |
| RF25 | Remarcar e cancelar (cliente pelo link, equipe pelo painel) | ✅ Fase 5 | Devolução do sinal: RF32 |
| RF26 | Status e transições | ✅ Fase 5 | `modules/agendamentos/status.ts` |
| — | Agenda do dia em grade (Início e Agenda), uma coluna por profissional | ✅ 14/10 | `components/agenda/GradeDia.tsx`, `GET /admin/agenda/profissionais`, `GET /staff/agenda/profissionais` |
| RF27 | Lembretes por e-mail 24 h e 2 h antes | ✅ Fase 6 | `jobs/lembretes.ts`, fila BullMQ (`jobs/worker.ts`). WhatsApp numa fase futura |
| RF28 | Sinal global e por serviço (fixo ou %, prazo) | ✅ Fase 6 | `pagamentos/sinal.service.ts`, `sinalServico.ts`, tela Sinal e Pix |
| RF29 | Pix com QR Code e copia e cola | ✅ Fase 6 | `pagamentos/gateway/mercadoPago.ts`, `components/pagamento/PixSinal.tsx` |
| RF30 | Confirmação automática pelo webhook | ✅ Fase 6 | `pagamentos.service.ts` (processarWebhook), `gateway/assinatura.ts` |
| RF31 | Expira sem pagamento e libera o horário | ✅ Fase 6 | `pagamentos.service.ts` (expirarVencidos), fila + varredura |
| RF32 | Política de devolução configurável | ✅ Fase 6 | `pagamentos.service.ts` (aposEncerrar, reembolsar) |
| RF33 | Sinal abatido do total | ✅ Fase 6 | `agendamentos.service.ts` (resumoSinal: `restanteCentavos`) |
| RF34 | Tela do recebedor | ✅ Fase 6 | `pagamentos/recebedor.service.ts`, `pages/admin/Pagamentos.tsx` |
| RF35 | Só os 4 últimos caracteres na tela | ✅ Fase 6 | `recebedor.service.ts` (paraTela) |
| RF36 | Alterar exige senha + 2FA, auditoria e e-mail ao admin (com "não fui eu") | ✅ Fase 6 | `pagamentos.routes.ts` (requireReauth), `recebedor.service.ts` (alertarAdmins, naoFuiEu) |
| RF37 | Testar conexão antes de ativar | ✅ Fase 6 | `recebedor.service.ts` (testar, definirAtivo) |
| RF38 | Cadastro de produtos | ✅ Fase 7 | `modules/estoque/estoque.service.ts`, tela Estoque |
| RF39 | Movimentações (entrada, saída, inventário, perda) com motivo e usuário | ✅ Fase 7 | `estoque.service.ts` (lancar, movimentar); histórico só de inserção (trigger no banco) |
| RF40 | Baixa automática ao concluir, com ajuste da quantidade real | ✅ Fase 7 | `estoque/consumo.service.ts`, `agendamentos.service.ts` (mudarStatus, mesma transação) |
| RF41 | Alertas de estoque mínimo e validade | ✅ Fase 7 | `estoque.service.ts` (avisos por e-mail via fila), Início e Estoque |
| RF42 | Custo médio ponderado a cada entrada | ✅ Fase 7 | `estoque.service.ts` (lancar), com trava de linha |
| RF43 | Programa de pontos (por real, por visita) ou cartão de selos | ✅ Fase 8 | `modules/fidelidade/fidelidade.service.ts`, tela Fidelidade → Programa |
| RF44 | Recompensas (desconto, serviço grátis, brinde) com custo e validade | ✅ Fase 8 | `fidelidade.service.ts` (resgatar, vouchers com código) |
| RF45 | Pontos só ao concluir; estorno se cancelar | ✅ Fase 8 | `fidelidade.service.ts` (creditarAtendimento, estornarAtendimento), mesma transação da conclusão |
| RF46 | Cliente vê saldo e extrato; admin ajusta com justificativa | ✅ Fase 8 | `/meus-agendamentos`, tela Fidelidade → Clientes; extrato com trigger no banco |
| RF47 | Faturamento por período, serviço, profissional e forma de pagamento | ✅ Fase 10 | `modules/relatorios/relatorios.service.ts` (faturamento); forma de pagamento informada ao concluir |
| RF48 | Sinais recebidos, retidos, devolvidos e não pagos | ✅ Fase 10 | `relatorios.service.ts` (sinais) |
| RF49 | Taxa de ocupação da agenda | ✅ Fase 10 | `relatorios.service.ts` (ocupacao), `relatorios/intervalos.ts` |
| RF50 | Rentabilidade por serviço (receita − custo − comissão) | ✅ Fase 10 | `relatorios.service.ts` (servicos) |
| RF51 | Estoque: posição, consumo e perdas | ✅ Fase 10 | `relatorios.service.ts` (estoque) |
| RF52 | Clientes: novos × recorrentes, ticket médio, faltas, ranking | ✅ Fase 10 | `relatorios.service.ts` (clientes) |
| RF53 | Fidelidade: emitidos, trocados, vencidos, saldo em aberto | ✅ Fase 10 | `relatorios.service.ts` (fidelidade) |
| RF54 | Comissões (% por serviço e profissional, congelada ao concluir) | ✅ Fase 10 | `agendamentos.service.ts` (calcularComissao), `relatorios.service.ts` (comissoes) |
| RF55 | Exportar em CSV e PDF | ✅ Fase 10 | `relatorios/exportar.ts`, `relatorios.routes.ts` (reautenticação + auditoria) |

## Telas

O painel web cobre tudo que a API já faz: login, 2FA opcional, convite, senha, empresa,
serviços, equipe, horários e agenda. O cliente agenda em `/agendar`. Detalhes em `PAINEL-WEB.md`.

## Segurança (seção 9)

| Item | Status | Onde |
| --- | --- | --- |
| 9.1 Senha com argon2id (19 MiB, 2 iterações) | ✅ | `lib/password.ts` |
| 9.1 Mínimo de 10 caracteres + checagem de senhas vazadas (HIBP, k-anonymity) | ✅ | `lib/password.ts` |
| 9.1 2FA TOTP com códigos de recuperação em hash | ✅ | `modules/auth/mfa.service.ts` |
| 9.1 Código TOTP não pode ser reutilizado (anti-replay) | ✅ | `mfa.service.ts` (totpUltimoPasso) |
| 9.1 Access token JWT de 15 min com EdDSA | ✅ | `lib/jwt.ts` |
| 9.1 Refresh em cookie httpOnly + Secure + SameSite=Strict, com rotação | ✅ | `modules/auth/sessao.service.ts` |
| 9.1 Reuso de refresh token revoga a família inteira (com 10 s de tolerância para abas simultâneas) | ✅ | `sessao.service.ts` (renovarSessao) |
| 9.1 Token de acesso só em memória no navegador | ✅ | `apps/web/src/lib/api.ts` |
| 9.1 Bloqueio progressivo (5 erros → 15 min, depois 1 h) | ✅ | `modules/auth/bloqueio.ts`, `auth.service.ts` |
| 9.1 Mensagem genérica e tempo igual (não revela contas) | ✅ | `auth.service.ts` (login), `lib/password.ts` (hash falso) |
| 9.1 Reautenticação para ações críticas | ✅ | `middlewares/requireReauth.ts`, `POST /auth/reautenticar` |
| 9.1 Tokens de convite/reset aleatórios, uso único, guardados como hash | ✅ | `auth.service.ts` (criarTokenUso, consumirToken) |
| 9.2 RBAC com permissões finas, checado no backend | ✅ | `modules/auth/permissoes.ts`, `middlewares/requirePermission.ts` |
| 9.2 Checagem de posse (IDOR) | ✅ | `/staff/horarios` e `/staff/agenda` usam sempre o funcionário do login; cliente só cancela os próprios (testado) |
| RNF02 Zero agendamentos sobrepostos, garantido pelo banco | ✅ | `prisma/sql/trava-agenda.sql`, conferida ao iniciar a API (`lib/travaAgenda.ts`) |
| 9.9 Teste de concorrência: 20 requisições no mesmo horário | ✅ | `fase5.int.test.ts` |
| 9.2 Mass assignment bloqueado (Zod descarta campos extras) | ✅ | `*.schemas.ts`, `middlewares/validate.ts` (testado na empresa) |
| 9.6 CPF da empresa nunca sai na rota pública | ✅ | `modules/empresa/empresa.service.ts` (paraPublico) |
| 9.3 Segredos cifrados com AES-256-GCM, chave fora do banco | ✅ | `lib/crypto.ts` (2FA e recebedor) |
| 9.3 Valor do sinal sempre calculado no servidor | ✅ | `sinal.service.ts` (calcularSinal), testado |
| 9.3 Webhook: HMAC, janela de 5 min, consulta no gateway, idempotência, conferência de valor e moeda | ✅ | `gateway/assinatura.ts`, `pagamentos.service.ts`, tabelas `webhook_eventos` e `pagamentos` (ids únicos) |
| 9.4 Validação Zod, limite de body, Helmet, CORS restrito | ✅ | `app.ts` |
| 9.4 Upload: magic bytes, 5 MB, sharp sem metadados, nome aleatório, fora do servidor (S3) | ✅ | `modules/arquivos/`, `lib/armazenamento.ts` |
| 9.4 Textos de personalização sem HTML; cores e fontes por lista permitida | ✅ | `personalizacao.schemas.ts` (texto puro, #RRGGBB com contraste, fontes da lista) |
| 9.4 Proteção CSRF nas rotas com cookie | ✅ | `middlewares/csrf.ts` |
| 9.5 Rate limit por rota (login, 2FA, reset, agendamento, código do cliente, webhook, Pix) | ✅ (Redis) | `middlewares/rateLimit.ts`, `lib/redis.ts` |
| 9.7 Log de auditoria | ✅ | `lib/audit.ts` (Fase 3: empresa, serviços, preço com valor anterior, equipe) |
| 9.7 Auditoria "só inserção" garantida no banco | 🟡 | Histórico de estoque (Fase 7) e extrato de pontos (Fase 8) já têm trigger; log de auditoria na Fase 11 |
| 9.8 Segredos só no .env validado | ✅ | `config/env.ts`, `scripts/gerar-chaves.ts` |
