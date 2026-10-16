-- Fase 8: fidelidade (RF43–RF46)

CREATE TYPE "TipoPrograma" AS ENUM ('PONTOS', 'SELOS');
CREATE TYPE "TipoRecompensa" AS ENUM ('DESCONTO', 'SERVICO', 'PRODUTO');
CREATE TYPE "TipoTransacaoFidelidade" AS ENUM ('CREDITO', 'ESTORNO', 'RESGATE', 'DEVOLUCAO', 'AJUSTE', 'EXPIRACAO');
CREATE TYPE "StatusResgate" AS ENUM ('DISPONIVEL', 'USADO', 'CANCELADO', 'EXPIRADO');

-- RF43
CREATE TABLE "programa_fidelidade" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "tipo" "TipoPrograma" NOT NULL DEFAULT 'PONTOS',
    "pontos_por_real" INTEGER NOT NULL DEFAULT 1,
    "pontos_por_atendimento" INTEGER NOT NULL DEFAULT 0,
    "servicos_elegiveis" UUID[] DEFAULT ARRAY[]::UUID[],
    "validade_dias" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "programa_fidelidade_pkey" PRIMARY KEY ("id")
);

-- RF44
CREATE TABLE "recompensas" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoRecompensa" NOT NULL,
    "custo_pontos" INTEGER NOT NULL,
    "valor_centavos" INTEGER,
    "servico_id" UUID,
    "validade_dias" INTEGER NOT NULL DEFAULT 30,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recompensas_pkey" PRIMARY KEY ("id")
);

-- RF45, RF46
CREATE TABLE "transacoes_fidelidade" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "tipo" "TipoTransacaoFidelidade" NOT NULL,
    "pontos" INTEGER NOT NULL,
    "disponivel" INTEGER NOT NULL DEFAULT 0,
    "expira_em" TIMESTAMP(3),
    "agendamento_id" UUID,
    "resgate_id" UUID,
    "motivo" TEXT,
    "usuario_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transacoes_fidelidade_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transacoes_fidelidade_agendamento_id_tipo_key" ON "transacoes_fidelidade"("agendamento_id", "tipo");
CREATE INDEX "transacoes_fidelidade_cliente_id_created_at_idx" ON "transacoes_fidelidade"("cliente_id", "created_at");
CREATE INDEX "transacoes_fidelidade_expira_em_idx" ON "transacoes_fidelidade"("expira_em");
ALTER TABLE "transacoes_fidelidade" ADD CONSTRAINT "transacoes_fidelidade_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transacoes_fidelidade" ADD CONSTRAINT "transacoes_fidelidade_agendamento_id_fkey"
  FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "resgates_fidelidade" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "recompensa_id" UUID NOT NULL,
    "pontos" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "status" "StatusResgate" NOT NULL DEFAULT 'DISPONIVEL',
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "usado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resgates_fidelidade_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "resgates_fidelidade_codigo_key" ON "resgates_fidelidade"("codigo");
CREATE INDEX "resgates_fidelidade_cliente_id_status_idx" ON "resgates_fidelidade"("cliente_id", "status");
ALTER TABLE "resgates_fidelidade" ADD CONSTRAINT "resgates_fidelidade_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resgates_fidelidade" ADD CONSTRAINT "resgates_fidelidade_recompensa_id_fkey"
  FOREIGN KEY ("recompensa_id") REFERENCES "recompensas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9.7: extrato de pontos não pode ser apagado nem reescrito.
-- A única mudança aceita é o "disponivel" de um crédito diminuir (gastou ou venceu).
CREATE OR REPLACE FUNCTION proteger_extrato_fidelidade() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transacoes_fidelidade é só de inserção';
  END IF;
  IF (NEW.id, NEW.cliente_id, NEW.tipo, NEW.pontos, NEW.expira_em, NEW.agendamento_id, NEW.resgate_id, NEW.motivo, NEW.usuario_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.cliente_id, OLD.tipo, OLD.pontos, OLD.expira_em, OLD.agendamento_id, OLD.resgate_id, OLD.motivo, OLD.usuario_id, OLD.created_at)
     OR NEW.disponivel > OLD.disponivel OR NEW.disponivel < 0 THEN
    RAISE EXCEPTION 'transacoes_fidelidade: só o saldo disponível de um crédito pode diminuir';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER transacoes_fidelidade_protegida
  BEFORE UPDATE OR DELETE ON "transacoes_fidelidade"
  FOR EACH ROW EXECUTE FUNCTION proteger_extrato_fidelidade();
