-- =====================================================================
-- CUIDADO: apaga tudo. Somente rosset96 (teste).
--
-- O DROP ... CASCADE derruba junto as FKs que apontam para a tabela.
-- A ordem abaixo ja e a inversa da criacao, entao o CASCADE quase nao
-- e usado - ele esta ali como rede de seguranca.
--
-- A guarda abaixo aborta se o banco nao for `ypper`. Nao protege
-- contra rodar em producao (la o banco tambem se chama ypper), so
-- contra rodar no banco errado por engano.
-- =====================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'ypper' THEN
    RAISE EXCEPTION 'Banco atual e "%", esperado "ypper". Abortado.', current_database();
  END IF;
END $$;

DROP TABLE IF EXISTS notificacoes CASCADE;
DROP TABLE IF EXISTS baseline_tarefas CASCADE;
DROP TABLE IF EXISTS projeto_baselines CASCADE;
DROP TABLE IF EXISTS projeto_atencoes CASCADE;
DROP TABLE IF EXISTS projeto_riscos CASCADE;
DROP TABLE IF EXISTS projeto_atualizacoes CASCADE;
DROP TABLE IF EXISTS tarefa_predecessoras CASCADE;
DROP TABLE IF EXISTS tarefa_responsaveis CASCADE;
DROP TABLE IF EXISTS projeto_tarefas CASCADE;
DROP TABLE IF EXISTS projetos CASCADE;
DROP TABLE IF EXISTS recursos CASCADE;
DROP TABLE IF EXISTS chamado_historico CASCADE;
DROP TABLE IF EXISTS chamado_interacoes CASCADE;
DROP TABLE IF EXISTS chamados CASCADE;
DROP TABLE IF EXISTS artigos CASCADE;
DROP TABLE IF EXISTS sistemas CASCADE;
DROP TABLE IF EXISTS servicos CASCADE;
DROP TABLE IF EXISTS perfil_features CASCADE;
DROP TABLE IF EXISTS perfil_modulos CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS perfis_acesso CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS equipes CASCADE;
DROP TABLE IF EXISTS feriados CASCADE;
DROP TABLE IF EXISTS expediente CASCADE;
