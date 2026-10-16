# Fase 6: sinal via Pix, recebedor e lembretes

Requisitos: **RF27–RF37**, seção **9.3** (pagamentos), **9.5** (rate limit no Redis), **9.1** (reautenticação).

## Como funciona

1. **Regra do sinal (RF28).** Em **Painel → Sinal e Pix** você liga a cobrança e escolhe porcentagem ou valor fixo e o prazo para pagar.
   Cada serviço pode seguir a regra geral, sempre cobrar (com valor próprio) ou nunca cobrar (no formulário do serviço).
2. **Cliente agenda (fluxo 6.1).** Se o serviço cobra sinal e o recebedor está ativo, o agendamento entra como
   **Aguardando sinal**. O horário fica preso pela trava do banco (RNF02). A tela mostra o QR Code, o copia e cola e um contador (RF29).
3. **Pix pago (RF30).** O gateway manda o webhook. A API confere a assinatura HMAC, recusa eventos com mais de 5 minutos,
   ignora eventos repetidos e **consulta o pagamento direto no gateway** antes de confirmar. Valor menor que o sinal não confirma.
   A tela do cliente confirma sozinha.
4. **Prazo vencido (RF31, fluxo 6.2).** O agendamento vira **Expirado**, o horário volta a ficar livre e o Pix é cancelado no gateway.
   Se o cliente pagar mesmo assim, o agendamento **não volta**: o valor é devolvido automaticamente (ou fica na lista
   "Precisam de atenção", se você desligar a devolução automática).
5. **Cancelamento (RF32, fluxo 6.4).** O cliente cancela pelo link: devolve o sinal se faltar pelo menos X horas
   (configurável); senão a empresa retém. Pelo painel, a gestão escolhe se devolve. Falta = sinal retido.
6. **Fechamento (RF33).** A agenda mostra "falta receber" = valor − sinal pago.
7. **Confirmar sem Pix.** Se o cliente pagou o sinal de outro jeito, a equipe confirma na mão e o Pix pendente é cancelado.

## Recebedor (RF34–RF37)

- Nome/razão social, CPF/CNPJ, tipo e chave Pix, banco, gateway, access token e assinatura secreta do webhook.
- Documento, chave, token e assinatura ficam **cifrados com AES-256-GCM** (a chave mestra fica no `.env`). A tela só recebe os **4 últimos caracteres** (RF35).
- **Salvar, ativar ou desativar pede a senha de novo** (e o código, se o 2FA estiver ligado). Tudo vai para a auditoria, só com os **nomes** dos campos alterados, nunca os valores (RF36, 9.7).
- Todo admin recebe um **e-mail de alerta** com o link **"não fui eu"**: um clique desliga a cobrança, desconecta a conta que fez a alteração de todos os aparelhos e manda um link de troca de senha (fluxo 6.5).
- Qualquer alteração desativa o recebedor: é preciso **testar a conexão** e ativar de novo (RF37).

### Gateways

| Gateway | Para quê |
| --- | --- |
| **Mercado Pago** | Produção. Precisa do access token e da assinatura secreta do webhook. Cadastre o webhook (evento "Pagamentos") com a URL que aparece na tela. A URL precisa ser **pública e https**: configure `API_URL` no `.env`. |
| **Simulado** | Desenvolvimento. Gera um Pix sem valor e mostra o botão **"Simular pagamento (só em teste)"** na tela do cliente. O botão manda um webhook assinado igual ao do Mercado Pago. **Recusado em produção.** |

## Filas (BullMQ + Redis)

- `expirar-sinal`: roda na hora exata do fim do prazo de cada Pix.
- `varredura` (a cada minuto): pega qualquer expiração perdida.
- `lembretes` (a cada 5 minutos): **RF27**, e-mail 24 h e 2 h antes. Quem agendou em cima da hora não recebe o de 24 h. Remarcar zera os lembretes.
- Sem Redis, a API continua no ar: uma varredura de segurança roda dentro dela a cada minuto, então nenhum horário fica preso.
- `WORKER_EMBUTIDO=true` (padrão) roda as filas dentro da API. Com mais de uma instância, deixe `true` em só uma.

## Rate limit no Redis (9.5)

Os contadores agora ficam no Redis: valem com várias instâncias e não zeram quando a API reinicia.
Se o Redis cair, o limite libera (o site não sai do ar) e o login continua protegido pelo bloqueio de conta, que fica no banco.

## Rotas novas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| GET/PUT /admin/pagamentos/config | sinal:gerenciar (PUT com reautenticação) | RF28, RF32 |
| GET/PUT /admin/pagamentos/recebedor | recebedor:gerenciar (PUT com reautenticação) | RF34–RF36 |
| POST /admin/pagamentos/recebedor/testar | recebedor:gerenciar | RF37 |
| POST /admin/pagamentos/recebedor/ativo | recebedor:gerenciar + reautenticação | RF37 |
| GET /admin/pagamentos/situacao | sinal:gerenciar | avisos do painel |
| GET /admin/pagamentos?filtro=atencao | sinal:gerenciar | fluxo 6.2 |
| POST /admin/pagamentos/:id/reembolsar | sinal:gerenciar + reautenticação | RF32 |
| PUT /admin/servicos/:id/sinal | sinal:gerenciar + reautenticação | RF28 |
| POST /webhooks/pagamentos/:gateway | Público, assinatura HMAC | RF30, 9.3 |
| POST /public/agendamentos/status-sinal | Público (token do link) | RF30 |
| POST /public/agendamentos/simular-pix | Só fora de produção | testes |
| POST /public/seguranca/nao-fui-eu | Público (token do e-mail) | RF36, fluxo 6.5 |

## Testes

`src/modules/pagamentos/fase6.int.test.ts`: reautenticação, cifragem e máscara, chave Pix inválida, testar antes de ativar,
sinal calculado no servidor (o front tenta mandar valor e é ignorado), webhook com assinatura errada e antigo,
pagamento menor, confirmação e evento repetido, RF33, devolução e retenção, expiração liberando o horário,
Pix pago depois de expirar, **webhook e expiração ao mesmo tempo**, confirmação manual, lembretes e "não fui eu".

## Ficou para depois

- **WhatsApp nos lembretes:** quando entrar o provedor de mensagens.
- **E-mail de verdade:** por enquanto os e-mails aparecem no terminal da API.
- **Asaas/Efí:** a interface `GatewayPix` já separa o gateway; é só escrever outra implementação.
