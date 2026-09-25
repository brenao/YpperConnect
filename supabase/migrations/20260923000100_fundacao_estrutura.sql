-- =====================================================================
-- Passo 1a - Fundacao multi-tenant: estrutura
-- Regras: tenant_id em toda tabela de negocio, FK composta
-- (tenant_id, id) para impedir referencia entre tenants, nada de DELETE
-- em cadastro (desativar com `ativo = false`).
-- =====================================================================

create schema if not exists app;

-- UUID v7: ordenavel por tempo, melhor para indices que o v4.
create or replace function app.uuid_v7() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  b  bytea  := uuid_send(gen_random_uuid());
begin
  b := set_byte(b, 0, ((ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ms & 255)::int);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);
  return encode(b, 'hex')::uuid;
end $$;

create or replace function app.tocar_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Plataforma
-- ---------------------------------------------------------------------
create table public.tenants (
  id             uuid primary key default app.uuid_v7(),
  slug           text not null unique
                 check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  nome           text not null,
  fuso_horario   text not null default 'America/Sao_Paulo',
  plano          text not null default 'padrao',
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Quem opera a plataforma (cria tenants). Sem politica = invisivel via API.
create table public.plataforma_admins (
  usuario_id  uuid primary key references auth.users (id) on delete cascade,
  criado_em   timestamptz not null default now()
);

-- Catalogo de permissoes: fica em migration, nao e dado do tenant.
create table public.permissoes (
  chave      text primary key,
  descricao  text not null,
  grupo      text not null
);

insert into public.permissoes (chave, descricao, grupo) values
  ('tenant.configurar',     'Configurar o tenant, dominios e SSO',     'Administracao'),
  ('usuario.gerenciar',     'Convidar, importar e desativar usuarios', 'Administracao'),
  ('papel.gerenciar',       'Criar papeis e atribuir acessos',         'Administracao'),
  ('organizacao.gerenciar', 'Cadastrar empresas, clientes e areas',    'Administracao'),
  ('auditoria.ver',         'Consultar a trilha de auditoria',         'Administracao'),
  ('mesa.gerenciar',        'Configurar mesas de servico',             'Atendimento'),
  ('catalogo.gerenciar',    'Editar catalogo de servicos',             'Atendimento'),
  ('chamado.criar',         'Abrir chamados',                          'Atendimento'),
  ('chamado.ver_todos',     'Ver todos os chamados da mesa',           'Atendimento'),
  ('chamado.tratar',        'Tratar chamados',                         'Atendimento'),
  ('conhecimento.editar',   'Publicar artigos',                        'Atendimento'),
  ('projeto.criar',         'Criar projetos',                          'Projetos'),
  ('projeto.ver_portfolio', 'Ver portfolio da equipe',                 'Projetos'),
  ('projeto.diretoria',     'Visao de diretoria (leitura total)',      'Projetos');

-- ---------------------------------------------------------------------
-- Identidade global: 1 linha por pessoa, espelho de auth.users
-- ---------------------------------------------------------------------
create table public.usuarios (
  id             uuid primary key references auth.users (id) on delete cascade,
  nome           text not null,
  email          text,
  avatar_url     text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index ix_usuarios_email on public.usuarios (email);

-- ---------------------------------------------------------------------
-- Organizacoes: empresas (internas ou clientes) e areas (hierarquia)
-- ---------------------------------------------------------------------
create table public.organizacoes (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  pai_id         uuid,
  tipo           text not null check (tipo in ('empresa', 'area')),
  relacao        text check (relacao in ('interna', 'cliente')),
  nome           text not null,
  documento      text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_organizacoes primary key (id),
  constraint uq_organizacoes_tenant_id unique (tenant_id, id),
  constraint uq_organizacoes_nome unique nulls not distinct (tenant_id, pai_id, nome),
  constraint ck_organizacoes_relacao check ((tipo = 'empresa') = (relacao is not null)),
  constraint ck_organizacoes_pai check (pai_id <> id),
  constraint fk_organizacoes_pai foreign key (tenant_id, pai_id)
    references public.organizacoes (tenant_id, id)
);
create index ix_organizacoes_pai on public.organizacoes (tenant_id, pai_id);

-- ---------------------------------------------------------------------
-- Vinculo pessoa x tenant
--   interno = colaborador de quem presta o servico
--   cliente = solicitante de uma organizacao cliente (ve so a dele)
-- ---------------------------------------------------------------------
create table public.tenant_membros (
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  usuario_id      uuid not null references public.usuarios (id) on delete cascade,
  tipo            text not null check (tipo in ('interno', 'cliente')),
  organizacao_id  uuid,
  id_externo      text,
  origem          text not null default 'manual'
                  check (origem in ('manual','convite','importacao','dominio','sso','scim','api')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint pk_tenant_membros primary key (tenant_id, usuario_id),
  constraint uq_membros_id_externo unique (tenant_id, id_externo),
  constraint ck_membros_cliente_org check (tipo = 'interno' or organizacao_id is not null),
  constraint fk_membros_org foreign key (tenant_id, organizacao_id)
    references public.organizacoes (tenant_id, id)
);
create index ix_membros_usuario on public.tenant_membros (usuario_id) where ativo;

-- ---------------------------------------------------------------------
-- Papeis (dados do tenant) e suas permissoes
-- ---------------------------------------------------------------------
create table public.papeis (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  chave          text not null,
  nome           text not null,
  descricao      text,
  escopo         text not null default 'tenant'
                 check (escopo in ('tenant','mesa','organizacao','projeto')),
  sistema        boolean not null default false,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_papeis primary key (id),
  constraint uq_papeis_tenant_id unique (tenant_id, id),
  constraint uq_papeis_chave unique (tenant_id, chave)
);

create table public.papel_permissoes (
  tenant_id  uuid not null,
  papel_id   uuid not null,
  permissao  text not null references public.permissoes (chave),
  constraint pk_papel_permissoes primary key (papel_id, permissao),
  constraint fk_pp_papel foreign key (tenant_id, papel_id)
    references public.papeis (tenant_id, id) on delete cascade
);

-- escopo_id aponta para mesa/organizacao/projeto conforme escopo_tipo.
-- Sem FK porque e polimorfico; mesas e projetos entram em passos seguintes.
create table public.atribuicoes (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null,
  usuario_id   uuid not null,
  papel_id     uuid not null,
  escopo_tipo  text not null default 'tenant'
               check (escopo_tipo in ('tenant','mesa','organizacao','projeto')),
  escopo_id    uuid,
  criado_em    timestamptz not null default now(),
  constraint ck_atrib_escopo check ((escopo_tipo = 'tenant') = (escopo_id is null)),
  constraint uq_atribuicoes unique nulls not distinct
    (tenant_id, usuario_id, papel_id, escopo_tipo, escopo_id),
  constraint fk_atrib_membro foreign key (tenant_id, usuario_id)
    references public.tenant_membros (tenant_id, usuario_id) on delete cascade,
  constraint fk_atrib_papel foreign key (tenant_id, papel_id)
    references public.papeis (tenant_id, id)
);
create index ix_atribuicoes_usuario on public.atribuicoes (usuario_id, tenant_id);

-- ---------------------------------------------------------------------
-- Dominios: quem se cadastra com @dominio verificado entra no tenant.
-- `verificado` so a plataforma liga (senao alguem reivindica gmail.com).
-- ---------------------------------------------------------------------
create table public.tenant_dominios (
  dominio          text primary key
                   check (dominio = lower(dominio) and dominio ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  verificado       boolean not null default false,
  papel_padrao_id  uuid,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint fk_dominio_papel foreign key (tenant_id, papel_padrao_id)
    references public.papeis (tenant_id, id)
);

-- ---------------------------------------------------------------------
-- Auditoria generica (imutavel). Sem FK para sobreviver a exclusoes.
-- ---------------------------------------------------------------------
create table public.auditoria (
  id           bigint generated always as identity primary key,
  tenant_id    uuid,
  tabela       text not null,
  registro_id  text,
  operacao     text not null,
  usuario_id   uuid,
  antes        jsonb,
  depois       jsonb,
  criado_em    timestamptz not null default now()
);
create index ix_auditoria_tenant on public.auditoria (tenant_id, criado_em desc);
create index ix_auditoria_registro on public.auditoria (tabela, registro_id);

create or replace function app.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_antes  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_depois jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_linha  jsonb := coalesce(v_depois, v_antes);
begin
  if tg_op = 'UPDATE' and v_antes - 'atualizado_em' = v_depois - 'atualizado_em' then
    return new;
  end if;
  insert into public.auditoria (tenant_id, tabela, registro_id, operacao, usuario_id, antes, depois)
  values (
    case when tg_table_name = 'tenants' then (v_linha->>'id')::uuid
         else (v_linha->>'tenant_id')::uuid end,
    tg_table_name,
    coalesce(v_linha->>'id', v_linha->>'usuario_id', v_linha->>'papel_id'),
    tg_op,
    auth.uid(),
    v_antes,
    v_depois
  );
  return coalesce(new, old);
end $$;

-- Triggers: atualizado_em + auditoria
do $$
declare t text;
begin
  foreach t in array array['tenants','usuarios','organizacoes','tenant_membros','papeis','tenant_dominios'] loop
    execute format('create trigger tg_%1$s_atualizado before update on public.%1$I
                    for each row execute function app.tocar_atualizado_em()', t);
  end loop;
  foreach t in array array['tenants','organizacoes','tenant_membros','papeis','papel_permissoes','atribuicoes','tenant_dominios'] loop
    execute format('create trigger tg_%1$s_auditoria after insert or update or delete on public.%1$I
                    for each row execute function app.auditar()', t);
  end loop;
end $$;
