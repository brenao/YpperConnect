-- =====================================================================
-- Recursos, ausencias e fornecedores, por empresa
--
-- Origem: db/postgres/01-schema.sql, 16-calendario-localidades-ausencias.sql
-- e 22-fornecedores.sql. Mesmas colunas e regras; diferencas:
--   - tenant_id + FK composta em tudo (usuario, equipe, localidade e
--     fornecedor do recurso sao da mesma empresa);
--   - excluir ausencia e logico (regra de produto); nada se apaga.
-- Quem gere: administrador ou perfil com a funcionalidade recurso.editar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fornecedores
-- ---------------------------------------------------------------------
create table public.fornecedores (
  id                 uuid not null default app.uuid_v7(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  nome               text not null,
  cnpj               text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  contato_nome       text,
  contato_email      text,
  contato_telefone   text,
  custo_hora_padrao  numeric(12,2) check (custo_hora_padrao is null or custo_hora_padrao >= 0),
  observacao         text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint pk_fornecedores primary key (id),
  constraint uq_fornecedores_tenant_id unique (tenant_id, id)
);
create unique index ux_fornecedores_nome on public.fornecedores (tenant_id, lower(nome));
create unique index ux_fornecedores_cnpj on public.fornecedores (tenant_id, cnpj) where cnpj is not null;

-- ---------------------------------------------------------------------
-- Recursos
-- ---------------------------------------------------------------------
create table public.recursos (
  id                        uuid not null default app.uuid_v7(),
  tenant_id                 uuid not null references public.tenants (id) on delete cascade,
  usuario_id                uuid,
  nome                      text not null,
  papel                     text,
  equipe_id                 uuid,
  localidade_id             uuid,
  fornecedor_id             uuid,
  custo_hora                numeric(12,2) check (custo_hora is null or custo_hora >= 0),
  horas_dia                 numeric(4,2) not null default 8 check (horas_dia > 0 and horas_dia <= 24),
  disponibilidade_projetos  smallint not null default 50
                            check (disponibilidade_projetos between 0 and 100),
  ativo                     boolean not null default true,
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now(),
  constraint pk_recursos primary key (id),
  constraint uq_recursos_tenant_id unique (tenant_id, id),
  constraint uq_recursos_usuario unique (tenant_id, usuario_id),
  constraint fk_recursos_usuario foreign key (tenant_id, usuario_id)
    references public.tenant_membros (tenant_id, usuario_id),
  constraint fk_recursos_equipe foreign key (tenant_id, equipe_id)
    references public.equipes (tenant_id, id),
  constraint fk_recursos_localidade foreign key (tenant_id, localidade_id)
    references public.localidades (tenant_id, id),
  constraint fk_recursos_fornecedor foreign key (tenant_id, fornecedor_id)
    references public.fornecedores (tenant_id, id)
);
create index ix_recursos_tenant on public.recursos (tenant_id, ativo, nome);

-- ---------------------------------------------------------------------
-- Ausencias (ferias, licencas...): exclusao logica
-- ---------------------------------------------------------------------
create table public.recurso_ausencias (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null,
  recurso_id     uuid not null,
  tipo           text not null default 'ferias'
                 check (tipo in ('ferias','licenca_medica','licenca','treinamento','folga','outro')),
  inicio         date not null,
  fim            date not null,
  observacao     text,
  criado_por_id  uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  excluido_em    timestamptz,
  excluido_por   uuid,
  constraint pk_recurso_ausencias primary key (id),
  constraint ck_ausencia_periodo check (fim >= inicio),
  constraint fk_ausencia_recurso foreign key (tenant_id, recurso_id)
    references public.recursos (tenant_id, id),
  constraint fk_ausencia_criado_por foreign key (tenant_id, criado_por_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_ausencias_recurso on public.recurso_ausencias (tenant_id, recurso_id, inicio);

-- ---------------------------------------------------------------------
-- Triggers: atualizado_em, auditoria, sem exclusao fisica
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fornecedores','recursos','recurso_ausencias'] loop
    execute format('create trigger tg_%1$s_atualizado before update on public.%1$I
                    for each row execute function app.tocar_atualizado_em()', t);
    execute format('create trigger tg_%1$s_auditoria after insert or update on public.%1$I
                    for each row execute function app.auditar()', t);
    execute format('create trigger tg_%1$s_sem_exclusao_fisica before delete on public.%1$I
                    for each row execute function app.bloquear_exclusao_fisica()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Quem gere recursos: administrador ou perfil com recurso.editar
-- ---------------------------------------------------------------------
create or replace function app.pode_gerir_recursos(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_membros m
      join public.tenants t on t.id = m.tenant_id and t.ativo
     where m.tenant_id = p_tenant and m.usuario_id = auth.uid() and m.ativo
       and (m.admin or exists (select 1 from public.perfil_features pf
                                join public.perfis_acesso p on p.id = pf.perfil_id and p.ativo
                               where pf.perfil_id = m.perfil_id
                                 and pf.feature_key = 'recurso.editar')))
$$;
grant execute on function app.pode_gerir_recursos(uuid) to authenticated;

revoke all on public.fornecedores, public.recursos, public.recurso_ausencias from anon;
alter table public.fornecedores      enable row level security;
alter table public.recursos          enable row level security;
alter table public.recurso_ausencias enable row level security;

-- Leitura: equipe interna da empresa. Escrita: quem gere recursos.
create policy fornecedores_ler on public.fornecedores for select to authenticated
  using (app.eh_interno(tenant_id));
create policy fornecedores_incluir on public.fornecedores for insert to authenticated
  with check (app.pode_gerir_recursos(tenant_id));
create policy fornecedores_alterar on public.fornecedores for update to authenticated
  using (app.pode_gerir_recursos(tenant_id)) with check (app.pode_gerir_recursos(tenant_id));

create policy recursos_ler on public.recursos for select to authenticated
  using (app.eh_interno(tenant_id));
create policy recursos_incluir on public.recursos for insert to authenticated
  with check (app.pode_gerir_recursos(tenant_id));
create policy recursos_alterar on public.recursos for update to authenticated
  using (app.pode_gerir_recursos(tenant_id)) with check (app.pode_gerir_recursos(tenant_id));

create policy ausencias_ler on public.recurso_ausencias for select to authenticated
  using (app.eh_interno(tenant_id) and excluido_em is null);
create policy ausencias_incluir on public.recurso_ausencias for insert to authenticated
  with check (app.pode_gerir_recursos(tenant_id));
create policy ausencias_alterar on public.recurso_ausencias for update to authenticated
  using (app.pode_gerir_recursos(tenant_id)) with check (app.pode_gerir_recursos(tenant_id));

-- ---------------------------------------------------------------------
-- Visoes de leitura com os nomes (respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------
create view public.recursos_v with (security_invoker = true) as
select r.*,
       u.nome as usuario_nome,
       e.nome as equipe_nome,
       l.nome as localidade_nome,
       f.nome as fornecedor_nome
  from public.recursos r
  left join public.usuarios u on u.id = r.usuario_id
  left join public.equipes e on e.tenant_id = r.tenant_id and e.id = r.equipe_id
  left join public.localidades l on l.tenant_id = r.tenant_id and l.id = r.localidade_id
  left join public.fornecedores f on f.tenant_id = r.tenant_id and f.id = r.fornecedor_id;

create view public.fornecedores_v with (security_invoker = true) as
select f.*,
       (select count(*) from public.recursos r
         where r.tenant_id = f.tenant_id and r.fornecedor_id = f.id and r.ativo)::int as recursos
  from public.fornecedores f;

create view public.recurso_ausencias_v with (security_invoker = true) as
select a.*, r.nome as recurso_nome, u.nome as criado_por_nome
  from public.recurso_ausencias a
  join public.recursos r on r.tenant_id = a.tenant_id and r.id = a.recurso_id
  left join public.usuarios u on u.id = a.criado_por_id;

revoke all on public.recursos_v, public.fornecedores_v, public.recurso_ausencias_v from anon;
grant select on public.recursos_v, public.fornecedores_v, public.recurso_ausencias_v to authenticated;

-- ---------------------------------------------------------------------
-- Criacao em lote a partir de usuarios: herda nome, departamento e
-- equipe; o NOT EXISTS protege contra clique duplo. Localidade nula
-- herda a padrao.
-- ---------------------------------------------------------------------
create or replace function public.criar_recursos_de_usuarios(
  p_tenant uuid, p_usuarios uuid[], p_disponibilidade smallint, p_horas_dia numeric
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_total integer;
begin
  insert into public.recursos
    (tenant_id, usuario_id, nome, papel, equipe_id, horas_dia, disponibilidade_projetos)
  select m.tenant_id, m.usuario_id, u.nome, m.departamento, m.equipe_id,
         p_horas_dia, p_disponibilidade
    from public.tenant_membros m
    join public.usuarios u on u.id = m.usuario_id
   where m.tenant_id = p_tenant and m.ativo
     and m.usuario_id = any (p_usuarios)
     and not exists (select 1 from public.recursos r
                      where r.tenant_id = m.tenant_id and r.usuario_id = m.usuario_id);
  get diagnostics v_total = row_count;
  return v_total;
end $$;

revoke all on function public.criar_recursos_de_usuarios(uuid, uuid[], smallint, numeric) from public, anon;
grant execute on function public.criar_recursos_de_usuarios(uuid, uuid[], smallint, numeric) to authenticated;