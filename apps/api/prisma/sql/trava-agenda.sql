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
