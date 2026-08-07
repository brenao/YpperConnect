-- Perfil de sistema: embutido na aplicacao, nao pode ser excluido
-- pela tela de permissoes. Faltou no 01-schema.sql.
ALTER TABLE perfis_acesso ADD (
  sistema NUMBER(1) DEFAULT 0 NOT NULL
);

ALTER TABLE perfis_acesso ADD CONSTRAINT ck_perfis_sistema CHECK (sistema IN (0,1));