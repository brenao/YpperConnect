-- ---------------------------------------------------------------------
-- 12 - rotinas_url: prefixo /ypper/ -> /beagleone/ (2026-09-14)
--
-- O pg_cron chama o app pela URL guardada em cron_config.rotinas_url
-- (ver 06-agendador.sql). Essa URL tem o prefixo de publicacao dentro.
-- Em 2026-09-14 o teste (rosset29) passou de /ypper/ para /beagleone/,
-- igual a producao; a URL no banco precisa acompanhar, senao a rotina
-- diaria bate em /ypper/api/rotinas, o app redireciona para
-- /beagleone/ypper/api/rotinas e a resposta e 404 -- sem erro no cron,
-- so rotina que nunca roda.
--
-- Vale para rosset96 (teste) e rosset97 (producao): o valor final e o
-- mesmo nos dois. Idempotente: so altera se ainda houver /ypper/ no
-- valor; rodar duas vezes nao muda nada.
--
-- APLICAR (como superusuario -- a tabela e do postgres, nao do ypper):
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     < 12-rotinas-url-beagleone.sql
--
-- CONFERIR:
--   SELECT chave, valor FROM cron_config WHERE chave = 'rotinas_url';
-- ---------------------------------------------------------------------

DO $$
DECLARE
  antes text;
BEGIN
  IF current_database() <> 'ypper' THEN
    RAISE EXCEPTION 'Banco atual e "%", esperado "ypper". Abortado.', current_database();
  END IF;
  IF to_regclass('public.cron_config') IS NULL THEN
    RAISE NOTICE 'cron_config nao existe neste banco: o 06-agendador.sql nao foi aplicado. Nada a fazer.';
    RETURN;
  END IF;

  SELECT valor INTO antes FROM cron_config WHERE chave = 'rotinas_url';

  IF antes IS NULL THEN
    RAISE NOTICE 'rotinas_url nao esta em cron_config. Nada a fazer.';
  ELSIF antes LIKE '%/ypper/api/rotinas%' THEN
    UPDATE cron_config
       SET valor = replace(valor, '/ypper/api/rotinas', '/beagleone/api/rotinas')
     WHERE chave = 'rotinas_url';
    RAISE NOTICE 'rotinas_url: % -> %', antes, replace(antes, '/ypper/api/rotinas', '/beagleone/api/rotinas');
  ELSE
    RAISE NOTICE 'rotinas_url ja esta sem /ypper/: %. Nada a fazer.', antes;
  END IF;
END $$;
