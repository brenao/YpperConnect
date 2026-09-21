-- =====================================================================
-- 17 - Acerto do historico de migrations
--
-- `db_migrations` parou de refletir a realidade em algum ponto: 14, 15
-- e 16 foram aplicadas no ambiente de desenvolvimento antes de
-- ganharem o bloco de registro que os scripts anteriores ja tinham.
-- Sem este acerto, quem consultar a tabela vai concluir que elas nao
-- rodaram e aplicar de novo — e a 14 nao e idempotente: o ADD
-- CONSTRAINT falharia e a transacao inteira voltaria.
--
-- Registra SO o que se sabe aplicado. 06, 12 e 13 ficam de fora de
-- proposito: marcar como aplicada uma migration que nao rodou e pior do
-- que nao ter registro nenhum, porque a mentira e silenciosa. Confira
-- cada uma pelo efeito dela no banco antes de decidir (ver comentario
-- no fim deste arquivo).
--
-- O ON CONFLICT torna o script repetivel: rodar duas vezes nao
-- duplica nem sobrescreve a data de quem ja estava la.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/17-acerto-historico.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

INSERT INTO db_migrations (arquivo) VALUES
    ('14-projeto-sigiloso.sql'),
    ('15-acesso-notificacoes-e-coach.sql'),
    ('16-calendario-localidades-ausencias.sql')
ON CONFLICT (arquivo) DO NOTHING;

INSERT INTO db_migrations (arquivo) VALUES ('17-acerto-historico.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;

-- ---------------------------------------------------------------------
-- Como conferir as tres que ficaram de fora
--
-- 06-agendador.sql — criou os jobs do pg_cron:
--   SELECT jobname, schedule, command FROM cron.job;
--   (erro "schema cron nao existe" = a extensao nao esta instalada,
--    entao a 06 nao rodou)
--
-- 12-rotinas-url-beagleone.sql — ajustou a URL do job para /beagleone:
--   SELECT jobname, command FROM cron.job WHERE command LIKE '%beagleone%';
--
-- 13-seed-usuarios-glpi.sql — carga inicial de usuarios do GLPI:
--   SELECT COUNT(*) FROM usuarios WHERE origem = 'glpi';
--   Cuidado: a sincronizacao por /api/rotinas carrega os mesmos
--   usuarios, entao ter 1287 linhas NAO prova que a 13 rodou. O proprio
--   script e defensivo — consulta db_migrations e nao faz nada se ja
--   constar —, entao reaplica-lo e seguro e resolve a duvida.
-- ---------------------------------------------------------------------