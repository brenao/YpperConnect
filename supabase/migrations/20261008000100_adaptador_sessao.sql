-- =====================================================================
-- Projetos (P2): suporte ao adaptador de SQL com contexto de sessao
--
-- O codigo de Projetos mantem o SQL do legado e fala com o Postgres do
-- Supabase por conexao direta. Cada transacao do adaptador "veste" a
-- identidade do usuario: papel authenticated, auth.uid() e a empresa
-- ativa (app.tenant_id). Isto aqui garante que:
--   1. registros novos recebam a empresa da sessao (tenant_id padrao);
--   2. com a empresa definida na sessao, so ela aparece, mesmo para
--      quem participa de varias empresas (politica restritiva).
-- Sem app.tenant_id (acessos pelo cliente do Supabase), nada muda.
-- =====================================================================

create or replace function app.tenant_corrente() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
grant execute on function app.tenant_corrente() to authenticated;

do $$
declare
  t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'tenant_id'
       and tb.table_type = 'BASE TABLE'
  loop
    -- 1. Empresa da sessao como padrao nas inclusoes
    execute format('alter table public.%I alter column tenant_id set default app.tenant_corrente()', t);

    -- 2. Com a empresa definida na sessao, so ela (soma-se as demais politicas)
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (app.tenant_corrente() is null or tenant_id = app.tenant_corrente())
         with check (app.tenant_corrente() is null or tenant_id = app.tenant_corrente())',
      t || '_empresa_da_sessao', t);
  end loop;
end $$;

-- Excluir projeto: o adaptador chama esta funcao (o DELETE do legado
-- vira exclusao logica). Mantem a mesma assinatura da P1.