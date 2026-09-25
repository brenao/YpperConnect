-- =====================================================================
-- Passo 1b - Seguranca: funcoes de acesso + Row Level Security
-- Funcoes SECURITY DEFINER leem as tabelas de vinculo sem passar pelo
-- RLS (evita recursao) e consultam o banco a cada requisicao: revogar
-- um acesso vale na hora, sem esperar o JWT expirar.
-- =====================================================================

grant usage on schema app to authenticated;

create or replace function app.tenants_do_usuario() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id
    from public.tenant_membros m
    join public.tenants t on t.id = m.tenant_id
   where m.usuario_id = auth.uid() and m.ativo and t.ativo
$$;

create or replace function app.eh_interno(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_membros
     where tenant_id = p_tenant and usuario_id = auth.uid()
       and ativo and tipo = 'interno')
$$;

create or replace function app.organizacao_do_usuario(p_tenant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select organizacao_id from public.tenant_membros
   where tenant_id = p_tenant and usuario_id = auth.uid() and ativo
$$;

-- Permissao valida no tenant inteiro ou no escopo pedido (mesa, projeto...).
create or replace function app.tem_permissao(
  p_tenant uuid, p_permissao text,
  p_escopo_tipo text default 'tenant', p_escopo_id uuid default null
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.atribuicoes a
      join public.tenant_membros m
        on m.tenant_id = a.tenant_id and m.usuario_id = a.usuario_id and m.ativo
      join public.tenants t on t.id = a.tenant_id and t.ativo
      join public.papeis p on p.id = a.papel_id and p.ativo
      join public.papel_permissoes pp on pp.papel_id = a.papel_id
     where a.usuario_id = auth.uid()
       and a.tenant_id = p_tenant
       and pp.permissao = p_permissao
       and (a.escopo_tipo = 'tenant'
            or (a.escopo_tipo = p_escopo_tipo and a.escopo_id = p_escopo_id)))
$$;

create or replace function app.eh_admin_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins where usuario_id = auth.uid())
$$;

-- Ve o proprio cadastro; interno ve quem esta nos mesmos tenants.
create or replace function app.ve_usuario(p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_usuario = auth.uid() or exists (
    select 1
      from public.tenant_membros eu
      join public.tenant_membros outro on outro.tenant_id = eu.tenant_id
     where eu.usuario_id = auth.uid() and eu.ativo and eu.tipo = 'interno'
       and outro.usuario_id = p_usuario)
$$;

grant execute on function
  app.tenants_do_usuario(), app.eh_interno(uuid), app.organizacao_do_usuario(uuid),
  app.tem_permissao(uuid, text, text, uuid), app.eh_admin_plataforma(), app.ve_usuario(uuid)
to authenticated;

-- So a plataforma liga `verificado`. Sem usuario (migration, service_role) passa.
create or replace function app.proteger_dominio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and not app.eh_admin_plataforma()
     and new.verificado is distinct from (case when tg_op = 'UPDATE' then old.verificado else false end)
  then
    raise exception 'Somente a plataforma pode verificar dominios.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tg_tenant_dominios_proteger before insert or update on public.tenant_dominios
  for each row execute function app.proteger_dominio();

-- ---------------------------------------------------------------------
-- Anon nao toca em nada
-- ---------------------------------------------------------------------
revoke all on public.tenants, public.plataforma_admins, public.permissoes, public.usuarios,
  public.organizacoes, public.tenant_membros, public.papeis, public.papel_permissoes,
  public.atribuicoes, public.tenant_dominios, public.auditoria
from anon;

-- ---------------------------------------------------------------------
-- RLS. Sem politica de DELETE = exclusao bloqueada (desative com ativo).
-- ---------------------------------------------------------------------
alter table public.tenants           enable row level security;
alter table public.plataforma_admins enable row level security;
alter table public.permissoes        enable row level security;
alter table public.usuarios          enable row level security;
alter table public.organizacoes      enable row level security;
alter table public.tenant_membros    enable row level security;
alter table public.papeis            enable row level security;
alter table public.papel_permissoes  enable row level security;
alter table public.atribuicoes       enable row level security;
alter table public.tenant_dominios   enable row level security;
alter table public.auditoria         enable row level security;

-- tenants
create policy tenants_ler on public.tenants for select to authenticated
  using (id in (select app.tenants_do_usuario()));
create policy tenants_alterar on public.tenants for update to authenticated
  using (app.tem_permissao(id, 'tenant.configurar'))
  with check (app.tem_permissao(id, 'tenant.configurar'));

-- permissoes (catalogo)
create policy permissoes_ler on public.permissoes for select to authenticated using (true);

-- usuarios
create policy usuarios_ler on public.usuarios for select to authenticated
  using (app.ve_usuario(id));
create policy usuarios_alterar_proprio on public.usuarios for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organizacoes: interno ve todas; cliente ve so a propria
create policy organizacoes_ler on public.organizacoes for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario())
         and (app.eh_interno(tenant_id) or id = app.organizacao_do_usuario(tenant_id)));
create policy organizacoes_incluir on public.organizacoes for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'organizacao.gerenciar'));
create policy organizacoes_alterar on public.organizacoes for update to authenticated
  using (app.tem_permissao(tenant_id, 'organizacao.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'organizacao.gerenciar'));

-- tenant_membros
create policy membros_ler on public.tenant_membros for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario())
         and (app.eh_interno(tenant_id) or usuario_id = (select auth.uid())));
create policy membros_incluir on public.tenant_membros for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'usuario.gerenciar'));
create policy membros_alterar on public.tenant_membros for update to authenticated
  using (app.tem_permissao(tenant_id, 'usuario.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'usuario.gerenciar'));

-- papeis: papel de sistema nao se altera
create policy papeis_ler on public.papeis for select to authenticated
  using (app.eh_interno(tenant_id));
create policy papeis_incluir on public.papeis for insert to authenticated
  with check (not sistema and app.tem_permissao(tenant_id, 'papel.gerenciar'));
create policy papeis_alterar on public.papeis for update to authenticated
  using (not sistema and app.tem_permissao(tenant_id, 'papel.gerenciar'))
  with check (not sistema and app.tem_permissao(tenant_id, 'papel.gerenciar'));

-- papel_permissoes (tabela de ligacao: DELETE liberado, e auditado)
create policy pp_ler on public.papel_permissoes for select to authenticated
  using (app.eh_interno(tenant_id));
create policy pp_incluir on public.papel_permissoes for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'papel.gerenciar')
              and not exists (select 1 from public.papeis p where p.id = papel_id and p.sistema));
create policy pp_excluir on public.papel_permissoes for delete to authenticated
  using (app.tem_permissao(tenant_id, 'papel.gerenciar')
         and not exists (select 1 from public.papeis p where p.id = papel_id and p.sistema));

-- atribuicoes (revogar acesso = DELETE, auditado)
create policy atrib_ler on public.atribuicoes for select to authenticated
  using (usuario_id = (select auth.uid()) or app.eh_interno(tenant_id));
create policy atrib_incluir on public.atribuicoes for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'papel.gerenciar'));
create policy atrib_excluir on public.atribuicoes for delete to authenticated
  using (app.tem_permissao(tenant_id, 'papel.gerenciar'));

-- dominios
create policy dominios_ler on public.tenant_dominios for select to authenticated
  using (app.tem_permissao(tenant_id, 'tenant.configurar'));
create policy dominios_incluir on public.tenant_dominios for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'tenant.configurar'));
create policy dominios_alterar on public.tenant_dominios for update to authenticated
  using (app.tem_permissao(tenant_id, 'tenant.configurar'))
  with check (app.tem_permissao(tenant_id, 'tenant.configurar'));

-- auditoria (somente leitura; quem grava e o trigger)
create policy auditoria_ler on public.auditoria for select to authenticated
  using (app.tem_permissao(tenant_id, 'auditoria.ver'));
