-- Seed minimo para a aplicacao subir (Postgres)
--
-- APLICAR:
--   docker exec -i postgres-rosset psql -U postgres -d ypper \
--     -v ON_ERROR_STOP=1 < 03-seed-inicial.sql
--
-- O BEGIN/COMMIT abaixo faz o arquivo ser tudo-ou-nada: se uma linha
-- falhar, nada e gravado. Sem isso o seed ficaria pela metade e a
-- segunda tentativa esbarraria em chave duplicada do que ja entrou.

\set ON_ERROR_STOP on
BEGIN;

-- =====================================================================
-- Seed minimo: so o necessario para a aplicacao subir.
-- Sem dados de demonstracao.
--
-- SECAO 1 - Perfis de acesso: NAO e dado de demo, e configuracao do
--           modelo de permissao. Marcados sistema = 1 para a tela de
--           permissoes nao permitir exclusao. Nunca apagar.
--
-- SECAO 2 - Usuario administrador inicial: EDITE com seus dados reais
--           antes de rodar. E o unico usuario que existira; todos os
--           demais serao cadastrados pela tela ou virao do AD depois.
--
-- SECAO 3 - Equipes e categorias iniciais: valores genericos de TI.
--           Ajuste, remova ou acrescente conforme a estrutura real.
-- =====================================================================


-- =====================================================================
-- SECAO 1 - Perfis de acesso (configuracao obrigatoria)
-- =====================================================================

INSERT INTO perfis_acesso (id, nome, descricao, sistema) VALUES
  ('PRF-ADMIN', 'Administrador de TI',
   'Acesso total ao sistema, incluindo cadastros administrativos e perfis de acesso.', 1);
INSERT INTO perfis_acesso (id, nome, descricao, sistema) VALUES
  ('PRF-AGENTE', 'Analista de TI',
   'Atende chamados, gerencia problemas, projetos e a base de conhecimento.', 1);
INSERT INTO perfis_acesso (id, nome, descricao, sistema) VALUES
  ('PRF-GESTOR', 'Gestor / Diretoria',
   'Visualiza indicadores executivos de projetos e atendimento.', 1);
INSERT INTO perfis_acesso (id, nome, descricao, sistema) VALUES
  ('PRF-USUARIO', 'Usuário final',
   'Abre chamados pelo catálogo e consulta a base de conhecimento. Não cria problemas.', 1);

-- Modulos (rotas) por perfil
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/chamados');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/catalogo');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/conhecimento');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/assistente');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/projetos');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/recursos');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/diretoria');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/governanca');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/administracao');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-ADMIN', '/permissoes');

INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/chamados');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/catalogo');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/conhecimento');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/assistente');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/projetos');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/recursos');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-AGENTE', '/governanca');

INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/chamados');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/conhecimento');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/projetos');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/recursos');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/diretoria');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-GESTOR', '/governanca');

INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-USUARIO', '/');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-USUARIO', '/chamados');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-USUARIO', '/catalogo');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-USUARIO', '/conhecimento');
INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES ('PRF-USUARIO', '/assistente');

-- Funcionalidades por perfil
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'chamado.criar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'chamado.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'chamado.problema');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'conhecimento.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'catalogo.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'projeto.criar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'projeto.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'recurso.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'admin.usuarios');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'admin.sistemas');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-ADMIN', 'admin.permissoes');

INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'chamado.criar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'chamado.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'chamado.problema');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'conhecimento.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'projeto.criar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'projeto.editar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-AGENTE', 'recurso.editar');

INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-GESTOR', 'chamado.criar');
INSERT INTO perfil_features (perfil_id, feature_key) VALUES ('PRF-USUARIO', 'chamado.criar');


-- =====================================================================
-- SECAO 3 - Equipes e categorias iniciais
-- (antes da secao 2 porque usuarios.equipe_id tem FK para equipes)
-- =====================================================================

INSERT INTO equipes (id, nome) VALUES ('EQP-SDK', 'Service Desk');
INSERT INTO equipes (id, nome) VALUES ('EQP-INF', 'Infraestrutura');
INSERT INTO equipes (id, nome) VALUES ('EQP-SIS', 'Sistemas');

INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-SVC-01', 'Acessos', 'servico');
INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-SVC-02', 'Infraestrutura', 'servico');
INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-SVC-03', 'Sistemas', 'servico');

INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-CHA-01', 'Acessos', 'chamado');
INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-CHA-02', 'Infraestrutura', 'chamado');
INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-CHA-03', 'Sistemas', 'chamado');

INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-SIS-01', 'Aplicações', 'sistema');
INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-SIS-02', 'Infraestrutura', 'sistema');

INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-ART-01', 'Procedimentos', 'artigo');
INSERT INTO categorias (id, nome, escopo) VALUES ('CAT-ART-02', 'Soluções', 'artigo');


-- =====================================================================
-- SECAO 2 - Usuario administrador inicial
--
-- EDITE OS QUATRO VALORES ABAIXO com seus dados reais.
-- O `login` precisa ser identico ao LOGIN_PROVISORIO em
-- src/services/current-user.server.ts, senao a aplicacao nao encontra
-- o usuario e nao sobe.
--
-- Formato do login: DOMINIO\usuario (a barra invertida e literal).
-- Quando o AD entrar, o sync casa por este login e preenche
-- ad_object_id automaticamente.
-- =====================================================================

INSERT INTO usuarios
  (id, nome, email, login, departamento, equipe_id, perfil_id,
   origem, admin, ativo, criado_em, atualizado_em)
VALUES
  ('USR-ADMIN',
   'Breno Ferreira de Andrade',                    -- <-- seu nome
   'breno@rosset.com.br',      -- <-- seu e-mail
   'ROSSET\breno',             -- <-- seu login de rede
   'Tecnologia da Informação',          -- <-- seu departamento
   'EQP-SIS',
   'PRF-ADMIN',
   'manual', 1, 1, LOCALTIMESTAMP, LOCALTIMESTAMP);


COMMIT;
