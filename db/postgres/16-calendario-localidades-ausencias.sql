-- db/postgres/16-calendario-localidades-ausencias.sql
--
-- Calendario em tres camadas, no modelo do MS Project:
--
--   instalacao  ->  localidade  ->  recurso
--
-- O que nao for declarado na camada de baixo herda a de cima. Uma
-- empresa com uma cidade so nao cadastra nada alem do que ja tem; a que
-- tem fabrica e escritorio em estados diferentes cadastra duas
-- localidades e segue.
--
-- Empresa unica: nao ha `empresa_id` aqui de proposito. Se o produto
-- virar multiempresa, essas tabelas recebem a coluna junto com
-- `usuarios`, `projetos` e todo o resto, na mesma migracao — coloca-la
-- so aqui isolaria o calendario e deixaria o resto compartilhado, que
-- e pior do que qualquer um dos dois extremos.

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Localidades
--
-- `pais` em ISO-3166 alfa-2 e `regiao` como texto livre, e nao uma
-- coluna `uf`: estado, provincia, condado e canton sao a mesma camada
-- com nomes diferentes, e um produto que assume "UF" nao atravessa a
-- fronteira.
--
-- `padrao` marca a localidade de quem nao tem uma. E unica por indice
-- parcial: duas padroes tornariam a heranca ambigua.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS localidades (
    id          VARCHAR(36)  NOT NULL,
    nome        VARCHAR(160) NOT NULL,
    pais        CHAR(2)      NOT NULL DEFAULT 'BR',
    regiao      VARCHAR(80),
    cidade      VARCHAR(120),
    padrao      SMALLINT     NOT NULL DEFAULT 0,
    ativo       SMALLINT     NOT NULL DEFAULT 1,
    criado_em   TIMESTAMP    NOT NULL DEFAULT LOCALTIMESTAMP,
    CONSTRAINT pk_localidades PRIMARY KEY (id),
    CONSTRAINT ck_localidades_padrao CHECK (padrao IN (0, 1)),
    CONSTRAINT ck_localidades_ativo CHECK (ativo IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_localidades_padrao
    ON localidades (padrao) WHERE padrao = 1;

-- A localidade padrao nasce aqui para que o cadastro existente continue
-- valendo sem ninguem precisar configurar nada.
INSERT INTO localidades (id, nome, pais, padrao)
SELECT gen_random_uuid()::varchar, 'Matriz', 'BR', 1
 WHERE NOT EXISTS (SELECT 1 FROM localidades);

-- ---------------------------------------------------------------------
-- 2. Feriados por abrangencia
--
-- `dia` e `mes` sao gerados a partir da data: com duas fontes para a
-- mesma informacao, uma delas envelhece. Feriado recorrente e casado
-- por dia/mes em qualquer ano; o nao recorrente (Pascoa, Carnaval,
-- ponto facultativo) continua valendo so para a data cadastrada.
-- ---------------------------------------------------------------------

ALTER TABLE feriados
    ADD COLUMN IF NOT EXISTS abrangencia VARCHAR(10) NOT NULL DEFAULT 'nacional';

ALTER TABLE feriados
    ADD COLUMN IF NOT EXISTS localidade_id VARCHAR(36);

ALTER TABLE feriados
    ADD COLUMN IF NOT EXISTS recorrente SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE feriados
    ADD COLUMN IF NOT EXISTS dia SMALLINT
        GENERATED ALWAYS AS (EXTRACT(DAY FROM data)::smallint) STORED;

ALTER TABLE feriados
    ADD COLUMN IF NOT EXISTS mes SMALLINT
        GENERATED ALWAYS AS (EXTRACT(MONTH FROM data)::smallint) STORED;

ALTER TABLE feriados DROP CONSTRAINT IF EXISTS ck_feriados_abrangencia;

ALTER TABLE feriados
    ADD CONSTRAINT ck_feriados_abrangencia
        CHECK (abrangencia IN ('nacional', 'regional', 'local'));

ALTER TABLE feriados DROP CONSTRAINT IF EXISTS ck_feriados_recorrente;

ALTER TABLE feriados
    ADD CONSTRAINT ck_feriados_recorrente CHECK (recorrente IN (0, 1));

-- Feriado nacional vale para todo mundo e por isso nao tem localidade.
-- Regional e local precisam de uma: sem ela, nao ha como saber a quem
-- se aplicam, e o feriado viraria nacional na pratica.
ALTER TABLE feriados DROP CONSTRAINT IF EXISTS ck_feriados_localidade;

ALTER TABLE feriados
    ADD CONSTRAINT ck_feriados_localidade CHECK (
        (abrangencia = 'nacional' AND localidade_id IS NULL)
        OR (abrangencia <> 'nacional' AND localidade_id IS NOT NULL)
    );

ALTER TABLE feriados DROP CONSTRAINT IF EXISTS fk_feriados_localidade;

ALTER TABLE feriados
    ADD CONSTRAINT fk_feriados_localidade
        FOREIGN KEY (localidade_id) REFERENCES localidades (id);

CREATE INDEX IF NOT EXISTS ix_feriados_recorrencia
    ON feriados (recorrente, mes, dia);

CREATE INDEX IF NOT EXISTS ix_feriados_localidade
    ON feriados (localidade_id, abrangencia);

-- ---------------------------------------------------------------------
-- 3. Expediente por localidade
--
-- `localidade_id` nulo e o expediente da instalacao — o que ja existe
-- hoje. A localidade so cadastra faixa propria quando a jornada dela
-- difere, e nesse caso a dela substitui a padrao inteira, nao
-- complementa: jornada meio herdada e meio propria produz horario que
-- ninguem consegue conferir.
-- ---------------------------------------------------------------------

ALTER TABLE expediente
    ADD COLUMN IF NOT EXISTS localidade_id VARCHAR(36);

ALTER TABLE expediente DROP CONSTRAINT IF EXISTS fk_expediente_localidade;

ALTER TABLE expediente
    ADD CONSTRAINT fk_expediente_localidade
        FOREIGN KEY (localidade_id) REFERENCES localidades (id);

-- A unicidade antiga (dia_semana, minuto_ini) impediria duas
-- localidades de comecarem no mesmo horario.
ALTER TABLE expediente DROP CONSTRAINT IF EXISTS uq_expediente_dia_ini;

CREATE UNIQUE INDEX IF NOT EXISTS ux_expediente_padrao_dia_ini
    ON expediente (dia_semana, minuto_ini) WHERE localidade_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_expediente_local_dia_ini
    ON expediente (localidade_id, dia_semana, minuto_ini)
    WHERE localidade_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Localidade do recurso
--
-- Nulo herda a padrao. Fica em `recursos`, e nao em `usuarios`, porque
-- quem executa tarefa e recurso — inclusive terceiro sem conta no
-- sistema, que tambem tem feriado e ferias.
-- ---------------------------------------------------------------------

ALTER TABLE recursos
    ADD COLUMN IF NOT EXISTS localidade_id VARCHAR(36);

ALTER TABLE recursos DROP CONSTRAINT IF EXISTS fk_recursos_localidade;

ALTER TABLE recursos
    ADD CONSTRAINT fk_recursos_localidade
        FOREIGN KEY (localidade_id) REFERENCES localidades (id);

-- ---------------------------------------------------------------------
-- 5. Ausencias
--
-- So registro: sem aprovacao, sem saldo de dias. Quem aprova ferias e o
-- RH, em outro sistema; aqui o que importa e que o cronograma saiba que
-- a pessoa nao vai trabalhar naquele periodo.
--
-- O `tipo` serve ao mapa de disponibilidade e ao relatorio, nao a regra:
-- para o calculo de datas, toda ausencia faz a mesma coisa — aquele dia
-- nao conta para aquela pessoa.
--
-- Dia inteiro, sempre. Meio periodo dobraria a complexidade do
-- reagendamento para resolver poucos casos reais.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurso_ausencias (
    id           VARCHAR(36)  NOT NULL,
    recurso_id   VARCHAR(36)  NOT NULL,
    tipo         VARCHAR(20)  NOT NULL DEFAULT 'ferias',
    inicio       DATE         NOT NULL,
    fim          DATE         NOT NULL,
    observacao   VARCHAR(500),
    criado_por_id VARCHAR(36),
    criado_em    TIMESTAMP    NOT NULL DEFAULT LOCALTIMESTAMP,
    atualizado_em TIMESTAMP   NOT NULL DEFAULT LOCALTIMESTAMP,
    CONSTRAINT pk_recurso_ausencias PRIMARY KEY (id),
    CONSTRAINT ck_ausencia_tipo CHECK (tipo IN (
        'ferias',
        'licenca_medica',
        'licenca',
        'treinamento',
        'folga',
        'outro'
    )),
    CONSTRAINT ck_ausencia_periodo CHECK (fim >= inicio),
    CONSTRAINT fk_ausencia_recurso
        FOREIGN KEY (recurso_id) REFERENCES recursos (id) ON DELETE CASCADE,
    CONSTRAINT fk_ausencia_criado_por
        FOREIGN KEY (criado_por_id) REFERENCES usuarios (id)
);

-- O reagendamento pergunta sempre "quais ausencias deste recurso tocam
-- este periodo"; e este indice que responde.
CREATE INDEX IF NOT EXISTS ix_ausencia_recurso_periodo
    ON recurso_ausencias (recurso_id, inicio, fim);

CREATE INDEX IF NOT EXISTS ix_ausencia_periodo
    ON recurso_ausencias (inicio, fim);

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('16-calendario-localidades-ausencias.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;