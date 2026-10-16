# Fase 7: estoque e ficha técnica

Requisitos: **RF14, RF15, RF38–RF42**, fluxo **6.3** (conclusão do atendimento) e seção **9.7** (auditoria).

## Como usar

1. **Painel → Estoque → Novo produto (RF38).** Nome, unidade de controle (ml, g ou unidade), mínimo, categoria, SKU, fornecedor e validade.
   Dá para lançar o estoque inicial e quanto pagou por ele; isso vira o custo médio.
2. **Movimentações (RF39).** Cada produto tem quatro ações:
   - **Entrada:** compra. Você informa a quantidade e o valor total pago, e a tela mostra o novo custo médio antes de salvar.
   - **Baixa:** perda ou saída, sempre com motivo.
   - **Inventário:** informa quanto contou e o sistema lança a diferença.
   - **Histórico:** o que entrou e saiu, quem fez e de qual atendimento.
3. **Custo médio ponderado (RF42).** É recalculado a cada entrada: `(saldo × custo atual + valor pago) ÷ (saldo + quantidade)`.
4. **Ficha técnica (RF14).** No formulário do serviço, diga quanto de cada produto um atendimento gasta e os custos extras (ex.: descartáveis).
5. **Custo e margem (RF15).** A lista de serviços mostra a margem (fica laranja abaixo de 30%) e o custo por atendimento.
6. **Baixa automática (RF40).** Ao clicar em **Concluir**, aparece a ficha técnica com as quantidades sugeridas. O profissional corrige o que gastou de verdade e a baixa sai junto com a conclusão.
7. **Alertas (RF41):**
   - **Estoque mínimo:** quando um produto cruza o mínimo, admins e gerentes recebem um e-mail, uma vez só até repor.
   - **Validade:** todo dia às 8h sai o aviso dos produtos que vencem em até 15 dias.
   - **No painel:** o Início e o Estoque mostram o que está abaixo do mínimo, vencido ou vencendo em 30 dias.

## Regras que protegem os dados

- **Tudo ou nada (fluxo 6.3):** concluir o atendimento e baixar o estoque acontecem na mesma transação. Se algo falhar, nada muda.
- **Trava por produto:** todo movimento trava a linha do produto (`SELECT ... FOR UPDATE`). Duas baixas ao mesmo tempo nunca leem o mesmo saldo, e o custo médio não se perde. Testado com 12 saídas simultâneas.
- **Ordem fixa de trava** entre produtos: dois fechamentos simultâneos não travam um ao outro (deadlock).
- **Saldo negativo:** saída manual nunca deixa o saldo negativo. A baixa automática deixa (não trava o fechamento por causa de saldo errado), e o alerta avisa.
- **Concluir duas vezes ao mesmo tempo baixa uma vez só** (mudança de status condicional). Testado.
- **Histórico só de inserção (RF39, 9.7):** um trigger no banco recusa UPDATE e DELETE em `movimentacoes_estoque`, mesmo que algum código tente.
- **Produto em ficha técnica não pode ser removido.** Remover é exclusão lógica: o histórico continua.
- **Precisão:** quantidades com 3 casas e custo por unidade com 4 casas (1 L por R$ 47 = R$ 0,047/ml).
- **Permissões (9.2):** admin e gerente cuidam do estoque. O funcionário só ajusta o consumo dos próprios atendimentos e não vê custos.

## Rotas novas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| GET/POST /admin/estoque/produtos, PATCH/DELETE /admin/estoque/produtos/:id | estoque:ver / estoque:editar | RF38 |
| POST /admin/estoque/movimentos | estoque:editar | RF39, RF42 |
| GET /admin/estoque/produtos/:id/movimentos | estoque:ver | RF39 |
| GET /admin/estoque/alertas | estoque:ver | RF41 |
| GET/PUT /admin/servicos/:id/ficha | servicos:gerenciar | RF14, RF15 |
| GET /admin/agenda/:id/consumo, GET /staff/agenda/:id/consumo | agenda (o funcionário só os próprios) | RF40 |
| PATCH .../status com `consumo` | agenda | RF40 |

## Testes

`src/modules/estoque/fase7.int.test.ts`:
- permissões de gerente e funcionário, SKU repetido;
- custo médio ponderado, saída maior que o saldo, motivo obrigatório, inventário;
- histórico imutável e 12 saídas simultâneas;
- custo e margem, produto em uso que não pode ser removido;
- baixa ao concluir, ajuste pela profissional, conclusão em dobro;
- alerta de mínimo (uma vez) e alerta de validade.

## Ficou para depois

- **Estornar a baixa** se um atendimento concluído for desfeito: hoje concluído não volta atrás, então não há o que estornar.
- **Relatórios de consumo e perdas por período (RF51):** entram na Fase 10.
