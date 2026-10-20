-- As três listas de projeto e a matriz.
--
-- A tela de projetos virou quatro: backlog, em andamento, paralisados e
-- matriz. Quem já tinha acesso a /projetos ou /backlog passa a ter às
-- novas, porque elas são recortes do que essa pessoa já enxergava — não
-- informação nova. Exigir que o administrador reabra cada perfil para
-- liberar o que a pessoa já via seria transformar uma reorganização de
-- menu em trabalho de cadastro.
--
-- A visibilidade de cada projeto continua sendo decidida no repositório,
-- não aqui: o módulo abre a tela, e a tela mostra o que couber.

INSERT INTO perfil_modulos (perfil_id, modulo_key)
SELECT DISTINCT pm.perfil_id, v.chave
  FROM perfil_modulos pm
  CROSS JOIN (VALUES ('/paralisados'), ('/matriz')) AS v(chave)
 WHERE pm.modulo_key IN ('/projetos', '/backlog')
   AND NOT EXISTS (SELECT 1 FROM perfil_modulos x
                    WHERE x.perfil_id = pm.perfil_id
                      AND x.modulo_key = v.chave);