-- =====================================================================
-- Exporta os usuarios ATIVOS do GLPI no formato que o seed do BeagleOne
-- espera (db/postgres/13-seed-usuarios-glpi.sql).
--
-- RODA NO MYSQL DO GLPI, NAO NO POSTGRES. Somente leitura.
--
-- A regra de "ativo" e a mesma usada nos demais programas do Grupo
-- Rosset que leem o GLPI:
--   is_deleted = 0                        nao esta na lixeira
--   auths_id   = 1                        conta local do GLPI (nao LDAP)
--   name NOT IN ('glpi','tech','normal','post-only')
--                                         contas padrao da instalacao
--
-- Cada linha de saida e um INSERT completo, pronto para colar no seed.
-- Um INSERT por linha (em vez de um VALUES com virgulas) para nao haver
-- virgula sobrando na ultima linha nem linha quebrada no meio.
--
-- Escape: aspas simples viram duas aspas simples, que e o escape do
-- Postgres. O QUOTE() do MySQL usaria barra invertida, que o Postgres
-- (standard_conforming_strings = on) trataria como caractere comum.
--
-- O nome sai como esta no banco do GLPI, inclusive entidades HTML
-- (`&#38;` no lugar de `&`) que o GLPI 10 grava. Quem desfaz e o seed,
-- do mesmo jeito que a sincronizacao do app faz.
--
-- COMO RODAR (no servidor do GLPI):
--   mysql -N -B -u <usuario> -p <banco_do_glpi> \
--     < exportar-usuarios-ativos.sql > usuarios-glpi.sql
--
--   -N tira o cabecalho, -B tira as bordas: o arquivo fica so com os
--   INSERTs. A ultima linha e o total, comentada com `--`, para conferir
--   com o "recebidos" que o seed imprime.
-- =====================================================================

SELECT CONCAT(
         'INSERT INTO glpi_carga VALUES (',
         id, ', ',
         '''', REPLACE(name, '''', ''''''), ''', ',
         '''', REPLACE(
                 COALESCE(
                   NULLIF(TRIM(CONCAT_WS(' ',
                     NULLIF(TRIM(firstname), ''),
                     NULLIF(TRIM(realname),  ''))), ''),
                   name),
                 '''', ''''''),
         ''');'
       ) AS linha
  FROM glpi_users
 WHERE is_deleted = 0
   AND auths_id = 1
   AND name NOT IN ('glpi', 'tech', 'normal', 'post-only')
 ORDER BY id;

SELECT CONCAT('-- total exportado: ', COUNT(*)) AS linha
  FROM glpi_users
 WHERE is_deleted = 0
   AND auths_id = 1
   AND name NOT IN ('glpi', 'tech', 'normal', 'post-only');
