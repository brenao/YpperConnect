-- =====================================================================
-- Agendador das rotinas diárias
--
-- O banco agenda; a aplicação executa. `pg_cron` dispara um POST em
-- /api/rotinas via `pg_net`, e a regra de negócio (6 dias sem
-- atualização, diário depois de uma semana) continua num lugar só, no
-- TypeScript.
--
-- POR QUE NÃO ESCREVER A ROTINA EM PL/pgSQL
--   O `pg_cron` roda SQL e não envia e-mail. Uma função PL/pgSQL até
--   conseguiria inserir na fila de notificações, mas aí a regra dos 6
--   dias existiria em dois lugares — e mudar num só é o tipo de erro
--   que ninguém percebe até o gerente parar de ser cobrado. Além disso
--   o envio continuaria dependendo da aplicação, então o agendamento
--   ficaria pela metade de qualquer jeito.
--
-- O QUE FICA NO BANCO
--   O agendamento e o log. `cron.job_run_details` guarda cada execução
--   com início, fim, status e mensagem de retorno — é a auditoria que
--   um cron de sistema operacional não dá.
--
-- PRÉ-REQUISITOS
--   1. O pg_cron precisa estar na `shared_preload_libraries` do
--      postgresql.conf, e o serviço reiniciado:
--        shared_preload_libraries = 'pg_cron'
--        cron.database_name = 'ypper'
--   2. CRON_TOKEN configurado no ambiente do container da aplicação,
--      com o mesmo valor usado abaixo.
--
-- APLICAR (como superusuário, não como `ypper`):
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     -v ON_ERROR_STOP=1 < 06-agendador.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------
-- O segredo fica numa tabela de configuração em vez de embutido no
-- comando do job: `cron.job` é legível por qualquer um que consulte o
-- catálogo, e o token daria acesso ao endpoint.
--
-- A tabela é do `postgres` e sem GRANT para `ypper`: a aplicação não
-- precisa ler o próprio token de volta.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cron_config (
  chave  VARCHAR(60)  NOT NULL,
  valor  VARCHAR(500) NOT NULL,
  CONSTRAINT pk_cron_config PRIMARY KEY (chave)
);

-- TROQUE os dois valores antes de aplicar.
INSERT INTO cron_config (chave, valor) VALUES
  ('rotinas_url',   'http://localhost:8080/ypper/api/rotinas'),
  ('rotinas_token', 'TROQUE-ESTE-VALOR')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

-- ---------------------------------------------------------------------
-- A chamada.
--
-- `pg_net` é assíncrono: `http_post` enfileira e devolve o id na hora,
-- sem segurar a transação do job. A resposta cai em `net._http_response`
-- e é lá que se confere se a aplicação respondeu 200.
--
-- O host é `localhost` de propósito: bate direto no container da
-- aplicação, sem passar pelo OpenResty. O `check-token.lua` recusaria
-- uma requisição de máquina, que não tem token de usuário.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION disparar_rotinas() RETURNS bigint AS $$
DECLARE
  v_url   text;
  v_token text;
BEGIN
  SELECT valor INTO v_url   FROM cron_config WHERE chave = 'rotinas_url';
  SELECT valor INTO v_token FROM cron_config WHERE chave = 'rotinas_token';

  IF v_url IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'cron_config incompleta: rotinas_url e rotinas_token são obrigatórios';
  END IF;

  RETURN net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-token', v_token
               ),
    body    := '{}'::jsonb
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 8h, de segunda a sexta. Fim de semana fica de fora: lembrete que
-- chega no sábado é lido na segunda junto do de segunda, e dois e-mails
-- iguais ensinam a ignorar os dois.
--
-- O horário é o do servidor do banco. Confirme com `SHOW timezone` que
-- ele está em America/Sao_Paulo, senão o job dispara na hora errada.
-- ---------------------------------------------------------------------
SELECT cron.schedule(
  'ypper-rotinas-diarias',
  '0 8 * * 1-5',
  $$SELECT disparar_rotinas()$$
);

-- ---------------------------------------------------------------------
-- Conferência depois de aplicar:
--
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--
--   SELECT start_time, status, return_message
--     FROM cron.job_run_details
--    WHERE jobname = 'ypper-rotinas-diarias'
--    ORDER BY start_time DESC LIMIT 10;
--
--   SELECT created, status_code, content
--     FROM net._http_response ORDER BY created DESC LIMIT 5;
--
-- O primeiro mostra se o job existe; o segundo, se ele rodou; o
-- terceiro, o que a aplicação respondeu. Um job com status 'succeeded'
-- e um http_response 401 significa que o token está errado — o job
-- disparou, a aplicação recusou.
--
-- Para rodar na mão agora:  SELECT disparar_rotinas();
-- Para desligar:            SELECT cron.unschedule('ypper-rotinas-diarias');
-- =====================================================================


-- O registro é do `ypper`, dono da tabela; o resto deste script roda
-- como superusuário por causa das extensões.
SET ROLE ypper;
INSERT INTO db_migrations (arquivo) VALUES ('06-agendador.sql')
ON CONFLICT (arquivo) DO NOTHING;
RESET ROLE;