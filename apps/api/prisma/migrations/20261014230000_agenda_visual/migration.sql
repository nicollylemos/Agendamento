-- Agenda em Mês/Semana/Dia: cores por situação (escolhidas pelo admin) e meta do mês do Início
ALTER TABLE "config_agenda"
  ADD COLUMN "cores_agenda" JSONB,
  ADD COLUMN "meta_mensal_centavos" INTEGER,
  ADD CONSTRAINT "config_agenda_meta_positiva" CHECK ("meta_mensal_centavos" IS NULL OR "meta_mensal_centavos" > 0);
