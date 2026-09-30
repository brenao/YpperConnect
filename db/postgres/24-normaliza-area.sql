-- =====================================================================
-- 24 - Normalizacao da area demandante
--
-- `area_demandante` e texto livre, digitado a cada projeto. Em pouco
-- tempo a mesma area vira varias: "Comercial", "comercial", "COMERCIAL",
-- "Comercial " com espaco no fim. Nenhuma delas esta errada para quem
-- digitou, e todas quebram qualquer agrupamento — filtro, contagem por
-- area, grafico de demanda por departamento.
--
-- O PROBLEMA APARECEU AO CRIAR O FILTRO por area na tela de projetos: a
-- lista de opcoes mostraria a mesma area tres vezes, e escolher uma
-- delas esconderia os projetos das outras duas.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Tira espacos das pontas e colapsa espacos repetidos do meio.
--   2. Unifica as variantes de caixa na grafia MAIS USADA. Se existem
--      sete "Comercial" e dois "COMERCIAL", todos viram "Comercial" —
--      a maioria costuma ser quem digitou com cuidado, e escolher a
--      primeira alfabeticamente daria "COMERCIAL" sem motivo.
--
-- O QUE ELA NAO FAZ
--   Nao cria cadastro de areas. Seria o certo a prazo, e e o caminho
--   que "fornecedores" seguiu, mas area demandante tem cauda longa —
--   aparecem nomes de setores que nao estao em lista nenhuma — e um
--   cadastro fechado faria a pessoa escolher "Outros" e perder a
--   informacao. A normalizacao no INSERT, somada a sugestao dos valores
--   ja usados no formulario, resolve sem travar ninguem.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/24-normaliza-area.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Espacos
-- ---------------------------------------------------------------------

UPDATE projetos
   SET area_demandante = NULLIF(REGEXP_REPLACE(TRIM(area_demandante), '\s+', ' ', 'g'), '')
 WHERE area_demandante IS NOT NULL
   AND area_demandante IS DISTINCT FROM
       NULLIF(REGEXP_REPLACE(TRIM(area_demandante), '\s+', ' ', 'g'), '');

-- ---------------------------------------------------------------------
-- 2. Caixa: cada grupo adota a grafia mais frequente
--
-- O desempate por `MIN(area_demandante)` existe para o caso de empate
-- em quantidade: sem ele, o resultado dependeria da ordem em que o
-- Postgres devolveu as linhas, e rodar a migration duas vezes poderia
-- dar respostas diferentes.
-- ---------------------------------------------------------------------

WITH variantes AS (
    SELECT LOWER(area_demandante) AS normalizada,
           area_demandante        AS grafia,
           COUNT(*)               AS vezes
      FROM projetos
     WHERE area_demandante IS NOT NULL
     GROUP BY LOWER(area_demandante), area_demandante
),
vencedora AS (
    SELECT DISTINCT ON (normalizada) normalizada, grafia
      FROM variantes
     ORDER BY normalizada, vezes DESC, grafia
)
UPDATE projetos p
   SET area_demandante = v.grafia
  FROM vencedora v
 WHERE LOWER(p.area_demandante) = v.normalizada
   AND p.area_demandante IS DISTINCT FROM v.grafia;

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('24-normaliza-area.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;

-- ---------------------------------------------------------------------
-- Conferencia: nao deve sobrar mais de uma grafia por area
--
--   SELECT LOWER(area_demandante) AS area, COUNT(DISTINCT area_demandante) AS grafias
--     FROM projetos WHERE area_demandante IS NOT NULL
--    GROUP BY LOWER(area_demandante) HAVING COUNT(DISTINCT area_demandante) > 1;
--
-- Vazio e o resultado esperado.
-- ---------------------------------------------------------------------