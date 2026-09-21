-- db/postgres/14-projeto-sigiloso.sql
-- Projeto sigiloso + solicitacao de acesso
-- Ids em VARCHAR(36) para acompanhar o restante do schema (crypto.randomUUID).

BEGIN;

-- 1. Sigilo no projeto -------------------------------------------------------

ALTER TABLE projetos
    ADD COLUMN IF NOT EXISTS sigiloso SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE projetos
    DROP CONSTRAINT IF EXISTS ck_projetos_sigiloso;

ALTER TABLE projetos
    ADD CONSTRAINT ck_projetos_sigiloso CHECK (sigiloso IN (0, 1));

COMMENT ON COLUMN projetos.sigiloso IS
    'SMALLINT 0/1. 1 = projeto sigiloso: nem o nome aparece para quem nao tem acesso.';

CREATE INDEX IF NOT EXISTS ix_projetos_sigiloso ON projetos (sigiloso);

-- 2. Solicitacoes de acesso --------------------------------------------------

CREATE TABLE IF NOT EXISTS projeto_solicitacoes_acesso (
    id                  VARCHAR(36)   NOT NULL,
    projeto_id          VARCHAR(36)   NOT NULL,
    solicitante_id      VARCHAR(36)   NOT NULL,
    justificativa       VARCHAR(1000),
    situacao            VARCHAR(20)   NOT NULL DEFAULT 'pendente',
    decidido_por_id     VARCHAR(36),
    decidido_em         TIMESTAMP,
    motivo_recusa       VARCHAR(1000),
    criado_em           TIMESTAMP     NOT NULL DEFAULT LOCALTIMESTAMP,
    atualizado_em       TIMESTAMP     NOT NULL DEFAULT LOCALTIMESTAMP,
    CONSTRAINT pk_projeto_solicitacoes_acesso PRIMARY KEY (id),
    CONSTRAINT ck_psa_situacao
        CHECK (situacao IN ('pendente', 'aprovada', 'recusada', 'cancelada')),
    CONSTRAINT fk_psa_projeto
        FOREIGN KEY (projeto_id) REFERENCES projetos (id) ON DELETE CASCADE,
    CONSTRAINT fk_psa_solicitante
        FOREIGN KEY (solicitante_id) REFERENCES usuarios (id),
    CONSTRAINT fk_psa_decidido_por
        FOREIGN KEY (decidido_por_id) REFERENCES usuarios (id)
);

-- Uma pendencia por usuario/projeto; o historico de recusadas fica livre.
CREATE UNIQUE INDEX IF NOT EXISTS ux_psa_pendente
    ON projeto_solicitacoes_acesso (projeto_id, solicitante_id)
    WHERE situacao = 'pendente';

CREATE INDEX IF NOT EXISTS ix_psa_projeto_situacao
    ON projeto_solicitacoes_acesso (projeto_id, situacao);

CREATE INDEX IF NOT EXISTS ix_psa_solicitante
    ON projeto_solicitacoes_acesso (solicitante_id, situacao);

-- 3. Acesso concedido --------------------------------------------------------

CREATE TABLE IF NOT EXISTS projeto_acessos (
    projeto_id          VARCHAR(36) NOT NULL,
    usuario_id          VARCHAR(36) NOT NULL,
    concedido_por_id    VARCHAR(36),
    origem              VARCHAR(20) NOT NULL DEFAULT 'solicitacao',
    criado_em           TIMESTAMP   NOT NULL DEFAULT LOCALTIMESTAMP,
    CONSTRAINT pk_projeto_acessos PRIMARY KEY (projeto_id, usuario_id),
    CONSTRAINT ck_pa_origem CHECK (origem IN ('solicitacao', 'manual')),
    CONSTRAINT fk_pa_projeto
        FOREIGN KEY (projeto_id) REFERENCES projetos (id) ON DELETE CASCADE,
    CONSTRAINT fk_pa_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    CONSTRAINT fk_pa_concedido_por
        FOREIGN KEY (concedido_por_id) REFERENCES usuarios (id)
);

CREATE INDEX IF NOT EXISTS ix_pa_usuario ON projeto_acessos (usuario_id);

-- Sem funcionalidade de perfil de proposito: quem aprova o pedido e
-- quem responde pelo projeto — gerente ou patrocinador —, e isso vem
-- das proprias colunas de projetos, nao de uma chave que alguem possa
-- marcar para um perfil qualquer.

COMMIT;