-- Fase 9: personalização, landing page e imagens (RF07–RF11, 9.4)

CREATE TYPE "FinalidadeArquivo" AS ENUM ('LOGO', 'BANNER', 'SERVICO', 'EQUIPE', 'GALERIA');

-- RF07: campos extras do formulário
ALTER TABLE "agendamentos" ADD COLUMN "respostas_extras" JSONB;

CREATE TABLE "arquivos" (
    "id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalidade" "FinalidadeArquivo" NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arquivos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "arquivos_chave_key" ON "arquivos"("chave");
CREATE INDEX "arquivos_finalidade_created_at_idx" ON "arquivos"("finalidade", "created_at");

CREATE TABLE "personalizacao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rascunho" JSONB NOT NULL,
    "publicado" JSONB,
    "publicado_em" TIMESTAMP(3),
    "publicado_por" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personalizacao_pkey" PRIMARY KEY ("id")
);
