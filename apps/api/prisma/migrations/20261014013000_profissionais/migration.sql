-- RF13: profissional deixa de depender de login. Acesso ao painel vira opcional (RF02).
-- Preserva quem já estava cadastrado: copia nome e e-mail da conta vinculada.

ALTER TABLE "funcionarios" ADD COLUMN "nome" TEXT NOT NULL DEFAULT '';
ALTER TABLE "funcionarios" ADD COLUMN "telefone" TEXT;
ALTER TABLE "funcionarios" ADD COLUMN "email" TEXT;
ALTER TABLE "funcionarios" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;

UPDATE "funcionarios" f
   SET "nome" = u."nome", "email" = u."email", "ativo" = u."ativo"
  FROM "usuarios" u
 WHERE f."usuario_id" = u."id";

ALTER TABLE "funcionarios" ALTER COLUMN "nome" DROP DEFAULT;

-- Login opcional; apagar a conta não apaga o profissional nem o histórico
ALTER TABLE "funcionarios" ALTER COLUMN "usuario_id" DROP NOT NULL;
ALTER TABLE "funcionarios" DROP CONSTRAINT "funcionarios_usuario_id_fkey";
ALTER TABLE "funcionarios" ADD CONSTRAINT "funcionarios_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
