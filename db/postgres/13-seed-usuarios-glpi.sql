-- =====================================================================
-- 13 - Carga inicial dos usuarios ativos do GLPI (2026-09-15)
--
-- SEED INICIAL, UMA VEZ SO. Depois disso quem mantem a lista e o app:
-- o cadastro automatico no primeiro login e a sincronizacao periodica
-- (`sincronizarUsuariosGlpi`). Se ja estiver registrado em
-- db_migrations, este script nao faz nada e avisa.
--
-- POR QUE UM SEED SE O APP JA SINCRONIZA
--   Em producao (rosset97) o 06-agendador.sql nao foi aplicado, entao a
--   sincronizacao nao roda sozinha. Sem carga inicial, o seletor de
--   gerente/patrocinador/recurso so mostra quem ja entrou no sistema
--   pelo menos uma vez. A carga poe a empresa inteira la de uma vez.
--
-- DE ONDE VEM A LISTA
--   Do MySQL do GLPI, pela regra dos demais programas do grupo:
--     is_deleted = 0 AND auths_id = 1
--     AND name NOT IN ('glpi','tech','normal','post-only')
--   O db/glpi/exportar-usuarios-ativos.sql gera as linhas; elas entram
--   entre as marcas INICIO/FIM DA CARGA, abaixo.
--
-- O QUE FAZ (a mesma ordem do `incorporarUsuarioGlpi` do app, para a
-- carga deixar cada pessoa igual a como a sincronizacao deixaria):
--   1. Ja sincronizada (mesmo glpi_user_id, origem glpi): atualiza nome
--      e login, reativa.
--   2. Existe pelo login (cadastro manual/AD): so anexa o glpi_user_id.
--      Nao mexe em nome, e-mail, perfil nem equipe.
--   3. Nao existe: cria com origem 'glpi', sem perfil, sem e-mail.
--   4. Quem tem origem 'glpi' e NAO esta na carga: ativo = 0.
--
-- POR QUE DESATIVAR EM VEZ DE APAGAR
--   projetos.gerente_id, projetos.sponsor_id e recursos.usuario_id
--   apontam para usuarios(id). DELETE quebraria o historico de quem foi
--   gerente do que. Cadastro manual/AD nunca e desativado por aqui —
--   o GLPI nao e a fonte desses.
--
-- APLICAR (producao, como superusuario, tudo ou nada):
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     -v ON_ERROR_STOP=1 --single-transaction < 13-seed-usuarios-glpi.sql
--   ou, do repositorio:
--   node --env-file=.env db/run-sql.mjs db/postgres/13-seed-usuarios-glpi.sql
--
-- CONFERIR:
--   SELECT origem, ativo, COUNT(*) FROM usuarios GROUP BY 1, 2 ORDER BY 1, 2;
--   SELECT * FROM db_migrations WHERE arquivo = '13-seed-usuarios-glpi.sql';
-- =====================================================================

SET ROLE ypper;

-- Tabela de passagem: vive so nesta sessao, some sozinha ao desconectar.
CREATE TEMP TABLE glpi_carga (
  glpi_id  INTEGER      NOT NULL,
  login    VARCHAR(120) NOT NULL,
  nome     VARCHAR(200) NOT NULL,
  CONSTRAINT pk_glpi_carga PRIMARY KEY (glpi_id)
);

-- >>> INICIO DA CARGA — colar aqui a saida do db/glpi/exportar-usuarios-ativos.sql
-- INSERT INTO glpi_carga VALUES (123, 'fulano', 'Fulano da Silva');
-- <<< FIM DA CARGA

DO $$
DECLARE
  recebidos    integer;
  atualizados  integer;
  vinculados   integer;
  criados      integer;
  desativados  integer;
  duplicados   text;
BEGIN
  -- ------------------------------------------------------------------
  -- Guardas: banco certo, migracao 11 aplicada, carga colada, uma vez so.
  -- ------------------------------------------------------------------
  IF current_database() <> 'ypper' THEN
    RAISE EXCEPTION 'Banco atual e "%", esperado "ypper". Abortado.', current_database();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'usuarios' AND column_name = 'glpi_user_id') THEN
    RAISE EXCEPTION 'usuarios.glpi_user_id nao existe: aplique o 11-glpi-usuarios.sql antes.';
  END IF;

  IF EXISTS (SELECT 1 FROM db_migrations WHERE arquivo = '13-seed-usuarios-glpi.sql') THEN
    RAISE NOTICE '13-seed-usuarios-glpi.sql ja foi aplicado neste banco. Nada a fazer.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO recebidos FROM glpi_carga;
  IF recebidos = 0 THEN
    RAISE EXCEPTION 'glpi_carga esta vazia: a saida do exportar-usuarios-ativos.sql nao foi colada entre INICIO/FIM DA CARGA.';
  END IF;

  -- ------------------------------------------------------------------
  -- Normaliza como o app faz: tira espacos e desfaz as entidades HTML
  -- que o GLPI 10 grava (`A &#38; N` -> `A & N`). Sao as cinco do
  -- Sanitizer do GLPI mais as formas com nome; `&amp;` por ultimo, para
  -- `&amp;lt;` virar `&lt;` e nao `<`.
  -- ------------------------------------------------------------------
  UPDATE glpi_carga
     SET login = TRIM(login),
         nome  = COALESCE(NULLIF(TRIM(
                   REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                   REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(nome,
                     '&#38;', '&'), '&#34;', '"'), '&#39;', ''''), '&#60;', '<'), '&#62;', '>'),
                     '&quot;', '"'), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
                 ), ''), TRIM(login));

  IF EXISTS (SELECT 1 FROM glpi_carga WHERE login = '') THEN
    RAISE EXCEPTION 'Ha linha na carga com login vazio. Abortado.';
  END IF;

  -- ------------------------------------------------------------------
  -- Pre-checagem do passo 2: se DOIS cadastros locais sem glpi_user_id
  -- normalizam para o mesmo login (ex.: `ROSSET\breno` e `breno`), o
  -- vinculo em lote tentaria dar o mesmo glpi_user_id aos dois e
  -- estouraria uq_usuarios_glpi. Melhor parar antes e dizer quais sao.
  -- ------------------------------------------------------------------
  SELECT STRING_AGG(l, ', ') INTO duplicados
    FROM (SELECT LOWER(REGEXP_REPLACE(u.login, '^.*\\', '')) AS l
            FROM usuarios u
           WHERE u.glpi_user_id IS NULL
             AND LOWER(REGEXP_REPLACE(u.login, '^.*\\', ''))
                 IN (SELECT LOWER(login) FROM glpi_carga)
           GROUP BY 1
          HAVING COUNT(*) > 1) d;
  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'Mais de um cadastro local para o mesmo login (%). Resolva a mao antes de rodar a carga.', duplicados;
  END IF;

  -- ------------------------------------------------------------------
  -- 1. Ja conhecida pelo id do GLPI: o GLPI e a fonte de nome e login.
  -- ------------------------------------------------------------------
  UPDATE usuarios u
     SET nome            = c.nome,
         login           = c.login,
         ativo           = 1,
         sincronizado_em = LOCALTIMESTAMP,
         atualizado_em   = LOCALTIMESTAMP
    FROM glpi_carga c
   WHERE u.glpi_user_id = c.glpi_id
     AND u.origem = 'glpi';
  GET DIAGNOSTICS atualizados = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 2. Existe pelo login (sem dominio): so anexa a chave do GLPI.
  -- ------------------------------------------------------------------
  UPDATE usuarios u
     SET glpi_user_id    = c.glpi_id,
         sincronizado_em = LOCALTIMESTAMP,
         atualizado_em   = LOCALTIMESTAMP
    FROM glpi_carga c
   WHERE u.glpi_user_id IS NULL
     AND LOWER(REGEXP_REPLACE(u.login, '^.*\\', '')) = LOWER(c.login)
     AND NOT EXISTS (SELECT 1 FROM usuarios x WHERE x.glpi_user_id = c.glpi_id);
  GET DIAGNOSTICS vinculados = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 3. Nova: origem glpi, sem perfil, sem e-mail. Existir para ser
  --    escolhida num seletor nao e o mesmo que poder entrar no sistema.
  -- ------------------------------------------------------------------
  INSERT INTO usuarios
    (id, glpi_user_id, nome, email, login, origem, admin, ativo,
     sincronizado_em, criado_em, atualizado_em)
  SELECT gen_random_uuid()::text, c.glpi_id, c.nome, NULL, c.login, 'glpi', 0, 1,
         LOCALTIMESTAMP, LOCALTIMESTAMP, LOCALTIMESTAMP
    FROM glpi_carga c
   WHERE NOT EXISTS (SELECT 1 FROM usuarios x WHERE x.glpi_user_id = c.glpi_id)
     AND NOT EXISTS (SELECT 1 FROM usuarios x
                      WHERE LOWER(REGEXP_REPLACE(x.login, '^.*\\', '')) = LOWER(c.login));
  GET DIAGNOSTICS criados = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 4. Veio do GLPI e nao esta mais na lista: desativa, mantem a linha.
  --    Sem glpi_user_id (desvinculado a mao) fica como esta, igual ao app.
  -- ------------------------------------------------------------------
  UPDATE usuarios
     SET ativo = 0, atualizado_em = LOCALTIMESTAMP
   WHERE origem = 'glpi'
     AND ativo = 1
     AND glpi_user_id IS NOT NULL
     AND glpi_user_id NOT IN (SELECT glpi_id FROM glpi_carga);
  GET DIAGNOSTICS desativados = ROW_COUNT;

  RAISE NOTICE 'Carga GLPI: recebidos=% atualizados=% vinculados=% criados=% desativados=%',
    recebidos, atualizados, vinculados, criados, desativados;

  IF atualizados + vinculados + criados <> recebidos THEN
    RAISE NOTICE 'Atencao: % linha(s) da carga nao entraram em nenhum passo (ja vinculadas a cadastro manual/AD, ou login repetido no GLPI).',
      recebidos - (atualizados + vinculados + criados);
  END IF;
END $$;

INSERT INTO db_migrations (arquivo) VALUES ('13-seed-usuarios-glpi.sql')
ON CONFLICT (arquivo) DO NOTHING;

RESET ROLE;
