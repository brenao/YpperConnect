-- Exclui uma empresa criada errado, com TODOS os dados dela.
-- Uso (troque o slug nas duas posicoes; elas precisam ser iguais):
--
--   PGPASSWORD="$DB_PASS" psql "$(cat supabase/.temp/pooler-url)" \
--     -v slug=<slug-da-empresa> -f supabase/scripts/excluir-empresa.sql
--
-- As contas de login das pessoas continuam existindo.

select t.nome, t.slug,
       (select count(*) from public.tenant_membros m where m.tenant_id = t.id) as usuarios
  from public.tenants t where t.slug = :'slug';

\prompt 'Digite o slug de novo para confirmar a exclusao: ' confirmacao

select app.excluir_empresa(:'slug', :'confirmacao');
