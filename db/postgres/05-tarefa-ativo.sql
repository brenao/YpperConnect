-- =====================================================================
-- Desativação de tarefa em vez de exclusão
--
-- `excluirTarefa` era o único ponto do sistema que apagava linha de
-- verdade. Isso contraria a regra de que nada some, e tinha um efeito
-- colateral silencioso: a tarefa desaparecia do cronograma mas
-- continuava referenciada em `baseline_tarefas`, deixando o histórico
-- de baselines apontando para um id inexistente.
--
-- Com `ativo`, a tarefa sai da tela, para de contar no rollup e no CPM,
-- e a baseline continua íntegra.
--
-- APLICAR:
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     -v ON_ERROR_STOP=1 < 05-tarefa-ativo.sql
-- =====================================================================

SET ROLE ypper;

ALTER TABLE projeto_tarefas
  ADD COLUMN ativo SMALLINT DEFAULT 1 NOT NULL;

ALTER TABLE projeto_tarefas
  ADD CONSTRAINT ck_tarefas_ativo CHECK (ativo IN (0, 1));

-- Toda leitura de cronograma filtra por ativo; o índice existente
-- (projeto_id, ordem) passa a ser consultado sempre junto dessa coluna.
CREATE INDEX ix_tarefas_ativo ON projeto_tarefas (projeto_id, ativo);