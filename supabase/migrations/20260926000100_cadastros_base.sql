-- =====================================================================
-- Passo 3 - Cadastros base (multi-tenant)
--   equipes, categorias, localidades, expediente, feriados
--   + feriados nacionais mantidos pela plataforma (um cadastro para todos)
--
-- Origem no legado: db/postgres/01, 16 e 18. Mudancas:
--   - tenant_id + FK composta em tudo; nomes unicos POR tenant
--   - SMALLINT 0/1 -> boolean; TIMESTAMP -> timestamptz
--   - expediente sempre ligado a uma localidade (a "padrao" substitui o
--     antigo localidade_id nulo)
--   - feriado nacional sai do tenant e vira cadastro da plataforma
--   - usuarios.equipe_id vira tenant_membros.equipe_id (equipe por empresa)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissao nova + concessao aos administradores ja existentes.
-- Papel de sistema so recebe permissao nova por migration: este bloco e
-- o modelo para as proximas.
-- ---------------------------------------------------------------------
insert into public.permissoes (chave, descricao, grupo) values
  ('cadastro.gerenciar', 'Equipes, categorias, localidades e calendario', 'Administracao');

insert into public.papel_permissoes (tenant_id, papel_id, permissao)
select p.tenant_id, p.id, 'cadastro.gerenciar'
  from public.papeis p
 where p.chave = 'admin_tenant'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Equipes
-- ---------------------------------------------------------------------
create table public.equipes (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  nome           text not null,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_equipes primary key (id),
  constraint uq_equipes_tenant_id unique (tenant_id, id),
  constraint uq_equipes_nome unique (tenant_id, nome)
);

alter table public.tenant_membros add column equipe_id uuid;
alter table public.tenant_membros
  add constraint fk_membros_equipe foreign key (tenant_id, equipe_id)
  references public.equipes (tenant_id, id);
create index ix_membros_equipe on public.tenant_membros (tenant_id, equipe_id);

-- ---------------------------------------------------------------------
-- Categorias (por escopo, como no legado)
-- ---------------------------------------------------------------------
create table public.categorias (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  nome           text not null,
  escopo         text not null check (escopo in ('chamado', 'servico', 'artigo', 'sistema')),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_categorias primary key (id),
  constraint uq_categorias_tenant_id unique (tenant_id, id),
  constraint uq_categorias_nome unique (tenant_id, escopo, nome)
);

-- ---------------------------------------------------------------------
-- Localidades: cada uma com seu fuso, expediente e feriados locais.
-- Exatamente uma "padrao" por tenant (usada quando nada mais se aplica).
-- ---------------------------------------------------------------------
create table public.localidades (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  nome           text not null,
  pais           char(2) not null default 'BR',
  regiao         text,
  cidade         text,
  fuso_horario   text not null default 'America/Sao_Paulo',
  padrao         boolean not null default false,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_localidades primary key (id),
  constraint uq_localidades_tenant_id unique (tenant_id, id),
  constraint uq_localidades_nome unique (tenant_id, nome),
  constraint ck_localidades_padrao_ativa check (not padrao or ativo)
);
create unique index ux_localidades_padrao on public.localidades (tenant_id) where padrao;

-- ---------------------------------------------------------------------
-- Expediente: faixas de minutos por dia (1 = segunda ... 7 = domingo)
-- ---------------------------------------------------------------------
create table public.expediente (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null,
  localidade_id  uuid not null,
  dia_semana     smallint not null check (dia_semana between 1 and 7),
  minuto_ini     smallint not null check (minuto_ini between 0 and 1440),
  minuto_fim     smallint not null check (minuto_fim between 0 and 1440),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  constraint pk_expediente primary key (id),
  constraint ck_expediente_ordem check (minuto_fim > minuto_ini),
  constraint uq_expediente unique (tenant_id, localidade_id, dia_semana, minuto_ini),
  constraint fk_expediente_localidade foreign key (tenant_id, localidade_id)
    references public.localidades (tenant_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Feriados nacionais: cadastro unico da plataforma, lido por todos.
-- Sem politica de escrita: so migration/SQL administrativo alteram.
-- ---------------------------------------------------------------------
create table public.feriados_plataforma (
  id          uuid primary key default app.uuid_v7(),
  pais        char(2) not null default 'BR',
  data        date not null,
  descricao   text not null,
  tipo        text not null default 'nacional' check (tipo in ('nacional', 'facultativo')),
  recorrente  boolean not null default false,
  ativo       boolean not null default true,
  mes         smallint generated always as (extract(month from data)::smallint) stored,
  dia         smallint generated always as (extract(day from data)::smallint) stored,
  constraint uq_feriados_plataforma unique (pais, data)
);

insert into public.feriados_plataforma (data, descricao, tipo, recorrente) values
  ('2026-01-01', 'Confraternizacao Universal', 'nacional', true),
  ('2026-04-21', 'Tiradentes',                 'nacional', true),
  ('2026-05-01', 'Dia do Trabalho',            'nacional', true),
  ('2026-09-07', 'Independencia do Brasil',    'nacional', true),
  ('2026-10-12', 'Nossa Senhora Aparecida',    'nacional', true),
  ('2026-11-02', 'Finados',                    'nacional', true),
  ('2026-11-15', 'Proclamacao da Republica',   'nacional', true),
  ('2026-11-20', 'Consciencia Negra',          'nacional', true),
  ('2026-12-25', 'Natal',                      'nacional', true),
  ('2026-02-16', 'Carnaval',                   'facultativo', false),
  ('2026-02-17', 'Carnaval',                   'facultativo', false),
  ('2026-04-03', 'Sexta-feira Santa',          'nacional', false),
  ('2026-06-04', 'Corpus Christi',             'facultativo', false),
  ('2027-02-08', 'Carnaval',                   'facultativo', false),
  ('2027-02-09', 'Carnaval',                   'facultativo', false),
  ('2027-03-26', 'Sexta-feira Santa',          'nacional', false),
  ('2027-05-27', 'Corpus Christi',             'facultativo', false);

-- ---------------------------------------------------------------------
-- Feriados do tenant: estaduais, municipais, facultativos e da empresa.
-- localidade_id nulo = vale para todas as localidades do tenant.
-- ---------------------------------------------------------------------
create table public.feriados (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  localidade_id  uuid,
  data           date not null,
  descricao      text not null,
  tipo           text not null check (tipo in ('estadual', 'municipal', 'facultativo', 'empresa')),
  recorrente     boolean not null default false,
  ativo          boolean not null default true,
  mes            smallint generated always as (extract(month from data)::smallint) stored,
  dia            smallint generated always as (extract(day from data)::smallint) stored,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_feriados primary key (id),
  constraint uq_feriados unique nulls not distinct (tenant_id, localidade_id, data),
  constraint ck_feriados_localidade check (tipo in ('facultativo', 'empresa') or localidade_id is not null),
  constraint fk_feriados_localidade foreign key (tenant_id, localidade_id)
    references public.localidades (tenant_id, id)
);
create index ix_feriados_recorrencia on public.feriados (tenant_id, recorrente, mes, dia);

-- ---------------------------------------------------------------------
-- Triggers: atualizado_em + auditoria
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['equipes','categorias','localidades','feriados'] loop
    execute format('create trigger tg_%1$s_atualizado before update on public.%1$I
                    for each row execute function app.tocar_atualizado_em()', t);
  end loop;
  foreach t in array array['equipes','categorias','localidades','expediente','feriados'] loop
    execute format('create trigger tg_%1$s_auditoria after insert or update or delete on public.%1$I
                    for each row execute function app.auditar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Calendario padrao de um tenant novo: localidade "Matriz" com
-- expediente de segunda a sexta, 08h-12h e 14h-18h (igual ao legado).
-- ---------------------------------------------------------------------
create or replace function app.criar_calendario_padrao(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_local uuid;
  v_fuso  text;
begin
  if exists (select 1 from public.localidades where tenant_id = p_tenant) then
    return;
  end if;

  select fuso_horario into v_fuso from public.tenants where id = p_tenant;

  insert into public.localidades (tenant_id, nome, fuso_horario, padrao)
  values (p_tenant, 'Matriz', coalesce(v_fuso, 'America/Sao_Paulo'), true)
  returning id into v_local;

  insert into public.expediente (tenant_id, localidade_id, dia_semana, minuto_ini, minuto_fim)
  select p_tenant, v_local, d, faixa.ini, faixa.fim
    from generate_series(1, 5) as d
   cross join (values (480, 720), (840, 1080)) as faixa(ini, fim);
end $$;

revoke all on function app.criar_calendario_padrao(uuid) from public, anon, authenticated;

-- provisionar_tenant passa a criar o calendario junto.
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
  perform app.criar_calendario_padrao(v_tenant);

  insert into public.tenant_membros (tenant_id, usuario_id, tipo, organizacao_id, origem)
  values (v_tenant, p_dono, 'interno', v_org, 'manual');

  insert into public.atribuicoes (tenant_id, usuario_id, papel_id)
  select v_tenant, p_dono, id from public.papeis
   where tenant_id = v_tenant and chave = 'admin_tenant';

  return v_tenant;
end $$;

revoke all on function app.provisionar_tenant(text, text, uuid) from public, anon, authenticated;

-- Papel padrao dos tenants novos tambem ganha a permissao nova.
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

revoke all on function app.criar_papeis_padrao(uuid) from public, anon, authenticated;

-- Tenants que ja existem (ex.: Ypper Tech) ganham o calendario agora.
do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.criar_calendario_padrao(t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seguranca
-- ---------------------------------------------------------------------
revoke all on public.equipes, public.categorias, public.localidades, public.expediente,
  public.feriados, public.feriados_plataforma
from anon;

alter table public.equipes             enable row level security;
alter table public.categorias          enable row level security;
alter table public.localidades         enable row level security;
alter table public.expediente          enable row level security;
alter table public.feriados            enable row level security;
alter table public.feriados_plataforma enable row level security;

-- Leitura: equipe interna do tenant. Categorias: qualquer membro, porque
-- o solicitante escolhe categoria ao abrir chamado.
create policy equipes_ler on public.equipes for select to authenticated
  using (app.eh_interno(tenant_id));
create policy categorias_ler on public.categorias for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()));
create policy localidades_ler on public.localidades for select to authenticated
  using (app.eh_interno(tenant_id));
create policy expediente_ler on public.expediente for select to authenticated
  using (app.eh_interno(tenant_id));
create policy feriados_ler on public.feriados for select to authenticated
  using (app.eh_interno(tenant_id));
create policy feriados_plataforma_ler on public.feriados_plataforma for select to authenticated
  using (true);

-- Escrita: cadastro.gerenciar. Cadastro principal nao se exclui (desativa);
-- faixas de expediente e feriados sao configuracao e podem ser excluidos.
create policy equipes_incluir on public.equipes for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy equipes_alterar on public.equipes for update to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));

create policy categorias_incluir on public.categorias for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy categorias_alterar on public.categorias for update to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));

create policy localidades_incluir on public.localidades for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy localidades_alterar on public.localidades for update to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));

create policy expediente_incluir on public.expediente for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy expediente_alterar on public.expediente for update to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy expediente_excluir on public.expediente for delete to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));

create policy feriados_incluir on public.feriados for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy feriados_alterar on public.feriados for update to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy feriados_excluir on public.feriados for delete to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
