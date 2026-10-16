# Fase 8: fidelidade

Requisitos: **RF43–RF46**, fluxo **6.3** (conclusão) e seção **9.7** (auditoria).

## Como usar

1. **Painel → Fidelidade → Programa (RF43).** Ligue o programa e escolha como o cliente ganha:
   - **Pontos:** X pontos a cada R$ 1 gasto e/ou um bônus fixo por visita.
   - **Cartão de selos:** 1 selo por atendimento (ex.: 10 cortes = 1 grátis).
   - Também dá para definir a validade (3 meses a 2 anos, ou não vencem) e quais serviços participam.
2. **Recompensas (RF44).** Desconto em reais, serviço grátis ou brinde, cada uma com o custo em pontos e quantos dias o voucher vale.
3. **Ganhar pontos (RF45).** Os pontos só entram quando o atendimento é **concluído**, na mesma transação da conclusão e da baixa de estoque. O cliente recebe um e-mail com o saldo. Se um atendimento que gerou pontos for cancelado, eles são estornados (o que ainda houver).
4. **Clientes (RF46).** Busque por nome, telefone ou e-mail. Na ficha do cliente:
   - saldo e quando os próximos pontos vencem;
   - extrato completo;
   - trocar por recompensa;
   - ajustar pontos, sempre com justificativa, que fica no extrato e na auditoria.
5. **Vouchers.** Toda troca gera um código de 8 letras (sem 0/O e 1/I, fácil de ditar), enviado por e-mail.
   No balcão, use **Usar voucher → Conferir** e **Marcar como usado**. Cancelar um voucher devolve os pontos.
6. **O cliente pelo site (RF46).** Em "Meus agendamentos", depois de entrar com o código do e-mail, ele vê o saldo, os vouchers, as recompensas (e quanto falta para cada uma) e o extrato, e troca sozinho.

## Regras que protegem os pontos

- **Saldo travado por cliente:** toda operação trava o cliente (`SELECT ... FOR UPDATE`). Testado com 3 resgates ao mesmo tempo para um saldo que cabia só 2: passaram 2.
- **FIFO:** quem gasta usa primeiro os pontos que vencem antes.
- **Um crédito por atendimento:** índice único (agendamento + tipo). Concluir duas vezes ao mesmo tempo credita uma vez só (testado).
- **Voucher usado uma vez só:** a mudança de status é condicional.
- **Extrato à prova de edição (9.7):** um trigger no banco recusa DELETE e qualquer UPDATE. A única exceção é o "disponível" de um crédito, que só pode **diminuir** (quando gasta ou vence).
- **Vencimento:** todo dia às 3h uma tarefa da fila zera os créditos vencidos, registra "Venceram" no extrato e marca os vouchers vencidos.
- **Privacidade (9.6):** o cliente não vê quem fez ajustes nem as justificativas internas.
- **Permissões (9.2):** só o admin mexe na fidelidade.

## Rotas novas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| GET/PUT /admin/fidelidade/programa | fidelidade:gerenciar | RF43 |
| GET/POST/PUT/DELETE /admin/fidelidade/recompensas | fidelidade:gerenciar | RF44 |
| GET /admin/fidelidade/clientes, GET /admin/fidelidade/clientes/:id | fidelidade:gerenciar | RF46 |
| POST /admin/fidelidade/clientes/:id/ajuste | fidelidade:gerenciar | RF46, 9.7 |
| POST /admin/fidelidade/clientes/:id/resgates | fidelidade:gerenciar | RF44 |
| GET /admin/fidelidade/vouchers/:codigo, POST .../usar, POST .../cancelar | fidelidade:gerenciar | RF44 |
| GET /public/clientes/fidelidade, POST /public/clientes/fidelidade/resgatar | Cliente (código por e-mail) | RF46 |
| GET /public/fidelidade | Público | regras do programa |

## Testes

`src/modules/fidelidade/fase8.int.test.ts`:
- programa desligado, permissões, crédito ao concluir com e-mail;
- conclusão em dobro, serviço fora do programa;
- recompensa inválida, resgate, saldo insuficiente, cancelar e devolver;
- voucher usado duas vezes, resgates simultâneos;
- ajuste com justificativa e auditoria, extrato imutável;
- visão do cliente sem dados internos, vencimento, cartão de selos.

## Ficou para depois

- **Abater o voucher no valor do atendimento automaticamente:** hoje a equipe marca como usado e dá o desconto no caixa. Entra quando houver o fechamento financeiro.
- **Relatório de pontos emitidos, resgatados e vencidos (RF53):** entra na Fase 10.
