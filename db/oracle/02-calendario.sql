-- =====================================================================
-- Calendario de atendimento para calculo de SLA em horario comercial.
--
-- MODELO: cada linha de `expediente` e uma faixa continua de trabalho.
-- O intervalo de almoco nao e uma coluna: e a lacuna entre a faixa da
-- manha e a da tarde. Isso permite jornadas irregulares (sabado ate
-- meio-dia, turno unico em algum dia) sem mudar o schema.
--
-- HORARIO EM MINUTOS: Oracle nao tem tipo TIME. Guardar minutos desde
-- a meia-noite (0-1440) permite aritmetica direta no calculo do SLA.
-- 08:00 = 480, 12:00 = 720, 14:00 = 840, 18:00 = 1080.
-- =====================================================================

CREATE TABLE expediente (
  id           VARCHAR2(36 CHAR) NOT NULL,
  dia_semana   NUMBER(1)         NOT NULL,
  minuto_ini   NUMBER(4)         NOT NULL,
  minuto_fim   NUMBER(4)         NOT NULL,
  ativo        NUMBER(1)         DEFAULT 1 NOT NULL,
  CONSTRAINT pk_expediente PRIMARY KEY (id),
  CONSTRAINT uq_expediente_dia_ini UNIQUE (dia_semana, minuto_ini),
  -- 1=segunda ... 7=domingo (ISO 8601)
  CONSTRAINT ck_expediente_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT ck_expediente_ini CHECK (minuto_ini BETWEEN 0 AND 1440),
  CONSTRAINT ck_expediente_fim CHECK (minuto_fim BETWEEN 0 AND 1440),
  CONSTRAINT ck_expediente_ordem CHECK (minuto_fim > minuto_ini),
  CONSTRAINT ck_expediente_ativo CHECK (ativo IN (0,1))
);

-- recorrente = 1: feriado de data fixa que se repete todo ano
-- (Natal, Tiradentes). O ano gravado e irrelevante; a busca casa
-- por mes e dia atraves das colunas virtuais abaixo.
-- recorrente = 0: data movel (Carnaval, Pascoa) ou ponto facultativo
-- especifico daquele ano. Precisa ser cadastrado ano a ano.
CREATE TABLE feriados (
  id             VARCHAR2(36 CHAR)  NOT NULL,
  data_feriado   DATE               NOT NULL,
  descricao      VARCHAR2(200 CHAR) NOT NULL,
  tipo           VARCHAR2(12 CHAR)  DEFAULT 'nacional' NOT NULL,
  recorrente     NUMBER(1)          DEFAULT 0 NOT NULL,
  ativo          NUMBER(1)          DEFAULT 1 NOT NULL,
  mes            NUMBER(2) GENERATED ALWAYS AS (EXTRACT(MONTH FROM data_feriado)) VIRTUAL,
  dia            NUMBER(2) GENERATED ALWAYS AS (EXTRACT(DAY FROM data_feriado)) VIRTUAL,
  CONSTRAINT pk_feriados PRIMARY KEY (id),
  CONSTRAINT uq_feriados_data UNIQUE (data_feriado),
  CONSTRAINT ck_feriados_tipo CHECK (tipo IN
    ('nacional','estadual','municipal','facultativo')),
  CONSTRAINT ck_feriados_recorrente CHECK (recorrente IN (0,1)),
  CONSTRAINT ck_feriados_ativo CHECK (ativo IN (0,1))
);

CREATE INDEX ix_feriados_data ON feriados (data_feriado, ativo);
CREATE INDEX ix_feriados_recorrente ON feriados (recorrente, mes, dia, ativo);