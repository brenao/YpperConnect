ALTER TABLE chamados ADD (atualizado_em TIMESTAMP);

UPDATE chamados SET atualizado_em = criado_em WHERE atualizado_em IS NULL;

COMMIT;