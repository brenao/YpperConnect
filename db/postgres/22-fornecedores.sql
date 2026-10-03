-- =====================================================================
-- 22 - Fornecedores e recursos externos
--
-- Terceiro ja podia receber tarefa: `recursos.usuario_id` sempre foi
-- nulavel, justamente para caber quem nao tem conta. O que faltava era
-- saber DE QUEM a pessoa e — e, sem isso, tres coisas ficavam erradas:
--
--   1. A capacidade da equipe somava gente que a empresa nao emprega.
--      "Temos 200h por semana" incluia 80h de um contrato que pode
--      acabar no mes seguinte.
--
--   2. Nao havia como responder "quanto deste projeto e terceiro?",
--      que e a primeira pergunta da diretoria sobre custo de projeto.
--
--   3. O nome da empresa, quando aparecia, vinha digitado no campo de
--      papel: "Dev Senior - Operacional". Na primeira semana existiam
--      "Operacional", "OPERACIONAL" e "Operacional LTDA", e qualquer
--      soma por fornecedor saia errada.
--
-- MODELO
--   `fornecedores` e cadastro proprio, em Administracao, ao lado de
--   Localidades. O recurso aponta para um fornecedor; nulo significa
--   interno, que e o caso da maioria e por isso e o padrao.
--
--   Um recurso pertence a UM fornecedor. Pessoa que troca de empresa
--   vira outro recurso: as tarefas antigas continuam apontando para o
--   vinculo que existia quando elas foram feitas, que e o que o
--   historico precisa. Um cadastro de "pessoa" separado do vinculo
--   resolveria o caso de quem volta, mas e bem mais complexo para um
--   caso raro.
--
-- CUSTO
--   `custo_hora` fica no recurso, com `custo_hora_padrao` no fornecedor
--   para servir de sugestao. Contrato de corpo costuma precificar por
--   perfil — "senior da Operacional custa X" —, e o valor por pessoa
--   permite a excecao sem inventar uma tabela de perfis.
--
--   Nao ha relatorio de custo nesta migration. A coluna existe para o
--   dado ser coletado desde ja: relatorio sem historico so comeca a
--   servir um ano depois.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/22-fornecedores.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- Fornecedores
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fornecedores (
    id                 VARCHAR(36)  PRIMARY KEY,
    nome               VARCHAR(160) NOT NULL,
    -- CNPJ sem mascara, e opcional: fornecedor pessoa fisica existe, e
    -- exigir o documento no cadastro trava o gerente que so quer
    -- registrar quem esta no projeto hoje.
    cnpj               VARCHAR(14),
    contato_nome       VARCHAR(160),
    contato_email      VARCHAR(320),
    contato_telefone   VARCHAR(40),
    -- Sugestao de custo/hora para os recursos deste fornecedor. O valor
    -- que vale e o do recurso; este so preenche o formulario.
    custo_hora_padrao  NUMERIC(12,2),
    observacao         TEXT,
    ativo              SMALLINT     NOT NULL DEFAULT 1,
    criado_em          TIMESTAMP    NOT NULL DEFAULT LOCALTIMESTAMP,

    CONSTRAINT ck_fornecedores_ativo CHECK (ativo IN (0, 1)),
    CONSTRAINT ck_fornecedores_custo CHECK (custo_hora_padrao IS NULL OR custo_hora_padrao >= 0)
);

-- Nome unico, sem diferenciar caixa nem espaco nas pontas. E o que
-- impede "Operacional" e "OPERACIONAL" de coexistirem — o problema que
-- esta migration existe para resolver.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fornecedores_nome
    ON fornecedores (LOWER(TRIM(nome)));

CREATE UNIQUE INDEX IF NOT EXISTS ux_fornecedores_cnpj
    ON fornecedores (cnpj) WHERE cnpj IS NOT NULL;

-- ---------------------------------------------------------------------
-- O vinculo no recurso
-- ---------------------------------------------------------------------

ALTER TABLE recursos
    ADD COLUMN IF NOT EXISTS fornecedor_id VARCHAR(36) REFERENCES fornecedores(id);

ALTER TABLE recursos
    ADD COLUMN IF NOT EXISTS custo_hora NUMERIC(12,2);

ALTER TABLE recursos DROP CONSTRAINT IF EXISTS ck_recursos_custo;

ALTER TABLE recursos
    ADD CONSTRAINT ck_recursos_custo CHECK (custo_hora IS NULL OR custo_hora >= 0);

CREATE INDEX IF NOT EXISTS ix_recursos_fornecedor
    ON recursos (fornecedor_id) WHERE fornecedor_id IS NOT NULL;

COMMENT ON COLUMN recursos.fornecedor_id IS
    'Nulo = recurso interno. Preenchido = terceiro daquele fornecedor.';

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('22-fornecedores.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;

-- ---------------------------------------------------------------------
-- Depois de aplicar
--
-- Nenhum recurso vira externo sozinho: todos continuam internos ate
-- alguem apontar o fornecedor. Quem hoje tem a empresa escrita no campo
-- de papel — "Dev Senior - Operacional" — precisa ser ajustado a mao,
-- e vale conferir quem sao:
--
--   SELECT id, nome, papel FROM recursos
--    WHERE ativo = 1 AND papel IS NOT NULL
--    ORDER BY papel;
-- ---------------------------------------------------------------------