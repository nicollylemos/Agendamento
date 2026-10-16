-- CreateEnum
CREATE TYPE "TipoExcecao" AS ENUM ('FOLGA', 'HORARIO_ESPECIAL');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO', 'EXPIRADO', 'NAO_COMPARECEU');

-- CreateEnum
CREATE TYPE "OrigemAgendamento" AS ENUM ('ONLINE', 'PAINEL');

-- CreateTable
CREATE TABLE "modelos_jornada" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modelos_jornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos_jornada_faixas" (
    "id" UUID NOT NULL,
    "modelo_id" UUID NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,

    CONSTRAINT "modelos_jornada_faixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jornada_faixas" (
    "id" UUID NOT NULL,
    "funcionario_id" UUID NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,

    CONSTRAINT "jornada_faixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excecoes_horario" (
    "id" UUID NOT NULL,
    "funcionario_id" UUID,
    "data" DATE NOT NULL,
    "tipo" "TipoExcecao" NOT NULL,
    "faixas" JSONB NOT NULL DEFAULT '[]',
    "motivo" TEXT,
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excecoes_horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueios" (
    "id" UUID NOT NULL,
    "funcionario_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_agenda" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "antecedencia_minima_min" INTEGER NOT NULL DEFAULT 120,
    "dias_a_frente" INTEGER NOT NULL DEFAULT 60,
    "passo_min" INTEGER NOT NULL DEFAULT 15,
    "prazo_cancelamento_horas" INTEGER NOT NULL DEFAULT 24,
    "prazo_reagendamento_horas" INTEGER NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT,
    "consentimento_lgpd_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agendamentos" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "funcionario_id" UUID NOT NULL,
    "servico_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "fim_ocupado" TIMESTAMP(3) NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'CONFIRMADO',
    "valor_centavos" INTEGER NOT NULL,
    "duracao_min" INTEGER NOT NULL,
    "limpeza_min" INTEGER NOT NULL,
    "origem" "OrigemAgendamento" NOT NULL,
    "observacao" TEXT,
    "token_gestao_hash" TEXT,
    "aceite_politica_em" TIMESTAMP(3),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_cliente" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "usado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modelos_jornada_nome_key" ON "modelos_jornada"("nome");

-- CreateIndex
CREATE INDEX "modelos_jornada_faixas_modelo_id_idx" ON "modelos_jornada_faixas"("modelo_id");

-- CreateIndex
CREATE INDEX "jornada_faixas_funcionario_id_dia_semana_idx" ON "jornada_faixas"("funcionario_id", "dia_semana");

-- CreateIndex
CREATE INDEX "excecoes_horario_data_idx" ON "excecoes_horario"("data");

-- CreateIndex
CREATE INDEX "excecoes_horario_funcionario_id_data_idx" ON "excecoes_horario"("funcionario_id", "data");

-- CreateIndex
CREATE INDEX "bloqueios_funcionario_id_inicio_idx" ON "bloqueios"("funcionario_id", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_telefone_key" ON "clientes"("telefone");

-- CreateIndex
CREATE INDEX "clientes_email_idx" ON "clientes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agendamentos_token_gestao_hash_key" ON "agendamentos"("token_gestao_hash");

-- CreateIndex
CREATE INDEX "agendamentos_funcionario_id_inicio_idx" ON "agendamentos"("funcionario_id", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_cliente_id_idx" ON "agendamentos"("cliente_id");

-- CreateIndex
CREATE INDEX "agendamentos_status_inicio_idx" ON "agendamentos"("status", "inicio");

-- CreateIndex
CREATE INDEX "codigos_cliente_email_created_at_idx" ON "codigos_cliente"("email", "created_at");

-- AddForeignKey
ALTER TABLE "modelos_jornada_faixas" ADD CONSTRAINT "modelos_jornada_faixas_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "modelos_jornada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornada_faixas" ADD CONSTRAINT "jornada_faixas_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excecoes_horario" ADD CONSTRAINT "excecoes_horario_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trava da agenda (RNF02, seção 9.9): o banco recusa dois agendamentos ativos do mesmo
-- funcionário com horários sobrepostos, mesmo com duas requisições no mesmo instante.
-- O intervalo vai do início até o fim + limpeza ("fim_ocupado"). Cancelados, expirados,
-- concluídos e faltas não ocupam a agenda.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "agendamentos"
  ADD CONSTRAINT "agendamentos_periodo_valido"
  CHECK ("fim" > "inicio" AND "fim_ocupado" >= "fim");

ALTER TABLE "agendamentos"
  ADD CONSTRAINT "agendamentos_sem_sobreposicao"
  EXCLUDE USING gist ("funcionario_id" WITH =, tsrange("inicio", "fim_ocupado", '[)') WITH &&)
  WHERE ("status" IN ('AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'EM_ATENDIMENTO'));
