-- =====================================================================
-- Baseline: a foto do cronograma no momento em que foi aprovado.
--
-- Sem ela nao existe "progresso esperado" nem desvio — so da para dizer
-- onde o projeto esta, nunca se esta atrasado em relacao ao combinado.
--
-- Guardamos por versao: replanejamento e evento de governanca, e a
-- comparacao com a PRIMEIRA baseline e o que revela derrapagem
-- acumulada. Sobrescrever apagaria justamente essa evidencia.
-- =====================================================================

CREATE TABLE projeto_baselines (
  id           VARCHAR2(36 CHAR)  NOT NULL,
  projeto_id   VARCHAR2(36 CHAR)  NOT NULL,
  versao       NUMBER(4)          NOT NULL,
  descricao    VARCHAR2(500 CHAR),
  autor_id     VARCHAR2(36 CHAR),
  criado_em    TIMESTAMP          NOT NULL,
  CONSTRAINT pk_projeto_baselines PRIMARY KEY (id),
  CONSTRAINT uq_baseline_versao UNIQUE (projeto_id, versao),
  CONSTRAINT fk_baseline_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE,
  CONSTRAINT fk_baseline_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id)
);

-- Copia das datas por tarefa. tarefa_id sem FK de proposito: a tarefa
-- pode ser excluida depois, e a baseline precisa sobreviver como
-- registro historico do que foi planejado.
CREATE TABLE baseline_tarefas (
  baseline_id  VARCHAR2(36 CHAR)  NOT NULL,
  tarefa_id    VARCHAR2(36 CHAR)  NOT NULL,
  nome         VARCHAR2(300 CHAR) NOT NULL,
  inicio       DATE               NOT NULL,
  fim          DATE               NOT NULL,
  CONSTRAINT pk_baseline_tarefas PRIMARY KEY (baseline_id, tarefa_id),
  CONSTRAINT fk_bt_baseline FOREIGN KEY (baseline_id)
    REFERENCES projeto_baselines (id) ON DELETE CASCADE
);

COMMIT;