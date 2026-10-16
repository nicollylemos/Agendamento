-- Posts para o Instagram (montados no painel)
ALTER TYPE "FinalidadeArquivo" ADD VALUE 'POST';

CREATE TYPE "FormatoPost" AS ENUM ('QUADRADO', 'RETRATO', 'STORY');
CREATE TYPE "StatusPost" AS ENUM ('RASCUNHO', 'PRONTO', 'PUBLICADO');

CREATE TABLE "posts_instagram" (
    "id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "formato" "FormatoPost" NOT NULL DEFAULT 'RETRATO',
    "conteudo" JSONB NOT NULL,
    "legenda" TEXT NOT NULL DEFAULT '',
    "status" "StatusPost" NOT NULL DEFAULT 'RASCUNHO',
    "agendado_para" DATE,
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "posts_instagram_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "posts_instagram_legenda_tamanho" CHECK (char_length("legenda") <= 2200)
);

CREATE INDEX "posts_instagram_status_agendado_para_idx" ON "posts_instagram"("status", "agendado_para");
