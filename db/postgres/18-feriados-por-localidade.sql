-- =====================================================================
-- 18 - Feriados por localidade: correcoes da migration 16
--
-- Tres ajustes, todos consequencia de eu ter escrito a 16 sem olhar o
-- 07-feriados.sql primeiro:
--
--   1. `abrangencia` duplicava `tipo`, que ja existia e ja aceitava
--      nacional/estadual/municipal. Duas colunas para a mesma verdade
--      divergem na primeira vez que alguem edita so uma.
--
--   2. O UNIQUE em `data_feriado` impede duas cidades de terem feriado
--      no mesmo dia — que e exatamente o caso que esta funcionalidade
--      veio resolver. 20 de janeiro e feriado no Rio e dia util em Sao
--      Paulo.
--
--   3. As colunas geradas `dia` e `mes` ja existiam desde o 01-schema.
--      Os ALTER da 16 foram pulados pelo IF NOT EXISTS e nao fizeram
--      nada; nao ha o que desfazer, fica so o registro.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/18-feriados-por-localidade.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. `tipo` volta a ser a unica fonte da abrangencia
--
-- Quem ja tinha `abrangencia` preenchida (so o dev, onde a 16 rodou)
-- tem o valor copiado para `tipo` antes da coluna sair. Os nomes
-- diferem: 'regional' virou 'estadual', que e como o 01-schema chama.
-- ---------------------------------------------------------------------

UPDATE feriados
   SET tipo = CASE abrangencia
                WHEN 'regional' THEN 'estadual'
                WHEN 'local' THEN 'municipal'
                ELSE 'nacional'
              END
 WHERE abrangencia IS NOT NULL
   AND tipo = 'nacional'
   AND abrangencia <> 'nacional';

ALTER TABLE feriados DROP CONSTRAINT IF EXISTS ck_feriados_abrangencia;
ALTER TABLE feriados DROP CONSTRAINT IF EXISTS ck_feriados_localidade;
ALTER TABLE feriados DROP COLUMN IF EXISTS abrangencia;

-- Nacional vale para todos e por isso nao tem localidade. Estadual e
-- municipal precisam de uma: sem ela nao ha como saber a quem se
-- aplicam, e o feriado viraria nacional na pratica.
ALTER TABLE feriados
    ADD CONSTRAINT ck_feriados_localidade CHECK (
        (tipo = 'nacional' AND localidade_id IS NULL)
        OR (tipo <> 'nacional' AND localidade_id IS NOT NULL)
    );

-- ---------------------------------------------------------------------
-- 2. Unicidade por data E localidade
--
-- O nome da constraint antiga pode variar conforme o 01-schema a
-- declarou; o bloco cobre as duas formas usuais sem falhar se nenhuma
-- existir.
-- ---------------------------------------------------------------------

ALTER TABLE feriados DROP CONSTRAINT IF EXISTS uq_feriados_data;
ALTER TABLE feriados DROP CONSTRAINT IF EXISTS feriados_data_feriado_key;
DROP INDEX IF EXISTS ux_feriados_data;

-- Nacional: uma linha por data, localidade nula. Indice parcial porque
-- NULL nao se compara a NULL num UNIQUE comum, e duas linhas nacionais
-- na mesma data passariam.
CREATE UNIQUE INDEX IF NOT EXISTS ux_feriados_nacional_data
    ON feriados (data_feriado) WHERE localidade_id IS NULL;

-- Regional e municipal: uma linha por data e localidade.
CREATE UNIQUE INDEX IF NOT EXISTS ux_feriados_local_data
    ON feriados (localidade_id, data_feriado) WHERE localidade_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('18-feriados-por-localidade.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;