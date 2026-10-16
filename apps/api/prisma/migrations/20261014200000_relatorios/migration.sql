-- Fase 10: relatórios (RF47–RF55)

-- RF47: forma de pagamento do restante, informada ao concluir
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'OUTRO');

ALTER TABLE "agendamentos"
  ADD COLUMN "forma_pagamento" "FormaPagamento",
  -- RF54: comissão calculada e congelada ao concluir (mudar o % depois não reescreve o passado)
  ADD COLUMN "comissao_centavos" INTEGER,
  ADD COLUMN "concluido_em" TIMESTAMP(3),
  ADD CONSTRAINT "agendamentos_comissao_nao_negativa" CHECK ("comissao_centavos" IS NULL OR "comissao_centavos" >= 0);

-- RF54: comissão por serviço e profissional (sobrepõe a padrão)
ALTER TABLE "servicos_funcionarios"
  ADD COLUMN "comissao_pct" DECIMAL(5,2),
  ADD CONSTRAINT "servicos_funcionarios_comissao_faixa" CHECK ("comissao_pct" IS NULL OR ("comissao_pct" >= 0 AND "comissao_pct" <= 100));
