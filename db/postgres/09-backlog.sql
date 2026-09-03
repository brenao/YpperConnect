-- =====================================================================
-- 09 - Backlog de demandas e priorizacao
--
-- Ate aqui todo projeto nascia em "planejamento", o que pressupoe que
-- ele vai ser executado. A lista real de um CIO nao e essa: a maior
-- parte do que chega ainda nao foi decidida, e forcar essas demandas
-- para dentro do fluxo de execucao produzia projeto sem tarefa
-- cobrando acompanhamento semanal e sendo acusado de "sem baseline".
--
-- O status `backlog` e a etapa anterior: o que foi pedido mas ainda
-- nao foi priorizado. Nao cobra acompanhamento, nao entra na
-- capacidade e nao mostra prazo - porque nao tem.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/09-backlog.sql
-- =====================================================================

SET ROLE ypper;

-- ---------------------------------------------------------------------
-- 1. Status novo
--
-- CHECK e recriado, nao alterado: o Postgres nao tem ALTER CONSTRAINT
-- para mudar a expressao. Nenhuma linha existente vira invalida, entao
-- a recriacao passa sem varredura demorada.
-- ---------------------------------------------------------------------
ALTER TABLE projetos DROP CONSTRAINT ck_projetos_status;

ALTER TABLE projetos ADD CONSTRAINT ck_projetos_status CHECK (status IN
  ('backlog','planejamento','execucao','paralisado','cancelado','concluido'));


-- ---------------------------------------------------------------------
-- 2. Campos de priorizacao
--
-- Todos anulaveis: projeto que ja existe nao foi pontuado, e inventar
-- um valor padrao daria a ele uma posicao no ranking que ninguem
-- decidiu.
--
-- `valor` serve aos dois modelos: e a nota de 1 a 5 no modelo simples e
-- o "impacto" do RICE. Sao a mesma pergunta - quanto isso muda o
-- negocio - e duas colunas para ela divergiriam.
--
-- `esforco` tambem e compartilhado. No modelo simples a tela oferece
-- P/M/G e grava 1, 3 ou 9; no RICE aceita pessoa-dias direto. Em ambos
-- e o divisor do score, e por isso NUMERIC em vez de texto.
-- ---------------------------------------------------------------------
ALTER TABLE projetos
  ADD COLUMN valor            SMALLINT,
  ADD COLUMN esforco          NUMERIC(7,2),
  ADD COLUMN alcance          INTEGER,
  ADD COLUMN confianca        SMALLINT,
  ADD COLUMN ordem_backlog    INTEGER,
  ADD COLUMN area_demandante  VARCHAR(160),
  ADD COLUMN justificativa    TEXT;

ALTER TABLE projetos
  ADD CONSTRAINT ck_projetos_valor CHECK (valor IS NULL OR valor BETWEEN 1 AND 5),
  ADD CONSTRAINT ck_projetos_esforco CHECK (esforco IS NULL OR esforco > 0),
  ADD CONSTRAINT ck_projetos_alcance CHECK (alcance IS NULL OR alcance >= 0),
  ADD CONSTRAINT ck_projetos_confianca CHECK (confianca IS NULL OR confianca BETWEEN 0 AND 100);

-- A lista do backlog e sempre "status = backlog ordenado pela mao do
-- gestor". O indice cobre exatamente essa leitura.
CREATE INDEX ix_projetos_backlog ON projetos (status, ordem_backlog);


-- ---------------------------------------------------------------------
-- 3. Configuracoes da instalacao
--
-- Tabela generica de chave/valor. Nasce por causa do modelo de
-- priorizacao, mas a falta dela ja se sentia: o numero de dias sem
-- atualizacao que dispara lembrete, por exemplo, esta fixo em codigo.
--
-- Valor como VARCHAR e nao JSON de proposito: sao ajustes escalares
-- lidos por uma tela de administracao, e JSON aqui viraria estrutura
-- sem esquema que ninguem valida.
-- ---------------------------------------------------------------------
CREATE TABLE configuracoes (
  chave          VARCHAR(60)  NOT NULL,
  valor          VARCHAR(500) NOT NULL,
  descricao      VARCHAR(300),
  atualizado_em  TIMESTAMP    NOT NULL,
  CONSTRAINT pk_configuracoes PRIMARY KEY (chave)
);

-- 'simples' e o padrao porque e o que uma equipe consegue preencher de
-- verdade. RICE tem quatro variaveis, e formulario que ninguem preenche
-- direito produz numero com aparencia de precisao.
INSERT INTO configuracoes (chave, valor, descricao, atualizado_em) VALUES
  ('priorizacao_modelo', 'simples',
   'Modelo de pontuacao do backlog: simples (valor/esforco) ou rice.',
   LOCALTIMESTAMP)
ON CONFLICT (chave) DO NOTHING;


INSERT INTO db_migrations (arquivo) VALUES ('09-backlog.sql')
ON CONFLICT (arquivo) DO NOTHING;

RESET ROLE;