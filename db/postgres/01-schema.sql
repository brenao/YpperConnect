-- =====================================================================
-- YpperConnect - Schema PostgreSQL 18
-- Servidor: rosset96 (teste) / rosset97 (producao) - banco `ypper`
--
-- Traducao do schema Oracle (db/oracle/*.sql), com os ajustes que la
-- vieram em arquivos separados (04, 06, 07, 09) ja embutidos: aqui o
-- banco nasce do zero, nao ha nada para alterar depois.
--
-- CONVENCOES E POR QUE CADA UMA
--   - VARCHAR(n): o Oracle usava VARCHAR2(n CHAR). No Postgres a
--     semantica ja e de caractere, entao o `CHAR` some. Os limites
--     foram mantidos de proposito: sao validacao de dominio, nao
--     economia de disco.
--   - CLOB -> TEXT.
--   - Booleano: SMALLINT 0/1 com CHECK, e NAO o BOOLEAN nativo.
--     Motivo: a aplicacao le e grava 0/1 em dezenas de consultas
--     (`WHERE ativo = 1`). Trocar para BOOLEAN agora obrigaria a mexer
--     em todas elas no mesmo passo da migracao de banco - dois riscos
--     somados. Fica como melhoria posterior, isolada.
--   - Instante no tempo: TIMESTAMP (sem fuso), igual ao Oracle.
--     Data pura (cronograma): DATE.
--     ATENCAO: nao trocar para TIMESTAMPTZ sem revisar o app. O
--     Oracle usava TIMESTAMP puro justamente porque o driver deslocava
--     o SLA em 3 horas com tipo com fuso; o mesmo cuidado vale aqui.
--   - Enum de negocio ITIL: CHECK constraint (mudar exige mudar
--     codigo). Lista administravel: tabela (equipes, categorias).
--   - Toda relacao e por ID. Nenhuma coluna guarda nome de pessoa.
--
-- DIFERENCA DE COMPORTAMENTO QUE O CODIGO PRECISA RESPEITAR
--   No Oracle, string vazia E nulo. No Postgres, '' e um valor. A
--   camada de acesso continua convertendo '' para NULL antes do
--   insert; sem isso, uma coluna NOT NULL passaria a aceitar '' e o
--   dado ficaria diferente do que era em Oracle, sem erro nenhum.
--
-- APLICAR (de dentro do servidor, com o container de pe):
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     -v ON_ERROR_STOP=1 < 01-schema.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- Dono das tabelas: SEMPRE `ypper`, nao importa quem aplicou.
--
-- Na primeira tentativa este arquivo rodou como `postgres`, e as 25
-- tabelas nasceram dele. Resultado: a aplicacao levou "permission
-- denied" em tudo, porque o GRANT existente e o ALTER DEFAULT
-- PRIVILEGES do grants.sql valem para o que o `ypper` cria - nao para
-- o que o `postgres` criou.
--
-- Pior, e silencioso: ALTER TABLE e DROP TABLE so o dono pode, e nao
-- existe GRANT que substitua isso. A migration seguinte quebraria num
-- deploy, semanas depois.
--
-- O SET ROLE abaixo fecha essa porta. Funciona tanto para o superuser
-- `postgres` quanto para um dev do grupo `devs` (que ja e membro de
-- `ypper`). Se quem rodar nao for membro, o comando falha AQUI, com
-- mensagem clara, antes de criar qualquer coisa.
-- ---------------------------------------------------------------------
SET ROLE ypper;


-- ---------------------------------------------------------------------
-- 1. Listas administraveis
-- ---------------------------------------------------------------------

CREATE TABLE equipes (
  id     VARCHAR(36)  NOT NULL,
  nome   VARCHAR(120) NOT NULL,
  ativo  SMALLINT     DEFAULT 1 NOT NULL,
  CONSTRAINT pk_equipes PRIMARY KEY (id),
  CONSTRAINT uq_equipes_nome UNIQUE (nome),
  CONSTRAINT ck_equipes_ativo CHECK (ativo IN (0,1))
);

CREATE TABLE categorias (
  id      VARCHAR(36)  NOT NULL,
  nome    VARCHAR(120) NOT NULL,
  escopo  VARCHAR(20)  NOT NULL,
  ativo   SMALLINT     DEFAULT 1 NOT NULL,
  CONSTRAINT pk_categorias PRIMARY KEY (id),
  CONSTRAINT uq_categorias_escopo_nome UNIQUE (escopo, nome),
  CONSTRAINT ck_categorias_escopo CHECK (escopo IN ('chamado','servico','artigo','sistema')),
  CONSTRAINT ck_categorias_ativo CHECK (ativo IN (0,1))
);


-- ---------------------------------------------------------------------
-- 2. Identidade e autorizacao
-- ---------------------------------------------------------------------

-- `sistema` marca o perfil embutido na aplicacao, que a tela de
-- permissoes nao pode excluir. No Oracle veio no 04-ajustes.sql.
CREATE TABLE perfis_acesso (
  id         VARCHAR(36)  NOT NULL,
  nome       VARCHAR(120) NOT NULL,
  descricao  VARCHAR(500),
  ativo      SMALLINT     DEFAULT 1 NOT NULL,
  sistema    SMALLINT     DEFAULT 0 NOT NULL,
  CONSTRAINT pk_perfis_acesso PRIMARY KEY (id),
  CONSTRAINT uq_perfis_acesso_nome UNIQUE (nome),
  CONSTRAINT ck_perfis_acesso_ativo CHECK (ativo IN (0,1)),
  CONSTRAINT ck_perfis_sistema CHECK (sistema IN (0,1))
);

-- ad_object_id: objectGUID do AD (ou claim "oid" do Entra ID).
-- Unica chave estavel de uma pessoa. Login, email e nome mudam.
-- Fica nulo enquanto a autenticacao nao for implementada.
CREATE TABLE usuarios (
  id               VARCHAR(36)  NOT NULL,
  ad_object_id     VARCHAR(64),
  nome             VARCHAR(200) NOT NULL,
  email            VARCHAR(320) NOT NULL,
  login            VARCHAR(120) NOT NULL,
  departamento     VARCHAR(160),
  equipe_id        VARCHAR(36),
  perfil_id        VARCHAR(36),
  origem           VARCHAR(10)  DEFAULT 'manual' NOT NULL,
  admin            SMALLINT     DEFAULT 0 NOT NULL,
  ativo            SMALLINT     DEFAULT 1 NOT NULL,
  sincronizado_em  TIMESTAMP,
  criado_em        TIMESTAMP NOT NULL,
  atualizado_em    TIMESTAMP NOT NULL,
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
  perfil_id   VARCHAR(36) NOT NULL,
  modulo_key  VARCHAR(60) NOT NULL,
  CONSTRAINT pk_perfil_modulos PRIMARY KEY (perfil_id, modulo_key),
  CONSTRAINT fk_perfil_modulos_perfil FOREIGN KEY (perfil_id)
    REFERENCES perfis_acesso (id) ON DELETE CASCADE
);

CREATE TABLE perfil_features (
  perfil_id    VARCHAR(36) NOT NULL,
  feature_key  VARCHAR(60) NOT NULL,
  CONSTRAINT pk_perfil_features PRIMARY KEY (perfil_id, feature_key),
  CONSTRAINT fk_perfil_features_perfil FOREIGN KEY (perfil_id)
    REFERENCES perfis_acesso (id) ON DELETE CASCADE
);


-- ---------------------------------------------------------------------
-- 3. Catalogo, sistemas e conhecimento
-- ---------------------------------------------------------------------

CREATE TABLE servicos (
  id             VARCHAR(36)   NOT NULL,
  nome           VARCHAR(200)  NOT NULL,
  categoria_id   VARCHAR(36),
  descricao      VARCHAR(1000),
  tipo_padrao    VARCHAR(20)   NOT NULL,
  sla_horas      INTEGER       NOT NULL,
  equipe_id      VARCHAR(36),
  gerado_por_ia  SMALLINT      DEFAULT 0 NOT NULL,
  ativo          SMALLINT      DEFAULT 1 NOT NULL,
  criado_em      TIMESTAMP NOT NULL,
  atualizado_em  TIMESTAMP NOT NULL,
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
  id              VARCHAR(36)   NOT NULL,
  nome            VARCHAR(200)  NOT NULL,
  descricao       VARCHAR(1000),
  categoria_id    VARCHAR(36),
  responsavel_id  VARCHAR(36),
  atribuicao_id   VARCHAR(36),
  equipe_id       VARCHAR(36),
  criticidade     VARCHAR(10)   NOT NULL,
  ativo           SMALLINT      DEFAULT 1 NOT NULL,
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
  id             VARCHAR(36)   NOT NULL,
  titulo         VARCHAR(300)  NOT NULL,
  categoria_id   VARCHAR(36),
  resumo         VARCHAR(1000),
  conteudo       TEXT          NOT NULL,
  status         VARCHAR(15)   DEFAULT 'rascunho' NOT NULL,
  visualizacoes  INTEGER       DEFAULT 0 NOT NULL,
  gerado_por_ia  SMALLINT      DEFAULT 0 NOT NULL,
  autor_id       VARCHAR(36),
  criado_em      TIMESTAMP NOT NULL,
  atualizado_em  TIMESTAMP NOT NULL,
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
--
-- prefixo (Oracle: 07-codigo-chamado.sql) e coluna real, gravada na
-- abertura e NUNCA alterada. Se o chamado for reclassificado, o codigo
-- permanece - ele ja circulou por e-mail e foi citado pelo solicitante.
--
-- codigo e coluna gerada. No Oracle era VIRTUAL (calculada na leitura);
-- no Postgres usamos STORED, que e o que a versao suporta para coluna
-- gerada indexavel. Custa alguns bytes por linha e nada mais.
CREATE TABLE chamados (
  id                     VARCHAR(36)  NOT NULL,
  numero                 BIGINT GENERATED BY DEFAULT AS IDENTITY (START WITH 1000),
  prefixo                VARCHAR(4)   NOT NULL,
  codigo                 VARCHAR(24)  GENERATED ALWAYS AS (prefixo || '-' || numero::text) STORED,
  titulo                 VARCHAR(300) NOT NULL,
  descricao              TEXT         NOT NULL,
  tipo                   VARCHAR(20)  NOT NULL,
  categoria_id           VARCHAR(36),
  servico_id             VARCHAR(36),
  sistema_id             VARCHAR(36),
  impacto                VARCHAR(10)  NOT NULL,
  urgencia               VARCHAR(10)  NOT NULL,
  prioridade             VARCHAR(2)   NOT NULL,
  status                 VARCHAR(20)  DEFAULT 'novo' NOT NULL,
  solicitante_id         VARCHAR(36)  NOT NULL,
  responsavel_id         VARCHAR(36),
  equipe_id              VARCHAR(36),
  origem                 VARCHAR(10)  NOT NULL,
  problema_vinculado_id  VARCHAR(36),
  descricao_encerramento TEXT,
  criado_em              TIMESTAMP NOT NULL,
  atualizado_em          TIMESTAMP NOT NULL,
  prazo_resposta         TIMESTAMP,
  prazo_sla              TIMESTAMP NOT NULL,
  respondido_em          TIMESTAMP,
  resolvido_em           TIMESTAMP,
  fechado_em             TIMESTAMP,
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

CREATE UNIQUE INDEX ux_chamados_codigo ON chamados (codigo);

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
  id          VARCHAR(36) NOT NULL,
  chamado_id  VARCHAR(36) NOT NULL,
  autor_id    VARCHAR(36),
  tipo        VARCHAR(15) NOT NULL,
  corpo       TEXT        NOT NULL,
  criado_em   TIMESTAMP NOT NULL,
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
  id              VARCHAR(36)  NOT NULL,
  chamado_id      VARCHAR(36)  NOT NULL,
  autor_id        VARCHAR(36),
  campo           VARCHAR(60)  NOT NULL,
  valor_anterior  VARCHAR(500),
  valor_novo      VARCHAR(500),
  criado_em       TIMESTAMP NOT NULL,
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
  id                       VARCHAR(36)  NOT NULL,
  usuario_id               VARCHAR(36),
  nome                     VARCHAR(200) NOT NULL,
  papel                    VARCHAR(120),
  equipe_id                VARCHAR(36),
  horas_dia                NUMERIC(4,2) DEFAULT 8 NOT NULL,
  disponibilidade_projetos SMALLINT     DEFAULT 50 NOT NULL,
  ativo                    SMALLINT     DEFAULT 1 NOT NULL,
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
  id             VARCHAR(36)  NOT NULL,
  nome           VARCHAR(300) NOT NULL,
  objetivo       TEXT,
  sponsor_id     VARCHAR(36),
  gerente_id     VARCHAR(36),
  status         VARCHAR(15)  DEFAULT 'planejamento' NOT NULL,
  inicio         DATE         NOT NULL,
  fim            DATE         NOT NULL,
  criado_em      TIMESTAMP NOT NULL,
  atualizado_em  TIMESTAMP NOT NULL,
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
  id               VARCHAR(36)  NOT NULL,
  projeto_id       VARCHAR(36)  NOT NULL,
  pai_id           VARCHAR(36),
  nome             VARCHAR(300) NOT NULL,
  atividade        VARCHAR(200),
  inicio           DATE         NOT NULL,
  fim              DATE         NOT NULL,
  progresso        SMALLINT     DEFAULT 0 NOT NULL,
  quadro           VARCHAR(10)  DEFAULT 'backlog' NOT NULL,
  marco            SMALLINT     DEFAULT 0 NOT NULL,
  duracao          NUMERIC(6,2),
  duracao_unidade  VARCHAR(6),
  alocacao_pct     SMALLINT,
  ordem            INTEGER      DEFAULT 0 NOT NULL,
  concluido_em     TIMESTAMP,
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
  tarefa_id   VARCHAR(36) NOT NULL,
  recurso_id  VARCHAR(36) NOT NULL,
  principal   SMALLINT    DEFAULT 0 NOT NULL,
  CONSTRAINT pk_tarefa_responsaveis PRIMARY KEY (tarefa_id, recurso_id),
  CONSTRAINT ck_tresp_principal CHECK (principal IN (0,1)),
  CONSTRAINT fk_tresp_tarefa FOREIGN KEY (tarefa_id)
    REFERENCES projeto_tarefas (id) ON DELETE CASCADE,
  CONSTRAINT fk_tresp_recurso FOREIGN KEY (recurso_id) REFERENCES recursos (id)
);

CREATE INDEX ix_tresp_recurso ON tarefa_responsaveis (recurso_id);

-- Substitui ProjectTask.predecessoras[]
CREATE TABLE tarefa_predecessoras (
  tarefa_id        VARCHAR(36) NOT NULL,
  predecessora_id  VARCHAR(36) NOT NULL,
  CONSTRAINT pk_tarefa_predecessoras PRIMARY KEY (tarefa_id, predecessora_id),
  CONSTRAINT ck_tpred_self CHECK (tarefa_id <> predecessora_id),
  CONSTRAINT fk_tpred_tarefa FOREIGN KEY (tarefa_id)
    REFERENCES projeto_tarefas (id) ON DELETE CASCADE,
  CONSTRAINT fk_tpred_pred FOREIGN KEY (predecessora_id)
    REFERENCES projeto_tarefas (id)
);

CREATE INDEX ix_tpred_pred ON tarefa_predecessoras (predecessora_id);

CREATE TABLE projeto_atualizacoes (
  id                 VARCHAR(36) NOT NULL,
  projeto_id         VARCHAR(36) NOT NULL,
  autor_id           VARCHAR(36),
  data_ref           DATE        NOT NULL,
  descricao          TEXT,
  ultimas_entregas   TEXT,
  proximas_entregas  TEXT,
  criado_em          TIMESTAMP NOT NULL,
  CONSTRAINT pk_projeto_atualizacoes PRIMARY KEY (id),
  CONSTRAINT fk_patual_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE,
  CONSTRAINT fk_patual_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id)
);

CREATE INDEX ix_patual_projeto ON projeto_atualizacoes (projeto_id, data_ref);

CREATE TABLE projeto_riscos (
  id             VARCHAR(36) NOT NULL,
  projeto_id     VARCHAR(36) NOT NULL,
  descricao      TEXT        NOT NULL,
  probabilidade  VARCHAR(10) NOT NULL,
  impacto        VARCHAR(10) NOT NULL,
  mitigacao      TEXT,
  status         VARCHAR(12) DEFAULT 'aberto' NOT NULL,
  criado_em      TIMESTAMP NOT NULL,
  CONSTRAINT pk_projeto_riscos PRIMARY KEY (id),
  CONSTRAINT ck_riscos_prob CHECK (probabilidade IN ('alta','media','baixa')),
  CONSTRAINT ck_riscos_impacto CHECK (impacto IN ('alto','medio','baixo')),
  CONSTRAINT ck_riscos_status CHECK (status IN ('aberto','monitorado','mitigado')),
  CONSTRAINT fk_riscos_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE
);

CREATE INDEX ix_riscos_projeto ON projeto_riscos (projeto_id, status);

CREATE TABLE projeto_atencoes (
  id                      VARCHAR(36)  NOT NULL,
  projeto_id              VARCHAR(36)  NOT NULL,
  titulo                  VARCHAR(300) NOT NULL,
  descricao               TEXT,
  decisao_necessaria      TEXT,
  responsavel_decisao_id  VARCHAR(36),
  status                  VARCHAR(12)  DEFAULT 'aberto' NOT NULL,
  criado_em               TIMESTAMP NOT NULL,
  resolvido_em            TIMESTAMP,
  CONSTRAINT pk_projeto_atencoes PRIMARY KEY (id),
  CONSTRAINT ck_atencoes_status CHECK (status IN ('aberto','resolvido')),
  CONSTRAINT fk_atencoes_projeto FOREIGN KEY (projeto_id)
    REFERENCES projetos (id) ON DELETE CASCADE,
  CONSTRAINT fk_atencoes_responsavel FOREIGN KEY (responsavel_decisao_id)
    REFERENCES usuarios (id)
);

CREATE INDEX ix_atencoes_projeto ON projeto_atencoes (projeto_id, status);

-- Baseline (Oracle: 09-baseline.sql): a foto do cronograma no momento
-- em que foi aprovado. Sem ela nao existe "progresso esperado" nem
-- desvio - so da para dizer onde o projeto esta, nunca se esta
-- atrasado em relacao ao combinado.
--
-- Guardamos por versao: replanejamento e evento de governanca, e a
-- comparacao com a PRIMEIRA baseline e o que revela derrapagem
-- acumulada. Sobrescrever apagaria justamente essa evidencia.
CREATE TABLE projeto_baselines (
  id           VARCHAR(36)  NOT NULL,
  projeto_id   VARCHAR(36)  NOT NULL,
  versao       SMALLINT     NOT NULL,
  descricao    VARCHAR(500),
  autor_id     VARCHAR(36),
  criado_em    TIMESTAMP    NOT NULL,
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
  baseline_id  VARCHAR(36)  NOT NULL,
  tarefa_id    VARCHAR(36)  NOT NULL,
  nome         VARCHAR(300) NOT NULL,
  inicio       DATE         NOT NULL,
  fim          DATE         NOT NULL,
  CONSTRAINT pk_baseline_tarefas PRIMARY KEY (baseline_id, tarefa_id),
  CONSTRAINT fk_bt_baseline FOREIGN KEY (baseline_id)
    REFERENCES projeto_baselines (id) ON DELETE CASCADE
);


-- ---------------------------------------------------------------------
-- 7. Notificacoes
-- ---------------------------------------------------------------------

-- referencia_tipo + referencia_id apontam para chamado ou projeto sem
-- FK polimorfica (que nenhum banco valida bem).
CREATE TABLE notificacoes (
  id                  VARCHAR(36)   NOT NULL,
  tipo                VARCHAR(30)   NOT NULL,
  destinatario_id     VARCHAR(36),
  destinatario_email  VARCHAR(320)  NOT NULL,
  assunto             VARCHAR(300)  NOT NULL,
  corpo               TEXT,
  referencia_tipo     VARCHAR(20),
  referencia_id       VARCHAR(36),
  status              VARCHAR(12)   DEFAULT 'pendente' NOT NULL,
  tentativas          SMALLINT      DEFAULT 0 NOT NULL,
  erro                VARCHAR(1000),
  criado_em           TIMESTAMP NOT NULL,
  enviado_em          TIMESTAMP,
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


-- ---------------------------------------------------------------------
-- 8. Calendario de atendimento (SLA em horario comercial)
-- ---------------------------------------------------------------------
--
-- MODELO: cada linha de `expediente` e uma faixa continua de trabalho.
-- O intervalo de almoco nao e uma coluna: e a lacuna entre a faixa da
-- manha e a da tarde. Isso permite jornadas irregulares (sabado ate
-- meio-dia, turno unico em algum dia) sem mudar o schema.
--
-- HORARIO EM MINUTOS: o Postgres tem tipo TIME, mas mantivemos minutos
-- desde a meia-noite (0-1440) porque o calculo de SLA na aplicacao ja
-- faz aritmetica direta com esses numeros. Mudar o tipo aqui mexeria
-- em sla.server.ts sem ganho nenhum agora.
-- 08:00 = 480, 12:00 = 720, 14:00 = 840, 18:00 = 1080.

CREATE TABLE expediente (
  id           VARCHAR(36) NOT NULL,
  dia_semana   SMALLINT    NOT NULL,
  minuto_ini   SMALLINT    NOT NULL,
  minuto_fim   SMALLINT    NOT NULL,
  ativo        SMALLINT    DEFAULT 1 NOT NULL,
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
-- por mes e dia atraves das colunas gerada abaixo.
-- recorrente = 0: data movel (Carnaval, Pascoa) ou ponto facultativo
-- especifico daquele ano. Precisa ser cadastrado ano a ano.
CREATE TABLE feriados (
  id             VARCHAR(36)  NOT NULL,
  data_feriado   DATE         NOT NULL,
  descricao      VARCHAR(200) NOT NULL,
  tipo           VARCHAR(12)  DEFAULT 'nacional' NOT NULL,
  recorrente     SMALLINT     DEFAULT 0 NOT NULL,
  ativo          SMALLINT     DEFAULT 1 NOT NULL,
  mes            SMALLINT GENERATED ALWAYS AS (EXTRACT(MONTH FROM data_feriado)::smallint) STORED,
  dia            SMALLINT GENERATED ALWAYS AS (EXTRACT(DAY FROM data_feriado)::smallint) STORED,
  CONSTRAINT pk_feriados PRIMARY KEY (id),
  CONSTRAINT uq_feriados_data UNIQUE (data_feriado),
  CONSTRAINT ck_feriados_tipo CHECK (tipo IN
    ('nacional','estadual','municipal','facultativo')),
  CONSTRAINT ck_feriados_recorrente CHECK (recorrente IN (0,1)),
  CONSTRAINT ck_feriados_ativo CHECK (ativo IN (0,1))
);

CREATE INDEX ix_feriados_data ON feriados (data_feriado, ativo);
CREATE INDEX ix_feriados_recorrente ON feriados (recorrente, mes, dia, ativo);
