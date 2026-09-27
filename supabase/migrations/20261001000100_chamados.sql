-- =====================================================================
-- Chamados (C1): chamados, interacoes e historico por empresa
--
-- Origem: db/postgres/01-schema.sql. Mesmas colunas, estados e regras.
-- Diferencas do multi-empresa:
--   - numero por empresa (cada uma comeca em 1000), codigo INC-1000 etc.;
--   - toda referencia (servico, sistema, pessoas, equipe, problema) e da
--     mesma empresa, garantido por FK composta;
--   - chamado nunca e apagado (exclusao so logica); interacoes e
--     historico sao imutaveis.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Numeracao por empresa
-- ---------------------------------------------------------------------
create table public.chamado_numeracao (
  tenant_id  uuid primary key references public.tenants (id) on delete cascade,
  proximo    bigint not null default 1000
);

create or replace function app.proximo_numero_chamado(p_tenant uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_numero bigint;
begin
  insert into public.chamado_numeracao (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;

  update public.chamado_numeracao
     set proximo = proximo + 1
   where tenant_id = p_tenant
  returning proximo - 1 into v_numero;
  return v_numero;
end $$;

revoke all on function app.proximo_numero_chamado(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Chamados
-- ---------------------------------------------------------------------
create table public.chamados (
  id                     uuid not null default app.uuid_v7(),
  tenant_id              uuid not null references public.tenants (id) on delete cascade,
  numero                 bigint not null,
  prefixo                text not null check (prefixo ~ '^[A-Z]{2,4}$'),
  codigo                 text generated always as (prefixo || '-' || numero::text) stored,
  titulo                 text not null,
  descricao              text not null,
  tipo                   text not null
                         check (tipo in ('incidente','requisicao','melhoria','problema','tarefa')),
  categoria_id           uuid,
  servico_id             uuid,
  sistema_id             uuid,
  impacto                text not null check (impacto in ('alto','medio','baixo')),
  urgencia               text not null check (urgencia in ('alta','media','baixa')),
  prioridade             text not null check (prioridade in ('P1','P2','P3','P4')),
  status                 text not null default 'novo'
                         check (status in ('novo','triagem','em_andamento','aguardando','resolvido','fechado')),
  solicitante_id         uuid not null,
  responsavel_id         uuid,
  equipe_id              uuid,
  origem                 text not null check (origem in ('portal','ia','email','telefone')),
  problema_vinculado_id  uuid,
  descricao_encerramento text,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  prazo_resposta         timestamptz,
  prazo_sla              timestamptz not null,
  respondido_em          timestamptz,
  resolvido_em           timestamptz,
  fechado_em             timestamptz,
  excluido_em            timestamptz,
  excluido_por           uuid,
  constraint pk_chamados primary key (id),
  constraint uq_chamados_tenant_id unique (tenant_id, id),
  constraint uq_chamados_numero unique (tenant_id, numero),
  constraint fk_chamados_categoria foreign key (tenant_id, categoria_id)
    references public.categorias (tenant_id, id),
  constraint fk_chamados_servico foreign key (tenant_id, servico_id)
    references public.servicos (tenant_id, id),
  constraint fk_chamados_sistema foreign key (tenant_id, sistema_id)
    references public.sistemas (tenant_id, id),
  constraint fk_chamados_solicitante foreign key (tenant_id, solicitante_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_chamados_responsavel foreign key (tenant_id, responsavel_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_chamados_equipe foreign key (tenant_id, equipe_id)
    references public.equipes (tenant_id, id),
  constraint fk_chamados_problema foreign key (tenant_id, problema_vinculado_id)
    references public.chamados (tenant_id, id)
);

create unique index ux_chamados_codigo on public.chamados (tenant_id, codigo);
create index ix_chamados_status_prazo on public.chamados (tenant_id, status, prazo_sla);
create index ix_chamados_responsavel on public.chamados (tenant_id, responsavel_id, status);
create index ix_chamados_solicitante on public.chamados (tenant_id, solicitante_id, criado_em);
create index ix_chamados_servico on public.chamados (tenant_id, servico_id);
create index ix_chamados_sistema on public.chamados (tenant_id, sistema_id);
create index ix_chamados_criado on public.chamados (tenant_id, criado_em);
create index ix_chamados_equipe_status on public.chamados (tenant_id, equipe_id, status);

-- Numero atribuido pelo banco, por empresa, na inclusao.
create or replace function app.numerar_chamado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.numero := app.proximo_numero_chamado(new.tenant_id);
  return new;
end $$;

create trigger tg_chamados_numerar before insert on public.chamados
  for each row execute function app.numerar_chamado();

-- ---------------------------------------------------------------------
-- Interacoes e historico (imutaveis)
-- ---------------------------------------------------------------------
create table public.chamado_interacoes (
  id          uuid not null default app.uuid_v7(),
  tenant_id   uuid not null,
  chamado_id  uuid not null,
  autor_id    uuid,
  tipo        text not null check (tipo in ('comentario','nota_interna','email')),
  corpo       text not null,
  criado_em   timestamptz not null default now(),
  constraint pk_chamado_interacoes primary key (id),
  constraint fk_interacoes_chamado foreign key (tenant_id, chamado_id)
    references public.chamados (tenant_id, id),
  constraint fk_interacoes_autor foreign key (tenant_id, autor_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_interacoes_chamado on public.chamado_interacoes (tenant_id, chamado_id, criado_em);

create table public.chamado_historico (
  id              uuid not null default app.uuid_v7(),
  tenant_id       uuid not null,
  chamado_id      uuid not null,
  autor_id        uuid,
  campo           text not null,
  valor_anterior  text,
  valor_novo      text,
  criado_em       timestamptz not null default now(),
  constraint pk_chamado_historico primary key (id),
  constraint fk_historico_chamado foreign key (tenant_id, chamado_id)
    references public.chamados (tenant_id, id),
  constraint fk_historico_autor foreign key (tenant_id, autor_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_historico_chamado on public.chamado_historico (tenant_id, chamado_id, criado_em);
create index ix_historico_campo on public.chamado_historico (tenant_id, campo, criado_em);

create or replace function app.bloquear_alteracao() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% e imutavel: registre um novo evento em vez de alterar.', tg_table_name
    using errcode = '42501';
end $$;

create trigger tg_interacoes_imutavel before update or delete on public.chamado_interacoes
  for each row execute function app.bloquear_alteracao();
create trigger tg_historico_imutavel before update or delete on public.chamado_historico
  for each row execute function app.bloquear_alteracao();

-- Chamado: sem exclusao fisica; atualizado_em automatico; auditoria.
create trigger tg_chamados_sem_exclusao_fisica before delete on public.chamados
  for each row execute function app.bloquear_exclusao_fisica();
create trigger tg_chamados_atualizado before update on public.chamados
  for each row execute function app.tocar_atualizado_em();
create trigger tg_chamados_auditoria after insert or update on public.chamados
  for each row execute function app.auditar();

-- ---------------------------------------------------------------------
-- Seguranca: qualquer membro da empresa le e abre chamados, como no
-- legado (o menu e o perfil decidem o que cada um ve na tela). Nada de
-- outra empresa aparece.
-- ---------------------------------------------------------------------
revoke all on public.chamados, public.chamado_interacoes, public.chamado_historico,
  public.chamado_numeracao from anon;

alter table public.chamado_numeracao  enable row level security;
alter table public.chamados           enable row level security;
alter table public.chamado_interacoes enable row level security;
alter table public.chamado_historico  enable row level security;

create policy chamados_ler on public.chamados for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()) and excluido_em is null);
create policy chamados_incluir on public.chamados for insert to authenticated
  with check (tenant_id in (select app.tenants_do_usuario()));
create policy chamados_alterar on public.chamados for update to authenticated
  using (tenant_id in (select app.tenants_do_usuario()))
  with check (tenant_id in (select app.tenants_do_usuario()));

create policy interacoes_ler on public.chamado_interacoes for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()));
create policy interacoes_incluir on public.chamado_interacoes for insert to authenticated
  with check (tenant_id in (select app.tenants_do_usuario())
              and (autor_id is null or autor_id = (select auth.uid())));

create policy historico_ler on public.chamado_historico for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()));
create policy historico_incluir on public.chamado_historico for insert to authenticated
  with check (tenant_id in (select app.tenants_do_usuario())
              and (autor_id is null or autor_id = (select auth.uid())));
