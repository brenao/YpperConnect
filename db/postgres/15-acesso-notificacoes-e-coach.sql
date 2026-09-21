-- db/postgres/15-acesso-notificacoes-e-coach.sql
--
-- Duas mudancas independentes, na mesma transacao: ou as duas valem,
-- ou nenhuma. Juntas porque entraram na mesma leva de trabalho, e um
-- banco com metade aplicada seria pior de diagnosticar depois.

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Avisos de acesso a projeto na fila de notificacoes
--
-- `tipo` e `referencia_tipo` sao uniao fechada por CHECK desde o
-- 01-schema. Sem isto o INSERT do aviso falha no banco, depois de o
-- TypeScript ter aceitado — o CHECK e a unica fonte da verdade aqui.
-- ---------------------------------------------------------------------

ALTER TABLE notificacoes DROP CONSTRAINT IF EXISTS ck_notif_tipo;

ALTER TABLE notificacoes
    ADD CONSTRAINT ck_notif_tipo CHECK (tipo IN (
        'chamado_status',
        'chamado_criado',
        'projeto_lembrete',
        -- Pedido de acesso aberto: vai para o gerente do projeto.
        'acesso_solicitado',
        -- Resposta do gerente: vai para quem pediu.
        'acesso_decidido'
    ));

ALTER TABLE notificacoes DROP CONSTRAINT IF EXISTS ck_notif_referencia;

-- 'solicitacao_acesso' aponta para projeto_solicitacoes_acesso.id.
-- O nome cabe nos 20 caracteres da coluna; o mais descritivo
-- 'projeto_solicitacao_acesso' nao caberia.
ALTER TABLE notificacoes
    ADD CONSTRAINT ck_notif_referencia CHECK (
        referencia_tipo IS NULL
        OR referencia_tipo IN ('chamado', 'projeto', 'solicitacao_acesso')
    );

-- ---------------------------------------------------------------------
-- 2. Instrutor de cronograma como funcionalidade de perfil
--
-- O painel some por padrao: quem nao tem a chave nao ve. Para os
-- perfis de sistema ela ja entra marcada, senao a mudanca apareceria
-- como um recurso que sumiu sem aviso para quem hoje o usa.
--
-- O NOT EXISTS deixa este bloco repetivel: rodar de novo nao duplica.
-- ---------------------------------------------------------------------

INSERT INTO perfil_features (perfil_id, feature_key)
SELECT p.id, 'projetos.coach'
  FROM perfis_acesso p
 WHERE p.sistema = 1
   AND NOT EXISTS (
        SELECT 1 FROM perfil_features f
         WHERE f.perfil_id = p.id
           AND f.feature_key = 'projetos.coach');

-- ---------------------------------------------------------------------
-- 3. Remove a chave 'projetos.aprovar_acesso'
--
-- A migration 14 a criou nos perfis de sistema, mas ela nunca chegou a
-- significar nada: quem aprova um pedido de acesso e o gerente ou o
-- patrocinador do projeto, regra que vem das colunas de `projetos`.
-- Chave de perfil que nao e lida por ninguem so confunde quem abre a
-- tela de Perfis de acesso e tenta entender o que ela faz.
--
-- Ambientes novos nao passam por isto: o INSERT saiu do arquivo 14.
-- ---------------------------------------------------------------------

DELETE FROM perfil_features WHERE feature_key = 'projetos.aprovar_acesso';

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('15-acesso-notificacoes-e-coach.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;