-- =====================================================================
-- 11 - Usuarios vindos do GLPI
--
-- A lista de pessoas do Grupo Rosset passa a vir do GLPI, para uso como
-- gerente, patrocinador e recurso de projeto.
--
-- POR QUE ESPELHAR EM `usuarios` E NAO CRIAR TABELA PROPRIA
--   `projetos.gerente_id`, `projetos.sponsor_id` e `recursos.usuario_id`
--   sao chaves estrangeiras para `usuarios(id)`. Uma tabela separada com
--   id inteiro do GLPI nao casa com nenhuma delas: o insert seria
--   recusado, e as dezenas de LEFT JOIN que exibem o nome do gerente
--   voltariam vazias.
--
--   O espelho tambem protege a aplicacao da indisponibilidade do GLPI —
--   que hoje e um servidor de homologacao. Sem copia local, o GLPI fora
--   do ar nao deixaria apenas o seletor desatualizado: faria todas as
--   telas de projeto mostrarem "Sem gerente".
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/11-glpi-usuarios.sql
-- =====================================================================

SET ROLE ypper;

-- ---------------------------------------------------------------------
-- 1. Chave de integracao
--
-- O `id` do GLPI e o identificador estavel, conforme a documentacao da
-- integracao: login e nome podem mudar. UNIQUE porque uma pessoa do
-- GLPI nao pode virar dois usuarios aqui.
-- ---------------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN glpi_user_id INTEGER;

ALTER TABLE usuarios ADD CONSTRAINT uq_usuarios_glpi UNIQUE (glpi_user_id);


-- ---------------------------------------------------------------------
-- 2. Origem `glpi`
--
-- Distingue quem veio da sincronizacao de quem foi cadastrado a mao ou
-- pelo AD. A sincronizacao so mexe nas proprias linhas: sem isso, um
-- usuario cadastrado manualmente seria desativado na primeira passada
-- por nao constar do GLPI.
-- ---------------------------------------------------------------------
ALTER TABLE usuarios DROP CONSTRAINT ck_usuarios_origem;

ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_origem
  CHECK (origem IN ('ad','manual','glpi'));


-- ---------------------------------------------------------------------
-- 3. E-mail passa a ser opcional
--
-- O endpoint do GLPI devolve apenas id, login e nome. Nao ha e-mail, e
-- inventar um a partir do login seria pior do que nao ter: o lembrete
-- de projeto sairia para um endereco que pode ser de outra pessoa.
--
-- A coluna continua NOT NULL na pratica para quem se autentica — quem
-- loga vem do AD e tem e-mail. Quem so existe para ser escolhido num
-- seletor nao precisa de um.
-- ---------------------------------------------------------------------
ALTER TABLE usuarios ALTER COLUMN email DROP NOT NULL;


-- Sincronizacao filtra por origem e ordena por nome no seletor.
CREATE INDEX ix_usuarios_origem ON usuarios (origem, ativo);


INSERT INTO db_migrations (arquivo) VALUES ('11-glpi-usuarios.sql')
ON CONFLICT (arquivo) DO NOTHING;

RESET ROLE;