-- =====================================================================
-- Regime de dias do cronograma, por projeto
--
-- Dias úteis é o padrão: contar sábado e domingo como dia de trabalho
-- produz prazo que ninguém cumpre. A exceção existe para projeto com
-- gente escalada no fim de semana — virada de sistema, parada de
-- fábrica — e é escolhida na criação do projeto.
--
-- Projetos existentes nascem em dias úteis. As datas deles só se movem
-- quando alguém editar a duração de uma tarefa, momento em que o
-- término é recalculado pelo calendário.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/08-projeto-dias-uteis.sql
-- =====================================================================

SET ROLE ypper;

ALTER TABLE projetos
  ADD COLUMN usa_dias_uteis SMALLINT DEFAULT 1 NOT NULL;

ALTER TABLE projetos
  ADD CONSTRAINT ck_projetos_dias_uteis CHECK (usa_dias_uteis IN (0, 1));

INSERT INTO db_migrations (arquivo) VALUES ('08-projeto-dias-uteis.sql')
ON CONFLICT (arquivo) DO NOTHING;