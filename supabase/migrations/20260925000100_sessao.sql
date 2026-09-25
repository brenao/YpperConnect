-- =====================================================================
-- Passo 2 - Funcoes de sessao chamadas pelo app a cada requisicao.
-- SECURITY DEFINER porque um solicitante (cliente) nao le papel_permissoes
-- pelo RLS, mas precisa saber as proprias permissoes para montar a tela.
-- Tudo filtrado por auth.uid(): ninguem consulta dados de outra pessoa.
-- =====================================================================

-- Empresas (tenants) em que a pessoa logada tem vinculo ativo.
create or replace function public.meus_tenants()
returns table (id uuid, slug text, nome text, tipo text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.slug, t.nome, m.tipo
    from public.tenant_membros m
    join public.tenants t on t.id = m.tenant_id
   where m.usuario_id = auth.uid() and m.ativo and t.ativo
   order by t.nome
$$;

-- Permissoes de escopo tenant da pessoa logada no tenant informado.
create or replace function public.minhas_permissoes(p_tenant uuid)
returns setof text
language sql stable security definer set search_path = '' as $$
  select distinct pp.permissao
    from public.atribuicoes a
    join public.tenant_membros m
      on m.tenant_id = a.tenant_id and m.usuario_id = a.usuario_id and m.ativo
    join public.tenants t on t.id = a.tenant_id and t.ativo
    join public.papeis p on p.id = a.papel_id and p.ativo
    join public.papel_permissoes pp on pp.papel_id = a.papel_id
   where a.usuario_id = auth.uid()
     and a.tenant_id = p_tenant
     and a.escopo_tipo = 'tenant'
$$;

create or replace function public.sou_admin_plataforma()
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.eh_admin_plataforma()
$$;

revoke all on function public.meus_tenants() from public, anon;
revoke all on function public.minhas_permissoes(uuid) from public, anon;
revoke all on function public.sou_admin_plataforma() from public, anon;
grant execute on function public.meus_tenants() to authenticated;
grant execute on function public.minhas_permissoes(uuid) to authenticated;
grant execute on function public.sou_admin_plataforma() to authenticated;
