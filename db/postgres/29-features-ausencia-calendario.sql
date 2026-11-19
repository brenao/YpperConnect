-- Separa "avisar que vou faltar" de "administrar a capacidade da equipe".
--
-- As duas coisas viviam sob recurso.editar, e isso obrigava a escolher
-- entre o analista não conseguir marcar as próprias férias ou poder
-- mexer no cadastro da equipe inteira. Agora são chaves distintas.
--
-- Quem já administra recursos recebe a da ausência própria por tabela:
-- ele continua podendo tudo, e a chave nova evita um caso especial no
-- código para quem tem só a antiga.
INSERT INTO perfil_features (perfil_id, feature_key)
SELECT DISTINCT pf.perfil_id, 'recurso.ausencia_propria'
  FROM perfil_features pf
 WHERE pf.feature_key = 'recurso.editar'
   AND NOT EXISTS (SELECT 1 FROM perfil_features x
                    WHERE x.perfil_id = pf.perfil_id
                      AND x.feature_key = 'recurso.ausencia_propria');

-- O calendário era exclusivo do administrador, sem passar por perfil.
-- Quem administra recursos já responde por capacidade, e feriado é
-- capacidade: é a mesma pessoa.
INSERT INTO perfil_features (perfil_id, feature_key)
SELECT DISTINCT pf.perfil_id, 'calendario.editar'
  FROM perfil_features pf
 WHERE pf.feature_key = 'recurso.editar'
   AND NOT EXISTS (SELECT 1 FROM perfil_features x
                    WHERE x.perfil_id = pf.perfil_id
                      AND x.feature_key = 'calendario.editar');

INSERT INTO perfil_features (perfil_id, feature_key)
SELECT p.id, k.chave
  FROM perfis_acesso p
 CROSS JOIN (VALUES ('recurso.ausencia_propria'), ('calendario.editar')) AS k(chave)
 WHERE p.id = 'PRF-ADMIN'
   AND NOT EXISTS (SELECT 1 FROM perfil_features x
                    WHERE x.perfil_id = p.id AND x.feature_key = k.chave);