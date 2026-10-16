# Fase 10: relatórios

Requisitos: **RF47–RF55**, seções **9.1** (reautenticação), **9.2** (cada um vê só o que pode), **9.5** (limites) e **9.7** (auditoria).

## Como usar

**Painel → Relatórios.** Escolha o relatório, o período (este mês, mês passado, últimos 7/30/90 dias, este ano ou personalizado, até 366 dias) e, quando fizer sentido, um profissional. Cada relatório mostra os números principais, gráficos (com botão para ver como tabela) e tabelas detalhadas.

| Relatório | Requisito | O que mostra |
| --- | --- | --- |
| Faturamento | RF47 | Concluídos + sinais retidos; por dia (ou mês), por forma de pagamento, serviço e profissional; ticket médio |
| Sinais | RF48 | Recebido via Pix, retido, devolvido, devolução pendente, não pagos; lista das cobranças |
| Ocupação | RF49 | Horas agendadas ÷ horas disponíveis (jornada − exceções − bloqueios); mapa dia da semana × hora; horas perdidas com faltas |
| Serviços | RF50 | Receita, custo dos produtos (ficha técnica), comissão e margem de cada serviço |
| Estoque | RF51 | Valor em estoque hoje, consumo e perdas no período (R$ e quantidade), posição e alertas |
| Clientes | RF52 | Atendidos, novos × recorrentes, ticket médio, taxa de faltas, os 20 que mais gastaram |
| Fidelidade | RF53 | Pontos emitidos, trocados, vencidos, estornados, saldo em aberto; recompensas mais trocadas |
| Comissões | RF54 | Comissão por profissional; filtrando uma pessoa, o extrato atendimento a atendimento |

**Exportar (RF55):** botões **CSV** (abre direto no Excel em português: `;`, vírgula decimal, acentos) e **PDF** (A4, com cabeçalho repetido a cada página e numeração).

## O que mudou em outras telas

- **Concluir atendimento** agora pergunta **como o cliente pagou** o restante (Pix, dinheiro, crédito, débito, outro; opcional). O sinal pago por Pix entra separado. Na agenda, o concluído mostra "pago com …".
- **Serviços → Quem faz este serviço:** novo campo **comissão (%)** por profissional. Em branco = comissão padrão do profissional (Equipe).
- A **comissão é calculada e congelada ao concluir** (RF54): mudar o % depois não reescreve o passado. Atendimentos concluídos antes desta fase usam o % atual.

## Profissional

Quem tem perfil de funcionário vê **Relatórios** com só três abas: faturamento, ocupação e comissões, **sempre os dele**. A API ignora qualquer `funcionarioId` enviado e recusa os outros relatórios (403).

## Segurança

- **9.1:** exportar pede a senha (e o 2FA, se ativo) de novo, como as outras ações críticas.
- **9.7:** toda exportação grava `RELATORIO_EXPORTADO` na auditoria (quem, tipo, formato, período, filtro).
- **Injeção de fórmula no CSV:** nomes de cliente, serviço ou produto que começam com `= + - @` (ou tab) saem com um `'` na frente, para o Excel não executar (testado com `=HYPERLINK(...)`).
- **9.5:** período máximo de 366 dias; 120 consultas por minuto por usuário; 20 exportações a cada 10 minutos.
- O arquivo vai com `Cache-Control: no-store` e nome sem caracteres especiais.
- Relatórios só leem o banco; nada é alterado.

## Banco

Migration `20261014200000_relatorios`:
- `agendamentos.forma_pagamento` (enum), `comissao_centavos` (≥ 0) e `concluido_em`.
- `servicos_funcionarios.comissao_pct` (0 a 100, opcional).

## Testes

`relatorios/fase10.int.test.ts` (18) e `relatorios/intervalos.test.ts` (5): valores de cada relatório num cenário montado à mão, comissão congelada, filtro do profissional, bloqueios na ocupação, validação do período, 403/401, reautenticação, auditoria, CSV (BOM, formato, fórmula neutralizada) e PDF de uma página.
