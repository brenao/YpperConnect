-- =====================================================================
-- Plataforma: cadastro de empresas (tenants) pela tela
--
-- So o operador da plataforma (plataforma_admins) usa estas funcoes.
-- Elas fazem pela tela o que os scripts do terminal ja faziam:
-- listar, criar (com o primeiro administrador) e excluir (logico).
-- =====================================================================

create or replace function app.exigir_admin_plataforma() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.eh_admin_plataforma() then
    raise exception 'Somente operadores da plataforma.' using errcode = '42501';
  end if;
end $$;

revoke all on function app.exigir_admin_plataforma() from public, anon, authenticated;

create or replace function public.listar_empresas()
returns table (id uuid, nome text, slug text, criado_em timestamptz,
               usuarios bigint, chamados bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  return query
    select t.id, t.nome, t.slug, t.criado_em,
           (select count(*) from public.tenant_membros m where m.tenant_id = t.id and m.ativo),
           (select count(*) from public.chamados c where c.tenant_id = t.id and c.excluido_em is null)
      from public.tenants t
     where t.excluido_em is null
     order by t.nome;
end $$;

-- O primeiro administrador ja precisa ter conta (a tela cria a conta e
-- o link de convite antes de chamar esta funcao).
create or replace function public.criar_empresa(p_nome text, p_slug text, p_admin uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  if exists (select 1 from public.tenants where slug = lower(p_slug) and excluido_em is null) then
    raise exception 'Ja existe uma empresa com o endereco "%".', p_slug using errcode = '23505';
  end if;
  return app.provisionar_tenant(trim(p_nome), lower(trim(p_slug)), p_admin);
end $$;

create or replace function public.resumo_empresa(p_id uuid)
returns table (nome text, slug text, usuarios bigint, sistemas bigint, chamados bigint, projetos bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_slug text;
begin
  perform app.exigir_admin_plataforma();
  select t.slug into v_slug from public.tenants t where t.id = p_id and t.excluido_em is null;
  if v_slug is null then
    raise exception 'Empresa nao encontrada.' using errcode = 'P0002';
  end if;
  return query select * from app.resumo_empresa(v_slug);
end $$;

create or replace function public.excluir_empresa(p_id uuid, p_confirmacao text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_slug text;
begin
  perform app.exigir_admin_plataforma();
  select t.slug into v_slug from public.tenants t where t.id = p_id and t.excluido_em is null;
  if v_slug is null then
    raise exception 'Empresa nao encontrada.' using errcode = 'P0002';
  end if;
  return app.excluir_empresa(v_slug, lower(trim(p_confirmacao)));
end $$;

revoke all on function public.listar_empresas() from public, anon;
revoke all on function public.criar_empresa(text, text, uuid) from public, anon;
revoke all on function public.resumo_empresa(uuid) from public, anon;
revoke all on function public.excluir_empresa(uuid, text) from public, anon;
grant execute on function public.listar_empresas() to authenticated;
grant execute on function public.criar_empresa(text, text, uuid) to authenticated;
grant execute on function public.resumo_empresa(uuid) to authenticated;
grant execute on function public.excluir_empresa(uuid, text) to authenticated;
