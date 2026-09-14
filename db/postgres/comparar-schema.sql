-- ---------------------------------------------------------------------
-- comparar-schema.sql — impressao digital do schema, SO LEITURA
--
-- Serve para conferir se teste (rosset96) e producao (rosset97) tem as
-- mesmas tabelas e colunas, sem despejar o schema inteiro: uma linha
-- por tabela com o numero de colunas e um hash curto das colunas
-- (nome:tipo:nulavel, na ordem). Hash igual = tabela igual.
--
-- Rodar nos dois servidores e comparar as saidas linha a linha:
--   docker exec -i postgres-rosset psql -U postgres -d ypper -At < comparar-schema.sql
--
-- Linhas: MIG (db_migrations), EXT (extensoes), FUN (funcoes em public),
-- TAB (tabela, n colunas, hash), IDX (total de indices), CON (total de
-- constraints). Criado em 2026-09-14, quando a producao pareceu estar
-- sem os scripts da pasta db/postgres.
-- ---------------------------------------------------------------------
\set QUIET on
SELECT 'MIG ' || arquivo FROM db_migrations ORDER BY 1;
SELECT 'EXT ' || extname || ' ' || extversion FROM pg_extension WHERE extname NOT IN ('plpgsql') ORDER BY 1;
SELECT 'FUN ' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1;
SELECT 'TAB ' || c.table_name || ' ' || COUNT(*) || ' ' || LEFT(md5(STRING_AGG(c.column_name || ':' || c.data_type || ':' || c.is_nullable, ',' ORDER BY c.ordinal_position)), 8)
  FROM information_schema.columns c
 WHERE c.table_schema = 'public'
 GROUP BY c.table_name ORDER BY 1;
SELECT 'IDX ' || COUNT(*) FROM pg_indexes WHERE schemaname = 'public';
SELECT 'CON ' || COUNT(*) FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type IN ('FOREIGN KEY','UNIQUE','CHECK','PRIMARY KEY');
