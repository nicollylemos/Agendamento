-- Fase 7: estoque e ficha técnica (RF14, RF15, RF38–RF42)

CREATE TYPE "UnidadeProduto" AS ENUM ('ML', 'G', 'UN');
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA', 'CONSUMO');

-- Fluxo 6.3: custo do atendimento registrado ao concluir
ALTER TABLE "agendamentos" ADD COLUMN "custo_centavos" INTEGER;

-- RF38
CREATE TABLE "produtos" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "sku" TEXT,
    "categoria" TEXT,
    "unidade" "UnidadeProduto" NOT NULL,
    "custo_medio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "estoque_atual" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "estoque_minimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "fornecedor" TEXT,
    "validade" DATE,
    "alerta_minimo_em" TIMESTAMP(3),
    "alerta_validade_em" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "produtos_sku_key" ON "produtos"("sku");
CREATE INDEX "produtos_ativo_deleted_at_idx" ON "produtos"("ativo", "deleted_at");

-- RF39 (só inserção)
CREATE TABLE "movimentacoes_estoque" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "saldo_apos" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT,
    "usuario_id" UUID,
    "agendamento_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimentacoes_estoque_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "movimentacoes_estoque_produto_id_created_at_idx" ON "movimentacoes_estoque"("produto_id", "created_at");
CREATE INDEX "movimentacoes_estoque_agendamento_id_idx" ON "movimentacoes_estoque"("agendamento_id");
CREATE INDEX "movimentacoes_estoque_tipo_created_at_idx" ON "movimentacoes_estoque"("tipo", "created_at");
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_agendamento_id_fkey"
  FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RF14
CREATE TABLE "fichas_tecnicas" (
    "servico_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    CONSTRAINT "fichas_tecnicas_pkey" PRIMARY KEY ("servico_id", "produto_id")
);
ALTER TABLE "fichas_tecnicas" ADD CONSTRAINT "fichas_tecnicas_servico_id_fkey"
  FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fichas_tecnicas" ADD CONSTRAINT "fichas_tecnicas_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "custos_extras_servico" (
    "id" UUID NOT NULL,
    "servico_id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    CONSTRAINT "custos_extras_servico_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "custos_extras_servico_servico_id_idx" ON "custos_extras_servico"("servico_id");
ALTER TABLE "custos_extras_servico" ADD CONSTRAINT "custos_extras_servico_servico_id_fkey"
  FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RF39: o histórico de estoque não pode ser editado nem apagado, nem por engano no código (9.7)
CREATE OR REPLACE FUNCTION bloquear_alteracao_movimentacao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'movimentacoes_estoque é só de inserção';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER movimentacoes_estoque_so_insercao
  BEFORE UPDATE OR DELETE ON "movimentacoes_estoque"
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_movimentacao();
