-- Ver o portfólio da área virou permissão, não consequência do cadastro.
--
-- Antes bastava ter departamento preenchido: qualquer pessoa cadastrada
-- passava a enxergar todos os projetos tocados por gente da mesma área.
-- Para quem acompanha carteira isso é o certo; para o analista é o
-- oposto do pretendido — ele trabalha nas tarefas dele, e o portfólio
-- da área não é assunto seu.
--
-- Quem já enxergava a carteira por outro caminho recebe a feature, para
-- que a mudança não tire de ninguém o que já tinha: admin, visão de
-- diretoria e gestor de portfólio.

INSERT INTO perfil_features (perfil_id, feature_key)
SELECT DISTINCT pf.perfil_id, 'projetos.area'
  FROM perfil_features pf
 WHERE pf.feature_key IN ('projetos.visao_diretoria', 'projetos.portfolio')
   AND NOT EXISTS (SELECT 1 FROM perfil_features x
                    WHERE x.perfil_id = pf.perfil_id
                      AND x.feature_key = 'projetos.area');

INSERT INTO perfil_features (perfil_id, feature_key)
SELECT p.id, 'projetos.area'
  FROM perfis_acesso p
 WHERE p.id = 'PRF-ADMIN'
   AND NOT EXISTS (SELECT 1 FROM perfil_features x
                    WHERE x.perfil_id = p.id
                      AND x.feature_key = 'projetos.area');