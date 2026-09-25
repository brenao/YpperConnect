-- =====================================================================
-- 20 - Tipo e defasagem das dependencias
--
-- `tarefa_predecessoras` guardava so o par (tarefa, predecessora), e o
-- cronograma tratava toda aresta como termino-inicio: a sucessora
-- comeca no dia util seguinte ao termino da anterior.
--
-- TI cobre a maioria dos casos, mas nao todos. Duas tarefas que comecam
-- juntas — desenho e especificacao, por exemplo — sao inicio-inicio, e
-- hoje a unica forma de representa-las era nao declarar vinculo nenhum,
-- perdendo a dependencia no CPM e no reagendamento.
--
-- OS QUATRO TIPOS
--   TI  termino-inicio   a sucessora comeca depois que a anterior acaba
--   II  inicio-inicio    as duas comecam juntas
--   TT  termino-termino  as duas terminam juntas
--   IT  inicio-termino   a sucessora acaba depois que a anterior comeca
--
-- E a nomenclatura do MS Project traduzida, e a mesma do Primavera e do
-- Smartsheet. Na pratica TI responde pela grande maioria e II por quase
-- todo o resto; TT aparece em encerramento paralelo e IT e raro a ponto
-- de o Primavera desaconselhar — entra por completude, nao por uso.
--
-- DEFASAGEM
--   Dias somados a restricao, positivos ou negativos. "TI+2" e "comeca
--   dois dias depois que a anterior terminar"; "TI-1" antecipa e cria
--   sobreposicao. Sem defasagem, metade dos casos reais de II fica sem
--   representacao: "comecam juntas, mas a segunda tres dias depois" e
--   II+3, nao TI.
--
--   A unidade segue o regime do projeto, que ja existe em
--   `projetos.usa_dias_uteis`: em dias uteis a defasagem pula fim de
--   semana e feriado, em dias corridos conta dia a dia. Uma unidade
--   propria da defasagem criaria dois calendarios no mesmo cronograma.
--
-- COMPATIBILIDADE
--   `tipo` nasce 'TI' e `defasagem` nasce 0, que e exatamente o que o
--   codigo faz hoje. Nenhum cronograma existente muda de data ao
--   aplicar esta migration.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/20-tipo-dependencia.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

ALTER TABLE tarefa_predecessoras
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(2) NOT NULL DEFAULT 'TI';

ALTER TABLE tarefa_predecessoras
    ADD COLUMN IF NOT EXISTS defasagem SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE tarefa_predecessoras DROP CONSTRAINT IF EXISTS ck_tpred_tipo;

ALTER TABLE tarefa_predecessoras
    ADD CONSTRAINT ck_tpred_tipo CHECK (tipo IN ('TI', 'II', 'TT', 'IT'));

-- Teto de um ano para cada lado. Defasagem maior que isso e quase
-- sempre erro de digitacao, e o cronograma que ela produz ninguem
-- consegue conferir.
ALTER TABLE tarefa_predecessoras DROP CONSTRAINT IF EXISTS ck_tpred_defasagem;

ALTER TABLE tarefa_predecessoras
    ADD CONSTRAINT ck_tpred_defasagem CHECK (defasagem BETWEEN -365 AND 365);

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('20-tipo-dependencia.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;