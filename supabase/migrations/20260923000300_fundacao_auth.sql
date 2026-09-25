-- =====================================================================
-- Passo 1c - Auth e provisionamento
--   - Todo usuario do Supabase Auth ganha linha em public.usuarios.
--   - E-mail de dominio verificado entra sozinho no tenant (SSO/JIT).
--   - Criacao de tenant: RPC public.criar_tenant (admin da plataforma).
-- =====================================================================

-- Papeis de sistema criados em todo tenant novo. perms null = todas.
create or replace function app.criar_papeis_padrao(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_papel uuid;
begin
  for r in
    select * from (values
      ('admin_tenant',    'Administrador',         null::text[]),
      ('agente',          'Agente de atendimento', array['chamado.criar','chamado.ver_todos','chamado.tratar','conhecimento.editar']),
      ('solicitante',     'Solicitante',           array['chamado.criar']),
      ('gerente_projeto', 'Gerente de projeto',    array['projeto.criar','chamado.criar']),
      ('diretoria',       'Diretoria',             array['projeto.ver_portfolio','projeto.diretoria','chamado.ver_todos','chamado.criar'])
    ) as v(chave, nome, perms)
  loop
    insert into public.papeis (tenant_id, chave, nome, sistema)
    values (p_tenant, r.chave, r.nome, true)
    on conflict (tenant_id, chave) do nothing
    returning id into v_papel;

    continue when v_papel is null;

    insert into public.papel_permissoes (tenant_id, papel_id, permissao)
    select p_tenant, v_papel, p.chave
      from public.permissoes p
     where r.perms is null or p.chave = any (r.perms);
  end loop;
end $$;

-- Interno: usado pela RPC e por scripts. Nao exposto a usuarios.
create or replace function app.provisionar_tenant(p_nome text, p_slug text, p_dono uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_org    uuid;
begin
  insert into public.tenants (nome, slug) values (p_nome, lower(p_slug))
  returning id into v_tenant;

  insert into public.organizacoes (tenant_id, tipo, relacao, nome)
  values (v_tenant, 'empresa', 'interna', p_nome)
  returning id into v_org;

  perform app.criar_papeis_padrao(v_tenant);

  insert into public.tenant_membros (tenant_id, usuario_id, tipo, organizacao_id, origem)
  values (v_tenant, p_dono, 'interno', v_org, 'manual');

  insert into public.atribuicoes (tenant_id, usuario_id, papel_id)
  select v_tenant, p_dono, id from public.papeis
   where tenant_id = v_tenant and chave = 'admin_tenant';

  return v_tenant;
end $$;

revoke all on function app.criar_papeis_padrao(uuid) from public, anon, authenticated;
revoke all on function app.provisionar_tenant(text, text, uuid) from public, anon, authenticated;

-- RPC chamada pelo app: supabase.rpc('criar_tenant', { p_nome, p_slug })
create or replace function public.criar_tenant(p_nome text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not app.eh_admin_plataforma() then
    raise exception 'Apenas administradores da plataforma criam tenants.' using errcode = '42501';
  end if;
  return app.provisionar_tenant(p_nome, p_slug, auth.uid());
end $$;

revoke all on function public.criar_tenant(text, text) from public, anon;
grant execute on function public.criar_tenant(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Espelho de auth.users + ingresso por dominio
-- ---------------------------------------------------------------------
create or replace function app.ao_criar_usuario_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dominio text := lower(split_part(coalesce(new.email, ''), '@', 2));
  v_tenant  uuid;
  v_papel   uuid;
  v_org     uuid;
begin
  insert into public.usuarios (id, nome, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
             nullif(new.raw_user_meta_data->>'name', ''),
             split_part(coalesce(new.email, 'usuario'), '@', 1)),
    lower(new.email))
  on conflict (id) do nothing;

  select d.tenant_id, d.papel_padrao_id into v_tenant, v_papel
    from public.tenant_dominios d
    join public.tenants t on t.id = d.tenant_id and t.ativo
   where d.dominio = v_dominio and d.verificado;

  if v_tenant is not null then
    select id into v_org
      from public.organizacoes
     where tenant_id = v_tenant and pai_id is null and relacao = 'interna' and ativo
     order by criado_em
     limit 1;

    insert into public.tenant_membros (tenant_id, usuario_id, tipo, organizacao_id, origem)
    values (v_tenant, new.id, 'interno', v_org,
            case when coalesce(new.raw_app_meta_data->>'provider', '') like 'sso%'
                 then 'sso' else 'dominio' end)
    on conflict do nothing;

    if v_papel is null then
      select id into v_papel from public.papeis
       where tenant_id = v_tenant and chave = 'solicitante';
    end if;

    insert into public.atribuicoes (tenant_id, usuario_id, papel_id)
    values (v_tenant, new.id, v_papel)
    on conflict do nothing;
  end if;

  return new;
end $$;

create or replace function app.ao_atualizar_usuario_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.usuarios set email = lower(new.email)
   where id = new.id and email is distinct from lower(new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.ao_criar_usuario_auth();

create trigger on_auth_user_email_updated after update of email on auth.users
  for each row execute function app.ao_atualizar_usuario_auth();
