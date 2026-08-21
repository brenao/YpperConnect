-- =====================================================================
-- Controle de scripts aplicados
--
-- Até aqui não havia como saber o que já tinha rodado neste banco. A
-- pergunta "o script 05 foi aplicado?" só se respondia inspecionando o
-- catálogo atrás da coluna que ele cria — e errar significava rodar de
-- novo um script não idempotente, duplicando seed ou estourando em
-- objeto já existente.
--
-- Não é um migrador de verdade: nada aqui aplica script sozinho nem
-- garante ordem. É só o registro, que é o que faltava.
--
-- COMO USAR
--   Todo script novo termina registrando a si mesmo:
--     INSERT INTO db_migrations (arquivo) VALUES ('07-alguma-coisa.sql')
--       ON CONFLICT DO NOTHING;
--
--   E antes de aplicar qualquer coisa:
--     SELECT * FROM db_migrations ORDER BY arquivo;
--
-- APLICAR (uma vez, antes dos demais):
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     -v ON_ERROR_STOP=1 < 00-migrations.sql
-- =====================================================================

SET ROLE ypper;

CREATE TABLE IF NOT EXISTS db_migrations (
  arquivo      VARCHAR(200) NOT NULL,
  aplicado_em  TIMESTAMP DEFAULT LOCALTIMESTAMP NOT NULL,
  CONSTRAINT pk_db_migrations PRIMARY KEY (arquivo)
);

-- ---------------------------------------------------------------------
-- Registro retroativo.
--
-- Estes quatro já rodaram — é deles que o banco atual nasceu. Registrar
-- agora evita que alguém, vendo a tabela vazia, conclua que precisa
-- aplicá-los de novo. O `ON CONFLICT` deixa este arquivo seguro para
-- rodar mais de uma vez.
--
-- Se o seu banco NÃO tiver algum destes aplicado, remova a linha
-- correspondente antes de executar.
-- ---------------------------------------------------------------------
INSERT INTO db_migrations (arquivo) VALUES
  ('01-schema.sql'),
  ('02-seed-calendario.sql'),
  ('03-seed-inicial.sql'),
  ('04-seed-catalogo.sql')
ON CONFLICT (arquivo) DO NOTHING;