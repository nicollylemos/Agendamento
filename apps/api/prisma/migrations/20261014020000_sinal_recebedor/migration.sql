-- Fase 6: sinal via Pix (RF28–RF33), recebedor (RF34–RF37) e lembretes (RF27)

-- Enums
ALTER TYPE "TipoToken" ADD VALUE 'ALERTA_RECEBEDOR';
CREATE TYPE "TipoSinal" AS ENUM ('FIXO', 'PERCENTUAL');
CREATE TYPE "ModoSinal" AS ENUM ('HERDAR', 'EXIGIR', 'NAO_EXIGIR');
CREATE TYPE "GatewayPagamento" AS ENUM ('MERCADO_PAGO', 'SIMULADO');
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'APROVADO', 'CANCELADO', 'RECEBIDO_APOS_EXPIRAR', 'REEMBOLSO_PENDENTE', 'REEMBOLSADO', 'RETIDO');
CREATE TYPE "TipoChavePix" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA');

-- RF28/RF32: regras padrão do sinal
ALTER TABLE "config_agenda"
  ADD COLUMN "sinal_exige" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sinal_tipo" "TipoSinal" NOT NULL DEFAULT 'PERCENTUAL',
  ADD COLUMN "sinal_valor" INTEGER NOT NULL DEFAULT 3000,
  ADD COLUMN "sinal_prazo_min" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "reembolso_ate_horas" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "reembolso_automatico_apos_expirar" BOOLEAN NOT NULL DEFAULT true;

-- RF28: sinal por serviço
ALTER TABLE "servicos"
  ADD COLUMN "sinal_modo" "ModoSinal" NOT NULL DEFAULT 'HERDAR',
  ADD COLUMN "sinal_tipo" "TipoSinal",
  ADD COLUMN "sinal_valor" INTEGER,
  ADD COLUMN "sinal_prazo_min" INTEGER;

-- Sinal e lembretes no agendamento
ALTER TABLE "agendamentos"
  ADD COLUMN "sinal_centavos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expira_sinal_em" TIMESTAMP(3),
  ADD COLUMN "lembrete_24h_em" TIMESTAMP(3),
  ADD COLUMN "lembrete_2h_em" TIMESTAMP(3);

-- RF29–RF33
CREATE TABLE "pagamentos" (
    "id" UUID NOT NULL,
    "agendamento_id" UUID NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "gateway" "GatewayPagamento" NOT NULL,
    "gateway_payment_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "pix_copia_e_cola" TEXT,
    "pix_qr_base64" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "pago_em" TIMESTAMP(3),
    "valor_pago_centavos" INTEGER,
    "reembolsado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pagamentos_gateway_payment_id_key" ON "pagamentos"("gateway_payment_id");
CREATE UNIQUE INDEX "pagamentos_idempotency_key_key" ON "pagamentos"("idempotency_key");
CREATE INDEX "pagamentos_agendamento_id_idx" ON "pagamentos"("agendamento_id");
CREATE INDEX "pagamentos_status_expira_em_idx" ON "pagamentos"("status", "expira_em");
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_agendamento_id_fkey"
  FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9.3: idempotência do webhook
CREATE TABLE "webhook_eventos" (
    "id" UUID NOT NULL,
    "gateway" "GatewayPagamento" NOT NULL,
    "evento_id" TEXT NOT NULL,
    "gateway_payment_id" TEXT,
    "tipo" TEXT,
    "resultado" TEXT,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMP(3),
    CONSTRAINT "webhook_eventos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_eventos_gateway_evento_id_key" ON "webhook_eventos"("gateway", "evento_id");

-- RF34–RF37 (dados sensíveis cifrados pela aplicação)
CREATE TABLE "recebedor" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nome" TEXT NOT NULL,
    "documento_cifrado" TEXT NOT NULL,
    "tipo_chave" "TipoChavePix" NOT NULL,
    "chave_cifrada" TEXT NOT NULL,
    "banco" TEXT,
    "gateway" "GatewayPagamento" NOT NULL,
    "token_gateway_cifrado" TEXT,
    "segredo_webhook_cifrado" TEXT,
    "final_documento" TEXT NOT NULL,
    "final_chave" TEXT NOT NULL,
    "final_token" TEXT,
    "final_segredo" TEXT,
    "testado_em" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "alterado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recebedor_pkey" PRIMARY KEY ("id")
);
