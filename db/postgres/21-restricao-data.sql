-- =====================================================================
-- 21 - Restricao de data na tarefa
--
-- O reagendamento tratava a data gravada da tarefa como ancora de "nao
-- antes de": ela nunca era puxada para tras, so empurrada para frente
-- pelas predecessoras. Isso produzia um bug visivel: trocar uma
-- dependencia de TI para II nao movia nada, porque a data antiga —
-- posta ali pela propria dependencia TI — continuava segurando a
-- tarefa. So quando a restricao nova era MAIS apertada que a ancora a
-- tarefa se mexia.
--
-- A correcao e separar duas coisas que estavam na mesma coluna:
--
--   `inicio`           onde a tarefa esta, resultado do calculo
--   `restricao_inicio` onde alguem decidiu que ela nao pode comecar
--                      antes, por decisao humana
--
-- Sem restricao, a tarefa e ASAP: vai para a primeira data que as
-- dependencias permitem, para frente OU para tras. E o comportamento
-- do MS Project, do Primavera e do Smartsheet, e e o que um gerente
-- vindo de qualquer um deles espera.
--
-- Com restricao, ela respeita a data fixada. E o equivalente ao "Nao
-- iniciar antes de" do Project, e e o que permite segurar uma tarefa
-- numa data combinada com fornecedor sem que o cronograma a puxe de
-- volta na proxima passada.
--
-- A coluna nasce NULA em tudo: nenhuma tarefa existente tem restricao,
-- e todas passam a ser ASAP. Cronograma que dependia da ancora antiga
-- pode encurtar ao aplicar esta migration — o que e a correcao, nao um
-- efeito colateral: as datas voltam para onde as dependencias mandam.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/21-restricao-data.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

ALTER TABLE projeto_tarefas
    ADD COLUMN IF NOT EXISTS restricao_inicio DATE;

COMMENT ON COLUMN projeto_tarefas.restricao_inicio IS
    'Data fixada por decisao humana: a tarefa nao comeca antes dela. '
    'Nula = ASAP, a tarefa vai para a primeira data que as dependencias permitem.';

INSERT INTO db_migrations (arquivo) VALUES ('21-restricao-data.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;