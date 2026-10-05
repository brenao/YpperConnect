-- =====================================================================
-- Projetos (P1): estrutura completa, por empresa
--
-- Origem: db/postgres/01-schema.sql e os scripts 05, 08, 09, 10, 14,
-- 15, 19, 20, 21 e 23. Mesmas colunas e regras; diferencas:
--   - tenant_id + FK composta em tudo (gerente, sponsor, responsaveis,
--     recursos e autores sao da mesma empresa);
--   - projeto nunca e apagado (exclusao logica);
--   - vinculos editaveis (responsaveis, dependencias, acessos,
--     preferencias) podem ser removidos, com auditoria;
--   - configuracao do backlog por empresa.
-- Regras de quem ve e edita cada projeto (gerente, sponsor, portfolio,
-- diretoria, sigilo) ficam no repositorio, como no legado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------
create table public.projetos (
  id               uuid not null default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  nome             text not null,
  objetivo         text,
  sponsor_id       uuid,
  gerente_id       uuid,
  status           text not null default 'planejamento'
                   check (status in ('backlog','planejamento','execucao','paralisado','cancelado','concluido')),
  inicio           date not null,
  fim              date not null,
  usa_dias_uteis   boolean not null default true,
  sigiloso         boolean not null default false,
  -- backlog (09)
  valor            smallint check (valor is null or valor between 1 and 5),
  esforco          numeric(7,2) check (esforco is null or esforco > 0),
  alcance          integer check (alcance is null or alcance >= 0),
  confianca        smallint check (confianca is null or confianca between 0 and 100),
  ordem_backlog    integer,
  area_demandante  text,
  justificativa    text,
  -- CAPEX (10)
  capex            numeric(14,2) check (capex is null or capex >= 0),
  moeda            text check (moeda is null or moeda in ('BRL','USD')),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  excluido_em      timestamptz,
  excluido_por     uuid,
  constraint pk_projetos primary key (id),
  constraint uq_projetos_tenant_id unique (tenant_id, id),
  constraint ck_projetos_periodo check (fim >= inicio),
  constraint ck_projetos_capex_moeda check (capex is null or moeda is not null),
  constraint fk_projetos_sponsor foreign key (tenant_id, sponsor_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_projetos_gerente foreign key (tenant_id, gerente_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_projetos_status on public.projetos (tenant_id, status);
create index ix_projetos_backlog on public.projetos (tenant_id, status, ordem_backlog);
create index ix_projetos_gerente on public.projetos (tenant_id, gerente_id);

-- ---------------------------------------------------------------------
-- Tarefas (WBS)
-- ---------------------------------------------------------------------
create table public.projeto_tarefas (
  id                uuid not null default app.uuid_v7(),
  tenant_id         uuid not null,
  projeto_id        uuid not null,
  pai_id            uuid,
  nome              text not null,
  atividade         text,
  inicio            date not null,
  fim               date not null,
  progresso         smallint not null default 0 check (progresso between 0 and 100),
  quadro            text not null default 'backlog' check (quadro in ('backlog','todo','doing','done')),
  marco             boolean not null default false,
  duracao           numeric(6,2),
  duracao_unidade   text check (duracao_unidade is null or duracao_unidade in ('dias','horas')),
  alocacao_pct      smallint check (alocacao_pct is null or alocacao_pct between 0 and 100),
  ordem             integer not null default 0,
  ativo             boolean not null default true,
  restricao_inicio  date,
  concluido_em      timestamptz,
  constraint pk_projeto_tarefas primary key (id),
  constraint uq_tarefas_tenant_id unique (tenant_id, id),
  constraint ck_tarefas_periodo check (fim >= inicio),
  constraint ck_tarefas_pai_self check (pai_id <> id),
  constraint fk_tarefas_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id),
  constraint fk_tarefas_pai foreign key (tenant_id, pai_id)
    references public.projeto_tarefas (tenant_id, id)
);
create index ix_tarefas_projeto on public.projeto_tarefas (tenant_id, projeto_id, ativo, ordem);
create index ix_tarefas_pai on public.projeto_tarefas (tenant_id, pai_id);
create index ix_tarefas_periodo on public.projeto_tarefas (tenant_id, inicio, fim);

create table public.tarefa_responsaveis (
  tenant_id   uuid not null,
  tarefa_id   uuid not null,
  recurso_id  uuid not null,
  principal   boolean not null default false,
  constraint pk_tarefa_responsaveis primary key (tarefa_id, recurso_id),
  constraint fk_tresp_tarefa foreign key (tenant_id, tarefa_id)
    references public.projeto_tarefas (tenant_id, id),
  constraint fk_tresp_recurso foreign key (tenant_id, recurso_id)
    references public.recursos (tenant_id, id)
);
create index ix_tresp_recurso on public.tarefa_responsaveis (tenant_id, recurso_id);

create table public.tarefa_predecessoras (
  tenant_id        uuid not null,
  tarefa_id        uuid not null,
  predecessora_id  uuid not null,
  tipo             text not null default 'TI' check (tipo in ('TI','II','TT','IT')),
  defasagem        smallint not null default 0 check (defasagem between -365 and 365),
  constraint pk_tarefa_predecessoras primary key (tarefa_id, predecessora_id),
  constraint ck_tpred_self check (tarefa_id <> predecessora_id),
  constraint fk_tpred_tarefa foreign key (tenant_id, tarefa_id)
    references public.projeto_tarefas (tenant_id, id),
  constraint fk_tpred_pred foreign key (tenant_id, predecessora_id)
    references public.projeto_tarefas (tenant_id, id)
);
create index ix_tpred_pred on public.tarefa_predecessoras (tenant_id, predecessora_id);

-- ---------------------------------------------------------------------
-- Acompanhamento: atualizacoes, riscos e pontos de atencao
-- ---------------------------------------------------------------------
create table public.projeto_atualizacoes (
  id                 uuid not null default app.uuid_v7(),
  tenant_id          uuid not null,
  projeto_id         uuid not null,
  autor_id           uuid,
  data_ref           date not null,
  descricao          text,
  ultimas_entregas   text,
  proximas_entregas  text,
  criado_em          timestamptz not null default now(),
  constraint pk_projeto_atualizacoes primary key (id),
  constraint fk_patual_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id),
  constraint fk_patual_autor foreign key (tenant_id, autor_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_patual_projeto on public.projeto_atualizacoes (tenant_id, projeto_id, data_ref desc);

create table public.projeto_riscos (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null,
  projeto_id     uuid not null,
  descricao      text not null,
  probabilidade  text not null check (probabilidade in ('alta','media','baixa')),
  impacto        text not null check (impacto in ('alto','medio','baixo')),
  mitigacao      text,
  status         text not null default 'aberto' check (status in ('aberto','monitorado','mitigado')),
  criado_em      timestamptz not null default now(),
  constraint pk_projeto_riscos primary key (id),
  constraint fk_riscos_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id)
);
create index ix_riscos_projeto on public.projeto_riscos (tenant_id, projeto_id);

create table public.projeto_atencoes (
  id                      uuid not null default app.uuid_v7(),
  tenant_id               uuid not null,
  projeto_id              uuid not null,
  titulo                  text not null,
  descricao               text,
  decisao_necessaria      text,
  responsavel_decisao_id  uuid,
  status                  text not null default 'aberto' check (status in ('aberto','resolvido')),
  criado_em               timestamptz not null default now(),
  resolvido_em            timestamptz,
  constraint pk_projeto_atencoes primary key (id),
  constraint fk_atencoes_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id),
  constraint fk_atencoes_responsavel foreign key (tenant_id, responsavel_decisao_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_atencoes_projeto on public.projeto_atencoes (tenant_id, projeto_id, status);

-- ---------------------------------------------------------------------
-- Baselines (fotografias do cronograma, versionadas)
-- ---------------------------------------------------------------------
create table public.projeto_baselines (
  id          uuid not null default app.uuid_v7(),
  tenant_id   uuid not null,
  projeto_id  uuid not null,
  versao      smallint not null,
  descricao   text,
  autor_id    uuid,
  criado_em   timestamptz not null default now(),
  constraint pk_projeto_baselines primary key (id),
  constraint uq_baselines_tenant_id unique (tenant_id, id),
  constraint uq_baseline_versao unique (tenant_id, projeto_id, versao),
  constraint fk_baseline_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id),
  constraint fk_baseline_autor foreign key (tenant_id, autor_id)
    references public.tenant_membros (tenant_id, usuario_id)
);

create table public.baseline_tarefas (
  tenant_id    uuid not null,
  baseline_id  uuid not null,
  tarefa_id    uuid not null,
  nome         text not null,
  inicio       date not null,
  fim          date not null,
  constraint pk_baseline_tarefas primary key (baseline_id, tarefa_id),
  constraint fk_bt_baseline foreign key (tenant_id, baseline_id)
    references public.projeto_baselines (tenant_id, id)
);

-- ---------------------------------------------------------------------
-- Acesso a projeto sigiloso (14)
-- ---------------------------------------------------------------------
create table public.projeto_solicitacoes_acesso (
  id               uuid not null default app.uuid_v7(),
  tenant_id        uuid not null,
  projeto_id       uuid not null,
  solicitante_id   uuid not null,
  justificativa    text,
  situacao         text not null default 'pendente'
                   check (situacao in ('pendente','aprovada','recusada','cancelada')),
  decidido_por_id  uuid,
  decidido_em      timestamptz,
  motivo_recusa    text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint pk_projeto_solicitacoes_acesso primary key (id),
  constraint fk_psa_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id),
  constraint fk_psa_solicitante foreign key (tenant_id, solicitante_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_psa_decidido_por foreign key (tenant_id, decidido_por_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create unique index ux_psa_pendente on public.projeto_solicitacoes_acesso (projeto_id, solicitante_id)
  where situacao = 'pendente';
create index ix_psa_projeto_situacao on public.projeto_solicitacoes_acesso (tenant_id, projeto_id, situacao);

create table public.projeto_acessos (
  tenant_id         uuid not null,
  projeto_id        uuid not null,
  usuario_id        uuid not null,
  concedido_por_id  uuid,
  origem            text not null default 'solicitacao' check (origem in ('solicitacao','manual')),
  criado_em         timestamptz not null default now(),
  constraint pk_projeto_acessos primary key (projeto_id, usuario_id),
  constraint fk_pa_projeto foreign key (tenant_id, projeto_id)
    references public.projetos (tenant_id, id),
  constraint fk_pa_usuario foreign key (tenant_id, usuario_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_pa_concedido_por foreign key (tenant_id, concedido_por_id)
    references public.tenant_membros (tenant_id, usuario_id)
);

-- ---------------------------------------------------------------------
-- Configuracoes por empresa (modelo de pontuacao do backlog) e
-- preferencias de interface por pessoa (23)
-- ---------------------------------------------------------------------
create table public.configuracoes (
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  chave          text not null,
  valor          text not null,
  descricao      text,
  atualizado_em  timestamptz not null default now(),
  constraint pk_configuracoes primary key (tenant_id, chave)
);

create table public.usuario_preferencias (
  usuario_id     uuid not null references public.usuarios (id) on delete cascade,
  chave          text not null,
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  constraint pk_usuario_preferencias primary key (usuario_id, chave)
);

create or replace function app.criar_configuracoes_padrao(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.configuracoes (tenant_id, chave, valor, descricao)
  values (p_tenant, 'priorizacao_modelo', 'simples',
          'Modelo de pontuação do backlog: simples (valor/esforço) ou rice.')
  on conflict do nothing
$$;
revoke all on function app.criar_configuracoes_padrao(uuid) from public, anon, authenticated;

do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.criar_configuracoes_padrao(t);
  end loop;
end $$;

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
  perform app.criar_configuracoes_padrao(v_tenant);

  select email into v_email from public.usuarios where id = p_dono;

  insert into public.tenant_membros
    (tenant_id, usuario_id, tipo, organizacao_id, origem, login, admin, perfil_id)
  values
    (v_tenant, p_dono, 'interno', v_org, 'manual', split_part(v_email, '@', 1), true,
     (select id from public.perfis_acesso where tenant_id = v_tenant and nome = 'Administrador de TI'));

  return v_tenant;
end $$;
revoke all on function app.provisionar_tenant(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  -- atualizado_em
  foreach t in array array['projetos','projeto_solicitacoes_acesso'] loop
    execute format('create trigger tg_%1$s_atualizado before update on public.%1$I
                    for each row execute function app.tocar_atualizado_em()', t);
  end loop;
  -- auditoria (inclusive remocao de vinculos)
  foreach t in array array['projetos','projeto_tarefas','tarefa_responsaveis','tarefa_predecessoras',
                           'projeto_riscos','projeto_atencoes','projeto_baselines',
                           'projeto_solicitacoes_acesso','projeto_acessos','configuracoes'] loop
    execute format('create trigger tg_%1$s_auditoria after insert or update or delete on public.%1$I
                    for each row execute function app.auditar()', t);
  end loop;
  -- registros de negocio: nunca apagados
  foreach t in array array['projetos','projeto_tarefas','projeto_atualizacoes','projeto_riscos',
                           'projeto_atencoes','projeto_baselines','baseline_tarefas',
                           'projeto_solicitacoes_acesso'] loop
    execute format('create trigger tg_%1$s_sem_exclusao_fisica before delete on public.%1$I
                    for each row execute function app.bloquear_exclusao_fisica()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seguranca. Projetos sao da equipe interna da empresa; as regras finas
-- (gerente, sponsor, portfolio, diretoria, sigilo) ficam no repositorio.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['projetos','projeto_tarefas','tarefa_responsaveis','tarefa_predecessoras',
                           'projeto_atualizacoes','projeto_riscos','projeto_atencoes',
                           'projeto_baselines','baseline_tarefas','projeto_solicitacoes_acesso',
                           'projeto_acessos','configuracoes','usuario_preferencias'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- leitura e escrita pela equipe interna da empresa
  foreach t in array array['projeto_tarefas','tarefa_responsaveis','tarefa_predecessoras',
                           'projeto_atualizacoes','projeto_riscos','projeto_atencoes',
                           'projeto_baselines','baseline_tarefas','projeto_solicitacoes_acesso',
                           'projeto_acessos'] loop
    execute format('create policy %1$s_ler on public.%1$I for select to authenticated
                    using (app.eh_interno(tenant_id))', t);
    execute format('create policy %1$s_incluir on public.%1$I for insert to authenticated
                    with check (app.eh_interno(tenant_id))', t);
    execute format('create policy %1$s_alterar on public.%1$I for update to authenticated
                    using (app.eh_interno(tenant_id)) with check (app.eh_interno(tenant_id))', t);
  end loop;

  -- vinculos editaveis: podem ser removidos (fica na auditoria)
  foreach t in array array['tarefa_responsaveis','tarefa_predecessoras','projeto_acessos'] loop
    execute format('create policy %1$s_excluir on public.%1$I for delete to authenticated
                    using (app.eh_interno(tenant_id))', t);
  end loop;
end $$;

create policy projetos_ler on public.projetos for select to authenticated
  using (app.eh_interno(tenant_id) and excluido_em is null);
create policy projetos_incluir on public.projetos for insert to authenticated
  with check (app.eh_interno(tenant_id));
create policy projetos_alterar on public.projetos for update to authenticated
  using (app.eh_interno(tenant_id)) with check (app.eh_interno(tenant_id));

create policy configuracoes_ler on public.configuracoes for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()));
create policy configuracoes_alterar on public.configuracoes for update to authenticated
  using (app.tem_permissao(tenant_id, 'admin.configuracoes'))
  with check (app.tem_permissao(tenant_id, 'admin.configuracoes'));
create policy configuracoes_incluir on public.configuracoes for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'admin.configuracoes'));

-- preferencias: cada pessoa so mexe nas proprias
create policy preferencias_proprias on public.usuario_preferencias for all to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));

-- Excluir projeto: logico. As regras de quem pode excluir ficam no
-- repositorio; aqui o banco garante que o projeto e da empresa de quem pede.
-- SECURITY DEFINER porque, apos marcado, o projeto sai da visao de leitura
-- e a atualizacao com a sessao do usuario seria recusada pelo RLS.
create or replace function public.excluir_projeto(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.projetos where id = p_id and excluido_em is null;
  if v_tenant is null or not app.eh_interno(v_tenant) then
    raise exception 'Projeto nao encontrado.' using errcode = 'P0002';
  end if;
  update public.projetos set excluido_em = now(), excluido_por = auth.uid() where id = p_id;
end $$;
revoke all on function public.excluir_projeto(uuid) from public, anon;
grant execute on function public.excluir_projeto(uuid) to authenticated;