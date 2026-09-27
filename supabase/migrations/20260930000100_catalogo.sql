-- =====================================================================
-- Catalogo: servicos e sistemas (categorias ja existem)
--
-- Origem: db/postgres/01-schema.sql e 04-seed-catalogo.sql. Mesmas
-- colunas e regras; diferencas so do multi-empresa:
--   - tenant_id + FK composta em tudo;
--   - responsavel/atribuicao do sistema apontam para um MEMBRO da mesma
--     empresa (nao da para indicar alguem de outra empresa);
--   - nome do sistema unico por empresa.
-- =====================================================================

create table public.servicos (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  nome           text not null,
  categoria_id   uuid,
  descricao      text,
  tipo_padrao    text not null
                 check (tipo_padrao in ('incidente','requisicao','melhoria','problema','tarefa')),
  sla_horas      integer not null check (sla_horas > 0),
  equipe_id      uuid,
  gerado_por_ia  boolean not null default false,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint pk_servicos primary key (id),
  constraint uq_servicos_tenant_id unique (tenant_id, id),
  constraint fk_servicos_categoria foreign key (tenant_id, categoria_id)
    references public.categorias (tenant_id, id),
  constraint fk_servicos_equipe foreign key (tenant_id, equipe_id)
    references public.equipes (tenant_id, id)
);
create index ix_servicos_tenant on public.servicos (tenant_id, ativo, nome);

create table public.sistemas (
  id              uuid not null default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  nome            text not null,
  descricao       text,
  categoria_id    uuid,
  responsavel_id  uuid,
  atribuicao_id   uuid,
  equipe_id       uuid,
  criticidade     text not null check (criticidade in ('alta','media','baixa')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint pk_sistemas primary key (id),
  constraint uq_sistemas_tenant_id unique (tenant_id, id),
  constraint uq_sistemas_nome unique (tenant_id, nome),
  constraint fk_sistemas_categoria foreign key (tenant_id, categoria_id)
    references public.categorias (tenant_id, id),
  constraint fk_sistemas_equipe foreign key (tenant_id, equipe_id)
    references public.equipes (tenant_id, id),
  constraint fk_sistemas_responsavel foreign key (tenant_id, responsavel_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_sistemas_atribuicao foreign key (tenant_id, atribuicao_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_sistemas_tenant on public.sistemas (tenant_id, ativo, nome);

-- ---------------------------------------------------------------------
-- Triggers: atualizado_em + auditoria
-- ---------------------------------------------------------------------
create trigger tg_servicos_atualizado before update on public.servicos
  for each row execute function app.tocar_atualizado_em();
create trigger tg_sistemas_atualizado before update on public.sistemas
  for each row execute function app.tocar_atualizado_em();
create trigger tg_servicos_auditoria after insert or update or delete on public.servicos
  for each row execute function app.auditar();
create trigger tg_sistemas_auditoria after insert or update or delete on public.sistemas
  for each row execute function app.auditar();

-- ---------------------------------------------------------------------
-- Carga inicial do legado (04-seed-catalogo.sql), por empresa.
-- Categorias e equipes sao localizadas pelo nome da carga inicial; se a
-- empresa ja as renomeou, o campo fica vazio em vez de falhar.
-- ---------------------------------------------------------------------
create or replace function app.criar_catalogo_inicial(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.servicos where tenant_id = p_tenant)
     or exists (select 1 from public.sistemas where tenant_id = p_tenant) then
    return;
  end if;

  insert into public.servicos
    (tenant_id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id)
  select p_tenant, v.nome,
         (select id from public.categorias
           where tenant_id = p_tenant and escopo = 'servico' and nome = v.categoria),
         v.descricao, v.tipo, v.sla,
         (select id from public.equipes where tenant_id = p_tenant and nome = v.equipe)
    from (values
      ('Acesso a sistemas', 'Acessos',
       'Criação, alteração e revogação de acessos a sistemas corporativos.',
       'requisicao', 24, 'Service Desk'),
      ('Estação de trabalho', 'Infraestrutura',
       'Instalação, configuração e manutenção de computadores e periféricos.',
       'requisicao', 24, 'Service Desk'),
      ('Rede e conectividade', 'Infraestrutura',
       'Links, switches, Wi-Fi e conectividade entre unidades.',
       'incidente', 8, 'Infraestrutura'),
      ('Sistemas corporativos', 'Sistemas',
       'Suporte funcional e técnico aos sistemas de negócio.',
       'incidente', 4, 'Sistemas'),
      ('E-mail e colaboração', 'Sistemas',
       'Caixas postais, listas de distribuição e ferramentas de colaboração.',
       'requisicao', 24, 'Service Desk'),
      ('Relatórios e indicadores', 'Sistemas',
       'Extrações, painéis e relatórios gerenciais.',
       'melhoria', 72, 'Sistemas')
    ) as v(nome, categoria, descricao, tipo, sla, equipe);

  insert into public.sistemas (tenant_id, nome, categoria_id, equipe_id, criticidade)
  select p_tenant, v.nome,
         (select id from public.categorias
           where tenant_id = p_tenant and escopo = 'sistema' and nome = v.categoria),
         (select id from public.equipes where tenant_id = p_tenant and nome = v.equipe),
         v.criticidade
    from (values
      ('ERP', 'Aplicações', 'Sistemas', 'alta'),
      ('Portal do Colaborador', 'Aplicações', 'Service Desk', 'media'),
      ('Active Directory', 'Infraestrutura', 'Infraestrutura', 'alta'),
      ('E-mail corporativo', 'Infraestrutura', 'Service Desk', 'alta'),
      ('Rede e Wi-Fi', 'Infraestrutura', 'Infraestrutura', 'alta'),
      ('Estações de trabalho', 'Infraestrutura', 'Service Desk', 'media')
    ) as v(nome, categoria, equipe, criticidade)
  on conflict do nothing;
end $$;

revoke all on function app.criar_catalogo_inicial(uuid) from public, anon, authenticated;

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
  perform app.criar_catalogo_inicial(v_tenant);
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

-- Empresas que ja existem recebem a carga inicial agora.
do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.criar_catalogo_inicial(t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seguranca. Leitura: qualquer membro da empresa (o solicitante escolhe
-- servico e sistema ao abrir chamado). Escrita: administrador, como no
-- legado. Sem DELETE: desativa com ativo = false.
-- ---------------------------------------------------------------------
revoke all on public.servicos, public.sistemas from anon;

alter table public.servicos enable row level security;
alter table public.sistemas enable row level security;

create policy servicos_ler on public.servicos for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()));
create policy servicos_incluir on public.servicos for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'admin.sistemas'));
create policy servicos_alterar on public.servicos for update to authenticated
  using (app.tem_permissao(tenant_id, 'admin.sistemas'))
  with check (app.tem_permissao(tenant_id, 'admin.sistemas'));

create policy sistemas_ler on public.sistemas for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()));
create policy sistemas_incluir on public.sistemas for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'admin.sistemas'));
create policy sistemas_alterar on public.sistemas for update to authenticated
  using (app.tem_permissao(tenant_id, 'admin.sistemas'))
  with check (app.tem_permissao(tenant_id, 'admin.sistemas'));
