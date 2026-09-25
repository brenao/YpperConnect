-- =====================================================================
-- Parte 2 - Modelo de acesso IGUAL ao legado, por empresa
--
-- Remove o modelo de papeis/permissoes criado no passo 1 (funcionalidade
-- nova, fora do escopo) e volta ao do legado:
--   - perfis_acesso + perfil_modulos + perfil_features
--   - no usuario: login, departamento, equipe, perfil e flag admin
-- Diferenca unica: tudo por empresa (tenant_id), com RLS.
--
-- Origem: db/postgres/01-schema.sql, 03-seed-inicial.sql e
-- 15-acesso-notificacoes-e-coach.sql (projetos.coach nos perfis de sistema).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabelas do legado, por empresa
-- ---------------------------------------------------------------------
create table public.perfis_acesso (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  nome           text not null,
  descricao      text,
  sistema        boolean not null default false,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_perfis_acesso primary key (id),
  constraint uq_perfis_tenant_id unique (tenant_id, id),
  constraint uq_perfis_nome unique (tenant_id, nome)
);

create table public.perfil_modulos (
  tenant_id   uuid not null,
  perfil_id   uuid not null,
  modulo_key  text not null,
  constraint pk_perfil_modulos primary key (perfil_id, modulo_key),
  constraint fk_perfil_modulos foreign key (tenant_id, perfil_id)
    references public.perfis_acesso (tenant_id, id) on delete cascade
);

create table public.perfil_features (
  tenant_id    uuid not null,
  perfil_id    uuid not null,
  feature_key  text not null,
  constraint pk_perfil_features primary key (perfil_id, feature_key),
  constraint fk_perfil_features foreign key (tenant_id, perfil_id)
    references public.perfis_acesso (tenant_id, id) on delete cascade
);

-- Campos do usuario do legado que dependem da empresa.
alter table public.tenant_membros
  add column login        text,
  add column departamento text,
  add column perfil_id    uuid,
  add column admin        boolean not null default false,
  add constraint uq_membros_login unique (tenant_id, login),
  add constraint fk_membros_perfil foreign key (tenant_id, perfil_id)
    references public.perfis_acesso (tenant_id, id);

alter table public.tenant_dominios add column perfil_padrao_id uuid;
alter table public.tenant_dominios
  add constraint fk_dominio_perfil foreign key (tenant_id, perfil_padrao_id)
  references public.perfis_acesso (tenant_id, id);

-- ---------------------------------------------------------------------
-- 2. Perfis, equipes e categorias iniciais do legado (03-seed-inicial)
-- ---------------------------------------------------------------------
create or replace function app.criar_perfis_padrao(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_perfil uuid;
begin
  for r in
    select * from (values
      ('Administrador de TI',
       'Acesso total ao sistema, incluindo cadastros administrativos e perfis de acesso.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente','/projetos','/recursos',
             '/diretoria','/governanca','/administracao','/permissoes'],
       array['chamado.criar','chamado.editar','chamado.problema','conhecimento.editar',
             'catalogo.editar','projeto.criar','projeto.editar','recurso.editar',
             'admin.usuarios','admin.sistemas','admin.permissoes','projetos.coach']),
      ('Analista de TI',
       'Atende chamados, gerencia problemas, projetos e a base de conhecimento.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente','/projetos','/recursos',
             '/governanca'],
       array['chamado.criar','chamado.editar','chamado.problema','conhecimento.editar',
             'projeto.criar','projeto.editar','recurso.editar','projetos.coach']),
      ('Gestor / Diretoria',
       'Visualiza indicadores executivos de projetos e atendimento.',
       array['/','/chamados','/conhecimento','/projetos','/recursos','/diretoria','/governanca'],
       array['chamado.criar','projetos.coach']),
      ('Usuário final',
       'Abre chamados pelo catálogo e consulta a base de conhecimento. Não cria problemas.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente'],
       array['chamado.criar','projetos.coach'])
    ) as v(nome, descricao, modulos, features)
  loop
    insert into public.perfis_acesso (tenant_id, nome, descricao, sistema)
    values (p_tenant, r.nome, r.descricao, true)
    on conflict (tenant_id, nome) do nothing
    returning id into v_perfil;

    continue when v_perfil is null;

    insert into public.perfil_modulos (tenant_id, perfil_id, modulo_key)
    select p_tenant, v_perfil, m from unnest(r.modulos) as m;

    insert into public.perfil_features (tenant_id, perfil_id, feature_key)
    select p_tenant, v_perfil, f from unnest(r.features) as f;
  end loop;
end $$;

create or replace function app.criar_cadastros_iniciais(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.equipes (tenant_id, nome)
  values (p_tenant, 'Service Desk'), (p_tenant, 'Infraestrutura'), (p_tenant, 'Sistemas')
  on conflict do nothing;

  insert into public.categorias (tenant_id, nome, escopo) values
    (p_tenant, 'Acessos', 'servico'), (p_tenant, 'Infraestrutura', 'servico'),
    (p_tenant, 'Sistemas', 'servico'), (p_tenant, 'Acessos', 'chamado'),
    (p_tenant, 'Infraestrutura', 'chamado'), (p_tenant, 'Sistemas', 'chamado'),
    (p_tenant, 'Aplicações', 'sistema'), (p_tenant, 'Infraestrutura', 'sistema'),
    (p_tenant, 'Procedimentos', 'artigo'), (p_tenant, 'Soluções', 'artigo')
  on conflict do nothing;
$$;

revoke all on function app.criar_perfis_padrao(uuid) from public, anon, authenticated;
revoke all on function app.criar_cadastros_iniciais(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Empresas que ja existem: cria os perfis e converte os papeis
-- ---------------------------------------------------------------------
do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.criar_perfis_padrao(t);
    perform app.criar_cadastros_iniciais(t);
  end loop;
end $$;

update public.tenant_membros m
   set admin = (p.chave = 'admin_tenant'),
       perfil_id = (select pa.id from public.perfis_acesso pa
                     where pa.tenant_id = m.tenant_id
                       and pa.nome = case p.chave
                         when 'admin_tenant'    then 'Administrador de TI'
                         when 'agente'          then 'Analista de TI'
                         when 'gerente_projeto' then 'Analista de TI'
                         when 'diretoria'       then 'Gestor / Diretoria'
                         else 'Usuário final' end)
  from public.atribuicoes a
  join public.papeis p on p.id = a.papel_id
 where a.tenant_id = m.tenant_id and a.usuario_id = m.usuario_id and a.escopo_tipo = 'tenant';

-- Login do legado: parte do e-mail antes do @ (editavel na tela).
update public.tenant_membros m
   set login = split_part(u.email, '@', 1)
  from public.usuarios u
 where u.id = m.usuario_id and m.login is null and u.email is not null;

-- ---------------------------------------------------------------------
-- 4. Remove o modelo de papeis/permissoes
-- ---------------------------------------------------------------------
drop function if exists public.minhas_permissoes(uuid);
drop function if exists app.criar_papeis_padrao(uuid);
alter table public.tenant_dominios drop column papel_padrao_id;
drop table public.atribuicoes;
drop table public.papel_permissoes;
drop table public.papeis;
drop table public.permissoes;

-- ---------------------------------------------------------------------
-- 5. Regra de escrita do legado: cadastros sao do administrador.
--    Mesma assinatura de antes, entao as politicas existentes continuam.
-- ---------------------------------------------------------------------
create or replace function app.tem_permissao(
  p_tenant uuid, p_permissao text,
  p_escopo_tipo text default 'tenant', p_escopo_id uuid default null
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.tenant_membros m
      join public.tenants t on t.id = m.tenant_id and t.ativo
     where m.tenant_id = p_tenant
       and m.usuario_id = auth.uid()
       and m.ativo
       and m.admin)
$$;

comment on function app.tem_permissao(uuid, text, text, uuid) is
  'Como no legado: escrita em cadastros e do administrador da empresa. O nome da permissao fica para as politicas lerem melhor.';

-- ---------------------------------------------------------------------
-- 6. Provisionamento e primeiro login
-- ---------------------------------------------------------------------
create or replace function app.provisionar_tenant(p_nome text, p_slug text, p_dono uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_org    uuid;
  v_email  text;
begin
  insert into public.tenants (nome, slug) values (p_nome, lower(p_slug))
  returning id into v_tenant;

  insert into public.organizacoes (tenant_id, tipo, relacao, nome)
  values (v_tenant, 'empresa', 'interna', p_nome)
  returning id into v_org;

  perform app.criar_perfis_padrao(v_tenant);
  perform app.criar_cadastros_iniciais(v_tenant);
  perform app.criar_calendario_padrao(v_tenant);
  perform app.copiar_feriados_nacionais(v_tenant);

  select email into v_email from public.usuarios where id = p_dono;

  insert into public.tenant_membros
    (tenant_id, usuario_id, tipo, organizacao_id, origem, login, admin, perfil_id)
  values
    (v_tenant, p_dono, 'interno', v_org, 'manual', split_part(v_email, '@', 1), true,
     (select id from public.perfis_acesso where tenant_id = v_tenant and nome = 'Administrador de TI'));

  return v_tenant;
end $$;

revoke all on function app.provisionar_tenant(text, text, uuid) from public, anon, authenticated;

-- Primeiro login com dominio verificado: substitui o auto-cadastro do
-- GLPI. Entra como usuario final (ou o perfil definido no dominio).
create or replace function app.ao_criar_usuario_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dominio text := lower(split_part(coalesce(new.email, ''), '@', 2));
  v_tenant  uuid;
  v_perfil  uuid;
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

  select d.tenant_id, d.perfil_padrao_id into v_tenant, v_perfil
    from public.tenant_dominios d
    join public.tenants t on t.id = d.tenant_id and t.ativo
   where d.dominio = v_dominio and d.verificado;

  if v_tenant is not null then
    select id into v_org
      from public.organizacoes
     where tenant_id = v_tenant and pai_id is null and relacao = 'interna' and ativo
     order by criado_em
     limit 1;

    if v_perfil is null then
      select id into v_perfil from public.perfis_acesso
       where tenant_id = v_tenant and nome = 'Usuário final';
    end if;

    insert into public.tenant_membros
      (tenant_id, usuario_id, tipo, organizacao_id, origem, login, perfil_id)
    values (v_tenant, new.id, 'interno', v_org,
            case when coalesce(new.raw_app_meta_data->>'provider', '') like 'sso%'
                 then 'sso' else 'dominio' end,
            split_part(new.email, '@', 1), v_perfil)
    on conflict do nothing;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 7. Acesso da pessoa logada (substitui minhas_permissoes)
-- ---------------------------------------------------------------------
create or replace function public.meu_acesso(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'admin',           m.admin,
    'perfil_id',       m.perfil_id,
    'equipe_id',       m.equipe_id,
    'login',           m.login,
    'departamento',    m.departamento,
    'modulos',         coalesce((select jsonb_agg(pm.modulo_key)
                                   from public.perfil_modulos pm
                                   join public.perfis_acesso p on p.id = pm.perfil_id and p.ativo
                                  where pm.perfil_id = m.perfil_id), '[]'::jsonb),
    'funcionalidades', coalesce((select jsonb_agg(pf.feature_key)
                                   from public.perfil_features pf
                                   join public.perfis_acesso p on p.id = pf.perfil_id and p.ativo
                                  where pf.perfil_id = m.perfil_id), '[]'::jsonb))
    from public.tenant_membros m
   where m.tenant_id = p_tenant and m.usuario_id = auth.uid() and m.ativo
$$;

revoke all on function public.meu_acesso(uuid) from public, anon;
grant execute on function public.meu_acesso(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Seguranca das tabelas novas + auditoria
-- ---------------------------------------------------------------------
revoke all on public.perfis_acesso, public.perfil_modulos, public.perfil_features from anon;

alter table public.perfis_acesso   enable row level security;
alter table public.perfil_modulos  enable row level security;
alter table public.perfil_features enable row level security;

create policy perfis_ler on public.perfis_acesso for select to authenticated
  using (app.eh_interno(tenant_id));
create policy perfis_incluir on public.perfis_acesso for insert to authenticated
  with check (not sistema and app.tem_permissao(tenant_id, 'admin.permissoes'));
create policy perfis_alterar on public.perfis_acesso for update to authenticated
  using (app.tem_permissao(tenant_id, 'admin.permissoes'))
  with check (app.tem_permissao(tenant_id, 'admin.permissoes'));

create policy pm_ler on public.perfil_modulos for select to authenticated
  using (app.eh_interno(tenant_id));
create policy pm_incluir on public.perfil_modulos for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'admin.permissoes'));
create policy pm_excluir on public.perfil_modulos for delete to authenticated
  using (app.tem_permissao(tenant_id, 'admin.permissoes'));

create policy pf_ler on public.perfil_features for select to authenticated
  using (app.eh_interno(tenant_id));
create policy pf_incluir on public.perfil_features for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'admin.permissoes'));
create policy pf_excluir on public.perfil_features for delete to authenticated
  using (app.tem_permissao(tenant_id, 'admin.permissoes'));

create trigger tg_perfis_acesso_atualizado before update on public.perfis_acesso
  for each row execute function app.tocar_atualizado_em();
create trigger tg_perfis_acesso_auditoria after insert or update or delete on public.perfis_acesso
  for each row execute function app.auditar();
create trigger tg_perfil_modulos_auditoria after insert or update or delete on public.perfil_modulos
  for each row execute function app.auditar();
create trigger tg_perfil_features_auditoria after insert or update or delete on public.perfil_features
  for each row execute function app.auditar();

-- ---------------------------------------------------------------------
-- 9. Salvar modulos e funcionalidades numa transacao (como o legado).
--    SECURITY INVOKER: roda com a sessao de quem chamou, sob o RLS.
--    "/" sempre entra: sem painel inicial nao ha para onde ir ao entrar.
-- ---------------------------------------------------------------------
create or replace function public.salvar_permissoes_perfil(
  p_perfil uuid, p_modulos text[], p_features text[]
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.perfis_acesso where id = p_perfil;
  if v_tenant is null then
    raise exception 'Perfil % não encontrado', p_perfil using errcode = 'P0002';
  end if;

  delete from public.perfil_modulos where perfil_id = p_perfil;
  delete from public.perfil_features where perfil_id = p_perfil;

  insert into public.perfil_modulos (tenant_id, perfil_id, modulo_key)
  select distinct v_tenant, p_perfil, m from unnest(array['/'] || p_modulos) as m;

  insert into public.perfil_features (tenant_id, perfil_id, feature_key)
  select distinct v_tenant, p_perfil, f from unnest(p_features) as f;
end $$;

revoke all on function public.salvar_permissoes_perfil(uuid, text[], text[]) from public, anon;
grant execute on function public.salvar_permissoes_perfil(uuid, text[], text[]) to authenticated;
