-- =====================================================================
-- 10 - Investimento (CAPEX) do projeto
--
-- O valor e opcional: boa parte dos projetos de TI e esforco interno
-- sem desembolso, e exigir um numero faria a pessoa inventar zero — que
-- depois seria somado como se fosse informacao.
--
-- A moeda e por projeto, nao da instalacao: a empresa contrata software
-- em dolar e servico em real no mesmo portfolio, e converter na entrada
-- exigiria guardar a cotacao do dia para o numero nao mudar de sentido
-- depois.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/10-capex.sql
-- =====================================================================

SET ROLE ypper;

ALTER TABLE projetos
  ADD COLUMN capex  NUMERIC(14,2),
  ADD COLUMN moeda  VARCHAR(3);

ALTER TABLE projetos
  -- Zero e valor valido: projeto aprovado com custo zero e uma
  -- informacao, diferente de "nao informado", que e NULL.
  ADD CONSTRAINT ck_projetos_capex CHECK (capex IS NULL OR capex >= 0),
  ADD CONSTRAINT ck_projetos_moeda CHECK (moeda IS NULL OR moeda IN ('BRL','USD')),
  -- Valor sem moeda nao significa nada: R$ 500 mil e US$ 500 mil sao
  -- decisoes diferentes, e o banco nao pode aceitar o numero solto.
  ADD CONSTRAINT ck_projetos_capex_moeda CHECK (capex IS NULL OR moeda IS NOT NULL);

INSERT INTO db_migrations (arquivo) VALUES ('10-capex.sql')
ON CONFLICT (arquivo) DO NOTHING;

RESET ROLE;