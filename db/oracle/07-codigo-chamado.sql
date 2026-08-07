-- =====================================================================
-- Codigo legivel do chamado: INC-1000, REQ-1001, DEM-1002...
--
-- prefixo e coluna real, gravada na abertura e NUNCA alterada depois.
-- Se o chamado for reclassificado, o codigo permanece — ele ja circulou
-- por e-mail e foi citado pelo solicitante.
--
-- codigo e coluna virtual: nao ocupa espaco e nunca sai de sincronia.
-- =====================================================================

ALTER TABLE chamados ADD (prefixo VARCHAR2(4 CHAR));

UPDATE chamados SET prefixo =
  CASE tipo
    WHEN 'incidente'  THEN 'INC'
    WHEN 'requisicao' THEN 'REQ'
    WHEN 'melhoria'   THEN 'DEM'
    WHEN 'problema'   THEN 'PRO'
    WHEN 'tarefa'     THEN 'TAR'
    ELSE 'CHM'
  END
WHERE prefixo IS NULL;

ALTER TABLE chamados MODIFY (prefixo VARCHAR2(4 CHAR) NOT NULL);

ALTER TABLE chamados ADD (
  codigo GENERATED ALWAYS AS (prefixo || '-' || TO_CHAR(numero)) VIRTUAL
);

CREATE UNIQUE INDEX ux_chamados_codigo ON chamados (codigo);

COMMIT;