-- =====================================================================
-- 23 - Preferencias de interface por usuario
--
-- A largura e a ordem das colunas do cronograma viviam no
-- `localStorage`. Funcionava para uma maquina so, e falhava em dois
-- casos reais:
--
--   1. Trocar de computador devolvia tudo ao padrao. Quem ajusta a
--      grade do jeito que gosta espera encontra-la assim no notebook.
--
--   2. Maquina compartilhada — sala de reuniao, estacao de fabrica —
--      fazia duas pessoas dividirem a mesma configuracao, e cada uma
--      desfazia o ajuste da outra sem entender por que.
--
-- TABELA GENERICA, E NAO COLUNAS
--   `chave` é texto livre e `valor` é JSON. A proxima preferencia de
--   tela — filtro lembrado, zoom padrao do Gantt, densidade da lista —
--   entra sem migration nova. Uma tabela por tipo de preferencia
--   multiplicaria migrations para guardar meia duzia de bytes cada.
--
--   O preco e que o banco nao valida o conteudo: quem grava e quem le
--   precisam concordar sobre o formato. E aceitavel porque preferencia
--   de tela nao entra em relatorio nem em regra de negocio — o pior
--   caso de um valor corrompido e a tela voltar ao padrao.
--
-- APAGA JUNTO COM O USUARIO
--   ON DELETE CASCADE: preferencia de quem nao existe mais e lixo. Nao
--   e historico de trabalho, entao nao ha o que preservar.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/23-preferencias.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

CREATE TABLE IF NOT EXISTS usuario_preferencias (
    usuario_id     VARCHAR(36) NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    -- Identificador da preferencia: "colunas.cronograma", por exemplo.
    -- O ponto separa o dominio da tela, para um dia dar para limpar
    -- tudo de um dominio so com LIKE.
    chave          VARCHAR(120) NOT NULL,
    valor          JSONB       NOT NULL,
    atualizado_em  TIMESTAMP   NOT NULL DEFAULT LOCALTIMESTAMP,

    PRIMARY KEY (usuario_id, chave)
);

COMMENT ON TABLE usuario_preferencias IS
    'Preferencias de interface por usuario. Conteudo livre: quem grava e quem le acordam o formato.';

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('23-preferencias.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;