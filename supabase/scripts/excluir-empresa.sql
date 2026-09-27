-- Exclui (logicamente) uma empresa criada errado.
-- Nada e apagado do banco: a empresa sai das telas e ninguem mais entra nela.
--
-- Uso:
--   PGPASSWORD="$DB_PASS" psql "$(cat supabase/.temp/pooler-url)" \
--     -v slug=<slug-da-empresa> -f supabase/scripts/excluir-empresa.sql

\set ON_ERROR_STOP on

\echo
\echo '== Empresa a excluir =='
select nome, slug, usuarios, sistemas, chamados, projetos from app.resumo_empresa(:'slug');

select (chamados + projetos) > 0 as tem_vinculos from app.resumo_empresa(:'slug') \gset

\if :tem_vinculos
  \echo
  \echo 'ATENCAO: esta empresa tem CHAMADOS e/ou PROJETOS vinculados (veja acima).'
  \echo 'Eles continuarao no banco, mas deixarao de aparecer para todos.'
\endif

\echo
\prompt 'Para confirmar a exclusao, digite o slug da empresa (ou Enter para desistir): ' confirmacao

select app.excluir_empresa(:'slug', :'confirmacao');
