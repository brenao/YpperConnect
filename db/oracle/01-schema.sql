-- =====================================================================
-- YpperConnect - Schema Oracle 19c
-- Charset do banco: WE8MSWIN1252 (single-byte)
--
-- CONVENCOES
--   - VARCHAR2(n CHAR): semantica de caractere explicita. Hoje equivale
--     a bytes, mas mantem o schema correto se o banco migrar para
--     AL32UTF8 no futuro.
--   - Booleano: NUMBER(1) com CHECK (0,1). Oracle 19c nao tem BOOLEAN.
--   - Instante no tempo: TIMESTAMP WITH LOCAL TIME ZONE.
--     Data pura (cronograma): DATE, sempre com TRUNC na aplicacao.
--   - Enum de negocio ITIL: CHECK constraint (mudar exige mudar codigo).
--     Lista administravel: tabela (equipes, categorias).
--   - Toda relacao e por ID. Nenhuma coluna guarda nome de pessoa.
--
-- ATENCAO ORACLE: string vazia e NULL. A aplicacao deve normalizar ''
-- para NULL antes do insert, senao coluna NOT NULL estoura.
--
-- Para texto livre em Unicode completo (emoji), trocar VARCHAR2 por
-- NVARCHAR2 e CLOB por NCLOB nas colunas marcadas [TEXTO LIVRE].
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Listas administraveis
-- ---------------------------------------------------------------------

CREATE TABLE equipes (
  id     VARCHAR2(36 CHAR)  NOT NULL,
  nome   VARCHAR2(120 CHAR) NOT NULL,
  ativo  NUMBER(1)          DEFAULT 1 NOT NULL,
  CONSTRAINT pk_equipes PRIMARY KEY (id),
  CONSTRAINT uq_equipes_nome UNIQUE (nome),
  CONSTRAINT ck_equipes_ativo CHECK (ativo IN (0,1))
);

CREATE TABLE categorias (
  id      VARCHAR2(36 CHAR)  NOT NULL,
  nome    VARCHAR2(120 CHAR) NOT NULL,
  escopo  VARCHAR2(20 CHAR)  NOT NULL,
  ativo   NUMBER(1)          DEFAULT 1 NOT NULL,
  CONSTRAINT pk_categorias PRIMARY KEY (id),
  CONSTRAINT uq_categorias_escopo_nome UNIQUE (escopo, nome),
  CONSTRAINT ck_categorias_escopo CHECK (escopo IN ('chamado','servico','artigo','sistema')),
  CONSTRAINT ck_categorias_ativo CHECK (ativo IN (0,1))
);


-- ---------------------------------------------------------------------
-- 2. Identidade e autorizacao
-- ---------------------------------------------------------------------

CREATE TABLE perfis_acesso (
  id         VARCHAR2(36 CHAR)  NOT NULL,
  nome       VARCHAR2(120 CHAR) NOT NULL,
  descricao  VARCHAR2(500 CHAR),
  ativo      NUMBER(1)          DEFAULT 1 NOT NULL,
  CONSTRAINT pk_perfis_acesso PRIMARY KEY (id),
  CONSTRAINT uq_perfis_acesso_nome UNIQUE (nome),
  CONSTRAINT ck_perfis_acesso_ativo CHECK (ativo IN (0,1))
);

-- ad_object_id: objectGUID do AD (ou claim "oid" do Entra ID).
-- Unica chave estavel de uma pessoa. Login, email e nome mudam.
-- Fica nulo enquanto a autenticacao nao for implementada.
CREATE TABLE usuarios (
  id               VARCHAR2(36 CHAR)  NOT NULL,
  ad_object_id     VARCHAR2(64 CHAR),
  nome             VARCHAR2(200 CHAR) NOT NULL,
  email            VARCHAR2(320 CHAR) NOT NULL,
  login            VARCHAR2(120 CHAR) NOT NULL,
  departamento     VARCHAR2(160 CHAR),
  equipe_id        VARCHAR2(36 CHAR),
  perfil_id        VARCHAR2(36 CHAR),
  origem           VARCHAR2(10 CHAR)  DEFAULT 'manual' NOT NULL,
  admin            NUMBER(1)          DEFAULT 0 NOT NULL,
  ativo            NUMBER(1)          DEFAULT 1 NOT NULL,
  sincronizado_em  TIMESTAMP WITH LOCAL TIME ZONE,
  criado_em        TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  atualizado_em    TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_usuarios PRIMARY KEY (id),
  CONSTRAINT uq_usuarios_ad_object UNIQUE (ad_object_id),
  CONSTRAINT uq_usuarios_login UNIQUE (login),
  CONSTRAINT ck_usuarios_origem CHECK (origem IN ('ad','manual')),
  CONSTRAINT ck_usuarios_admin CHECK (admin IN (0,1)),
  CONSTRAINT ck_usuarios_ativo CHECK (ativo IN (0,1)),
  CONSTRAINT fk_usuarios_equipe FOREIGN KEY (equipe_id) REFERENCES equipes (id),
  CONSTRAINT fk_usuarios_perfil FOREIGN KEY (perfil_id) REFERENCES perfis_acesso (id)
);

CREATE INDEX ix_usuarios_email ON usuarios (email);
CREATE INDEX ix_usuarios_ativo ON usuarios (ativo);
CREATE INDEX ix_usuarios_equipe ON usuarios (equipe_id);

-- modulo_key / feature_key referenciam APP_MODULES e APP_FEATURES em
-- itsm-types.ts. Ficam em codigo de proposito: sao atrelados a rotas
-- e a checagens do app, nao sao dado de negocio.
CREATE TABLE perfil_modulos (
  perfil_id   VARCHAR2(36 CHAR) NOT NULL,
  modulo_key  VARCHAR2(60 CHAR) NOT NULL,
  CONSTRAINT pk_perfil_modulos PRIMARY KEY (perfil_id, modulo_key),
  CONSTRAINT fk_perfil_modulos_perfil FOREIGN KEY (perfil_id)
    REFERENCES perfis_acesso (id) ON DELETE CASCADE
);

CREATE TABLE perfil_features (
  perfil_id    VARCHAR2(36 CHAR) NOT NULL,
  feature_key  VARCHAR2(60 CHAR) NOT NULL,
  CONSTRAINT pk_perfil_features PRIMARY KEY (perfil_id, feature_key),
  CONSTRAINT fk_perfil_features_perfil FOREIGN KEY (perfil_id)
    REFERENCES perfis_acesso (id) ON DELETE CASCADE
);


-- ---------------------------------------------------------------------
-- 3. Catalogo, sistemas e conhecimento
-- ---------------------------------------------------------------------

CREATE TABLE servicos (
  id             VARCHAR2(36 CHAR)   NOT NULL,
  nome           VARCHAR2(200 CHAR)  NOT NULL,
  categoria_id   VARCHAR2(36 CHAR),
  descricao      VARCHAR2(1000 CHAR),
  tipo_padrao    VARCHAR2(20 CHAR)   NOT NULL,
  sla_horas      NUMBER(6)           NOT NULL,
  equipe_id      VARCHAR2(36 CHAR),
  gerado_por_ia  NUMBER(1)           DEFAULT 0 NOT NULL,
  ativo          NUMBER(1)           DEFAULT 1 NOT NULL,
  criado_em      TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  atualizado_em  TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_servicos PRIMARY KEY (id),
  CONSTRAINT ck_servicos_tipo CHECK (tipo_padrao IN
    ('incidente','requisicao','melhoria','problema','tarefa')),
  CONSTRAINT ck_servicos_sla CHECK (sla_horas > 0),
  CONSTRAINT ck_servicos_ia CHECK (gerado_por_ia IN (0,1)),
  CONSTRAINT ck_servicos_ativo CHECK (ativo IN (0,1)),
  CONSTRAINT fk_servicos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
  CONSTRAINT fk_servicos_equipe FOREIGN KEY (equipe_id) REFERENCES equipes (id)
);

CREATE INDEX ix_servicos_categoria ON servicos (categoria_id);
CREATE INDEX ix_servicos_ativo ON servicos (ativo);

CREATE TABLE sistemas (
  id              VARCHAR2(36 CHAR)   NOT NULL,
  nome            VARCHAR2(200 CHAR)  NOT NULL,
  descricao       VARCHAR2(1000 CHAR),
  categoria_id    VARCHAR2(36 CHAR),
  responsavel_id  VARCHAR2(36 CHAR),
  atribuicao_id   VARCHAR2(36 CHAR),
  equipe_id       VARCHAR2(36 CHAR),
  criticidade     VARCHAR2(10 CHAR)   NOT NULL,
  ativo           NUMBER(1)           DEFAULT 1 NOT NULL,
  CONSTRAINT pk_sistemas PRIMARY KEY (id),
  CONSTRAINT uq_sistemas_nome UNIQUE (nome),
  CONSTRAINT ck_sistemas_criticidade CHECK (criticidade IN ('alta','media','baixa')),
  CONSTRAINT ck_sistemas_ativo CHECK (ativo IN (0,1)),
  CONSTRAINT fk_sistemas_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
  CONSTRAINT fk_sistemas_responsavel FOREIGN KEY (responsavel_id) REFERENCES usuarios (id),
  CONSTRAINT fk_sistemas_atribuicao FOREIGN KEY (atribuicao_id) REFERENCES usuarios (id),
  CONSTRAINT fk_sistemas_equipe FOREIGN KEY (equipe_id) REFERENCES equipes (id)
);

CREATE INDEX ix_sistemas_responsavel ON sistemas (responsavel_id);
CREATE INDEX ix_sistemas_equipe ON sistemas (equipe_id);

CREATE TABLE artigos (
  id             VARCHAR2(36 CHAR)   NOT NULL,
  titulo         VARCHAR2(300 CHAR)  NOT NULL,   -- [TEXTO LIVRE]
  categoria_id   VARCHAR2(36 CHAR),
  resumo         VARCHAR2(1000 CHAR),            -- [TEXTO LIVRE]
  conteudo       CLOB                NOT NULL,   -- [TEXTO LIVRE]
  status         VARCHAR2(15 CHAR)   DEFAULT 'rascunho' NOT NULL,
  visualizacoes  NUMBER(10)          DEFAULT 0 NOT NULL,
  gerado_por_ia  NUMBER(1)           DEFAULT 0 NOT NULL,
  autor_id       VARCHAR2(36 CHAR),
  criado_em      TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  atualizado_em  TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_artigos PRIMARY KEY (id),
  CONSTRAINT ck_artigos_status CHECK (status IN ('publicado','revisar','rascunho')),
  CONSTRAINT ck_artigos_ia CHECK (gerado_por_ia IN (0,1)),
  CONSTRAINT fk_artigos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
  CONSTRAINT fk_artigos_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_artigos_status ON artigos (status);
CREATE INDEX ix_artigos_categoria ON artigos (categoria_id);


-- ---------------------------------------------------------------------
-- 4. Chamados
-- ---------------------------------------------------------------------

-- numero: identificador curto para humanos ("#1042"). Separado da PK
-- porque uuid nao serve para o usuario ler no telefone.
-- IDENTITY exige Oracle 12c+; aqui roda no 19c sem sequence manual.
CREATE TABLE chamados (
  id                     VARCHAR2(36 CHAR)  NOT NULL,
  numero                 NUMBER(12) GENERATED BY DEFAULT AS IDENTITY START WITH 1000,
  titulo                 VARCHAR2(300 CHAR) NOT NULL,   -- [TEXTO LIVRE]
  descricao              CLOB               NOT NULL,   -- [TEXTO LIVRE]
  tipo                   VARCHAR2(20 CHAR)  NOT NULL,
  categoria_id           VARCHAR2(36 CHAR),
  servico_id             VARCHAR2(36 CHAR),
  sistema_id             VARCHAR2(36 CHAR),
  impacto                VARCHAR2(10 CHAR)  NOT NULL,
  urgencia               VARCHAR2(10 CHAR)  NOT NULL,
  prioridade             VARCHAR2(2 CHAR)   NOT NULL,
  status                 VARCHAR2(20 CHAR)  DEFAULT 'novo' NOT NULL,
  solicitante_id         VARCHAR2(36 CHAR)  NOT NULL,
  responsavel_id         VARCHAR2(36 CHAR),
  equipe_id              VARCHAR2(36 CHAR),
  origem                 VARCHAR2(10 CHAR)  NOT NULL,
  problema_vinculado_id  VARCHAR2(36 CHAR),
  descricao_encerramento CLOB,                          -- [TEXTO LIVRE]
  criado_em              TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  prazo_resposta         TIMESTAMP WITH LOCAL TIME ZONE,
  prazo_sla              TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  respondido_em          TIMESTAMP WITH LOCAL TIME ZONE,
  resolvido_em           TIMESTAMP WITH LOCAL TIME ZONE,
  fechado_em             TIMESTAMP WITH LOCAL TIME ZONE,
  CONSTRAINT pk_chamados PRIMARY KEY (id),
  CONSTRAINT uq_chamados_numero UNIQUE (numero),
  CONSTRAINT ck_chamados_tipo CHECK (tipo IN
    ('incidente','requisicao','melhoria','problema','tarefa')),
  CONSTRAINT ck_chamados_impacto CHECK (impacto IN ('alto','medio','baixo')),
  CONSTRAINT ck_chamados_urgencia CHECK (urgencia IN ('alta','media','baixa')),
  CONSTRAINT ck_chamados_prioridade CHECK (prioridade IN ('P1','P2','P3','P4')),
  CONSTRAINT ck_chamados_status CHECK (status IN
    ('novo','triagem','em_andamento','aguardando','resolvido','fechado')),
  CONSTRAINT ck_chamados_origem CHECK (origem IN ('portal','ia','email','telefone')),
  CONSTRAINT fk_chamados_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
  CONSTRAINT fk_chamados_servico FOREIGN KEY (servico_id) REFERENCES servicos (id),
  CONSTRAINT fk_chamados_sistema FOREIGN KEY (sistema_id) REFERENCES sistemas (id),
  CONSTRAINT fk_chamados_solicitante FOREIGN KEY (solicitante_id) REFERENCES usuarios (id),
  CONSTRAINT fk_chamados_responsavel FOREIGN KEY (responsavel_id) REFERENCES usuarios (id),
  CONSTRAINT fk_chamados_equipe FOREIGN KEY (equipe_id) REFERENCES equipes (id),
  CONSTRAINT fk_chamados_problema FOREIGN KEY (problema_vinculado_id) REFERENCES chamados (id)
);

-- Indices desenhados para as telas existentes: fila por status,
-- painel de SLA, "meus chamados" e analise de recorrencia.
CREATE INDEX ix_chamados_status_prazo ON chamados (status, prazo_sla);
CREATE INDEX ix_chamados_responsavel ON chamados (responsavel_id, status);
CREATE INDEX ix_chamados_solicitante ON chamados (solicitante_id, criado_em);
CREATE INDEX ix_chamados_servico ON chamados (servico_id);
CREATE INDEX ix_chamados_sistema ON chamados (sistema_id);
CREATE INDEX ix_chamados_criado ON chamados (criado_em);
CREATE INDEX ix_chamados_equipe_status ON chamados (equipe_id, status);

-- Thread do chamado. tipo separa o que o solicitante ve (comentario)
-- do que so a TI ve (nota_interna).
CREATE TABLE chamado_interacoes (
  id          VARCHAR2(36 CHAR) NOT NULL,
  chamado_id  VARCHAR2(36 CHAR) NOT NULL,
  autor_id    VARCHAR2(36 CHAR),
  tipo        VARCHAR2(15 CHAR) NOT NULL,
  corpo       CLOB              NOT NULL,   -- [TEXTO LIVRE]
  criado_em   TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_chamado_interacoes PRIMARY KEY (id),
  CONSTRAINT ck_interacoes_tipo CHECK (tipo IN ('comentario','nota_interna','email')),
  CONSTRAINT fk_interacoes_chamado FOREIGN KEY (chamado_id)
    REFERENCES chamados (id) ON DELETE CASCADE,
  CONSTRAINT fk_interacoes_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_interacoes_chamado ON chamado_interacoes (chamado_id, criado_em);

-- Trilha de auditoria imutavel. Sustenta indicador de SLA, analise de
-- recorrencia e a pergunta "quem mudou a prioridade e quando".
-- Nunca sofre UPDATE nem DELETE.
CREATE TABLE chamado_historico (
  id              VARCHAR2(36 CHAR)  NOT NULL,
  chamado_id      VARCHAR2(36 CHAR)  NOT NULL,
  autor_id        VARCHAR2(36 CHAR),
  campo           VARCHAR2(60 CHAR)  NOT NULL,
  valor_anterior  VARCHAR2(500 CHAR),
  valor_novo      VARCHAR2(500 CHAR),
  criado_em       TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_chamado_historico PRIMARY KEY (id),
  CONSTRAINT fk_historico_chamado FOREIGN KEY (chamado_id)
    REFERENCES chamados (id) ON DELETE CASCADE,
  CONSTRAINT fk_historico_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_historico_chamado ON chamado_historico (chamado_id, criado_em);
CREATE INDEX ix_historico_campo ON chamado_historico (campo, criado_em);


-- ---------------------------------------------------------------------
-- 5. Recursos e capacidade
-- ---------------------------------------------------------------------

-- usuario_id opcional: permite cadastrar terceirizado sem conta no AD.
CREATE TABLE recursos (
  id                       VARCHAR2(36 CHAR)  NOT NULL,
  usuario_id               VARCHAR2(36 CHAR),
  nome                     VARCHAR2(200 CHAR) NOT NULL,
  papel                    VARCHAR2(120 CHAR),
  equipe_id                VARCHAR2(36 CHAR),
  horas_dia                NUMBER(4,2)        DEFAULT 8 NOT NULL,
  disponibilidade_projetos NUMBER(3)          DEFAULT 50 NOT NULL,
  ativo                    NUMBER(1)          DEFAULT 1 NOT NULL,
  CONSTRAINT pk_recursos PRIMARY KEY (id),
  CONSTRAINT uq_recursos_usuario UNIQUE (usuario_id),
  CONSTRAINT ck_recursos_horas CHECK (horas_dia > 0 AND horas_dia <= 24),
  CONSTRAINT ck_recursos_disp CHECK (disponibilidade_projetos BETWEEN 0 AND 100),
  CONSTRAINT ck_recursos_ativo CHECK (ativo IN (0,1)),
  CONSTRAINT fk_recursos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_recursos_equipe FOREIGN KEY (equipe_id) REFERENCES equipes (id)
);

CREATE INDEX ix_recursos_equipe ON recursos (equipe_id);


-- ---------------------------------------------------------------------
-- 6. Projetos
-- ---------------------------------------------------------------------

CREATE TABLE projetos (
  id             VARCHAR2(36 CHAR)  NOT NULL,
  nome           VARCHAR2(300 CHAR) NOT NULL,   -- [TEXTO LIVRE]
  objetivo       CLOB,                          -- [TEXTO LIVRE]
  sponsor_id     VARCHAR2(36 CHAR),
  gerente_id     VARCHAR2(36 CHAR),
  status         VARCHAR2(15 CHAR)  DEFAULT 'planejamento' NOT NULL,
  inicio         DATE               NOT NULL,
  fim            DATE               NOT NULL,
  criado_em      TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  atualizado_em  TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_projetos PRIMARY KEY (id),
  CONSTRAINT ck_projetos_status CHECK (status IN
    ('planejamento','execucao','paralisado','cancelado','concluido')),
  CONSTRAINT ck_projetos_periodo CHECK (fim >= inicio),
  CONSTRAINT fk_projetos_sponsor FOREIGN KEY (sponsor_id) REFERENCES usuarios (id),
  CONSTRAINT fk_projetos_gerente FOREIGN KEY (gerente_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_projetos_status ON projetos (status);
CREATE INDEX ix_projetos_gerente ON projetos (gerente_id);

-- pai_id monta a WBS (tarefa mae / tarefa filha).
-- ordem preserva a sequencia manual do cronograma, que array JSON dava
-- de graca e tabela nao.
CREATE TABLE projeto_tarefas (
  id               VARCHAR2(36 CHAR)  NOT NULL,
  projeto_id       VARCHAR2(36 CHAR)  NOT NULL,
  pai_id           VARCHAR2(36 CHAR),
  nome             VARCHAR2(300 CHAR) NOT NULL,   -- [TEXTO LIVRE]
  atividade        VARCHAR2(200 CHAR),
  inicio           DATE               NOT NULL,
  fim              DATE               NOT NULL,
  progresso        NUMBER(3)          DEFAULT 0 NOT NULL,
  quadro           VARCHAR2(10 CHAR)  DEFAULT 'backlog' NOT NULL,
  marco            NUMBER(1)          DEFAULT 0 NOT NULL,
  duracao          NUMBER(6,2),
  duracao_unidade  VARCHAR2(6 CHAR),
  alocacao_pct     NUMBER(3),
  ordem            NUMBER(6)          DEFAULT 0 NOT NULL,
  concluido_em     TIMESTAMP WITH LOCAL TIME ZONE,
  CONSTRAINT pk_projeto_tarefas PRIMARY KEY (id),
  CONSTRAINT ck_tarefas_progresso CHECK (progresso BETWEEN 0 AND 100),
  CONSTRAINT ck_tarefas_quadro CHECK (quadro IN ('backlog','todo','doing','done')),
  CONSTRAINT ck_tarefas_marco CHECK (marco IN (0,1)),
  CONSTRAINT ck_tarefas_unidade CHECK (duracao_unidade IS NULL OR duracao_unidade IN ('dias','horas')),
  CONSTRAINT ck_tarefas_alocacao CHECK (alocacao_pct IS NULL OR alocacao_pct BETWEEN 0 AND 100),
  CONSTRAINT ck_tarefas_periodo CHECK (fim >= inicio),
  CONSTRAINT ck_tarefas_pai_self CHECK (pai_id <> id),
  CONSTRAINT fk_tarefas_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE,
  CONSTRAINT fk_tarefas_pai FOREIGN KEY (pai_id)
    REFERENCES projeto_tarefas (id) ON DELETE CASCADE
);

CREATE INDEX ix_tarefas_projeto ON projeto_tarefas (projeto_id, ordem);
CREATE INDEX ix_tarefas_quadro ON projeto_tarefas (projeto_id, quadro);
CREATE INDEX ix_tarefas_pai ON projeto_tarefas (pai_id);

-- Substitui ProjectTask.responsaveis[]
CREATE TABLE tarefa_responsaveis (
  tarefa_id   VARCHAR2(36 CHAR) NOT NULL,
  recurso_id  VARCHAR2(36 CHAR) NOT NULL,
  principal   NUMBER(1)         DEFAULT 0 NOT NULL,
  CONSTRAINT pk_tarefa_responsaveis PRIMARY KEY (tarefa_id, recurso_id),
  CONSTRAINT ck_tresp_principal CHECK (principal IN (0,1)),
  CONSTRAINT fk_tresp_tarefa FOREIGN KEY (tarefa_id)
    REFERENCES projeto_tarefas (id) ON DELETE CASCADE,
  CONSTRAINT fk_tresp_recurso FOREIGN KEY (recurso_id) REFERENCES recursos (id)
);

CREATE INDEX ix_tresp_recurso ON tarefa_responsaveis (recurso_id);

-- Substitui ProjectTask.predecessoras[]
CREATE TABLE tarefa_predecessoras (
  tarefa_id        VARCHAR2(36 CHAR) NOT NULL,
  predecessora_id  VARCHAR2(36 CHAR) NOT NULL,
  CONSTRAINT pk_tarefa_predecessoras PRIMARY KEY (tarefa_id, predecessora_id),
  CONSTRAINT ck_tpred_self CHECK (tarefa_id <> predecessora_id),
  CONSTRAINT fk_tpred_tarefa FOREIGN KEY (tarefa_id)
    REFERENCES projeto_tarefas (id) ON DELETE CASCADE,
  CONSTRAINT fk_tpred_pred FOREIGN KEY (predecessora_id)
    REFERENCES projeto_tarefas (id)
);

CREATE INDEX ix_tpred_pred ON tarefa_predecessoras (predecessora_id);

CREATE TABLE projeto_atualizacoes (
  id                 VARCHAR2(36 CHAR) NOT NULL,
  projeto_id         VARCHAR2(36 CHAR) NOT NULL,
  autor_id           VARCHAR2(36 CHAR),
  data_ref           DATE              NOT NULL,
  descricao          CLOB,                        -- [TEXTO LIVRE]
  ultimas_entregas   CLOB,                        -- [TEXTO LIVRE]
  proximas_entregas  CLOB,                        -- [TEXTO LIVRE]
  criado_em          TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_projeto_atualizacoes PRIMARY KEY (id),
  CONSTRAINT fk_patual_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE,
  CONSTRAINT fk_patual_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_patual_projeto ON projeto_atualizacoes (projeto_id, data_ref);

CREATE TABLE projeto_riscos (
  id             VARCHAR2(36 CHAR) NOT NULL,
  projeto_id     VARCHAR2(36 CHAR) NOT NULL,
  descricao      CLOB              NOT NULL,   -- [TEXTO LIVRE]
  probabilidade  VARCHAR2(10 CHAR) NOT NULL,
  impacto        VARCHAR2(10 CHAR) NOT NULL,
  mitigacao      CLOB,                         -- [TEXTO LIVRE]
  status         VARCHAR2(12 CHAR) DEFAULT 'aberto' NOT NULL,
  criado_em      TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  CONSTRAINT pk_projeto_riscos PRIMARY KEY (id),
  CONSTRAINT ck_riscos_prob CHECK (probabilidade IN ('alta','media','baixa')),
  CONSTRAINT ck_riscos_impacto CHECK (impacto IN ('alto','medio','baixo')),
  CONSTRAINT ck_riscos_status CHECK (status IN ('aberto','monitorado','mitigado')),
  CONSTRAINT fk_riscos_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE
);

CREATE INDEX ix_riscos_projeto ON projeto_riscos (projeto_id, status);

CREATE TABLE projeto_atencoes (
  id                      VARCHAR2(36 CHAR)  NOT NULL,
  projeto_id              VARCHAR2(36 CHAR)  NOT NULL,
  titulo                  VARCHAR2(300 CHAR) NOT NULL,   -- [TEXTO LIVRE]
  descricao               CLOB,                          -- [TEXTO LIVRE]
  decisao_necessaria      CLOB,                          -- [TEXTO LIVRE]
  responsavel_decisao_id  VARCHAR2(36 CHAR),
  status                  VARCHAR2(12 CHAR)  DEFAULT 'aberto' NOT NULL,
  criado_em               TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  resolvido_em            TIMESTAMP WITH LOCAL TIME ZONE,
  CONSTRAINT pk_projeto_atencoes PRIMARY KEY (id),
  CONSTRAINT ck_atencoes_status CHECK (status IN ('aberto','resolvido')),
  CONSTRAINT fk_atencoes_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE,
  CONSTRAINT fk_atencoes_responsavel FOREIGN KEY (responsavel_decisao_id)
    REFERENCES usuarios (id)
);

CREATE INDEX ix_atencoes_projeto ON projeto_atencoes (projeto_id, status);


-- ---------------------------------------------------------------------
-- 7. Notificacoes
-- ---------------------------------------------------------------------

-- referencia_tipo + referencia_id apontam para chamado ou projeto sem
-- FK polimorfica (que nenhum banco valida bem).
CREATE TABLE notificacoes (
  id                  VARCHAR2(36 CHAR)   NOT NULL,
  tipo                VARCHAR2(30 CHAR)   NOT NULL,
  destinatario_id     VARCHAR2(36 CHAR),
  destinatario_email  VARCHAR2(320 CHAR)  NOT NULL,
  assunto             VARCHAR2(300 CHAR)  NOT NULL,   -- [TEXTO LIVRE]
  corpo               CLOB,                           -- [TEXTO LIVRE]
  referencia_tipo     VARCHAR2(20 CHAR),
  referencia_id       VARCHAR2(36 CHAR),
  status              VARCHAR2(12 CHAR)   DEFAULT 'pendente' NOT NULL,
  tentativas          NUMBER(4)           DEFAULT 0 NOT NULL,
  erro                VARCHAR2(1000 CHAR),
  criado_em           TIMESTAMP WITH LOCAL TIME ZONE NOT NULL,
  enviado_em          TIMESTAMP WITH LOCAL TIME ZONE,
  CONSTRAINT pk_notificacoes PRIMARY KEY (id),
  CONSTRAINT ck_notif_tipo CHECK (tipo IN
    ('chamado_status','chamado_criado','projeto_lembrete')),
  CONSTRAINT ck_notif_status CHECK (status IN ('pendente','enviado','erro')),
  CONSTRAINT ck_notif_referencia CHECK (referencia_tipo IS NULL
    OR referencia_tipo IN ('chamado','projeto')),
  CONSTRAINT fk_notif_destinatario FOREIGN KEY (destinatario_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_notif_status ON notificacoes (status, criado_em);
CREATE INDEX ix_notif_referencia ON notificacoes (referencia_tipo, referencia_id);