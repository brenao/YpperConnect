-- =====================================================================
-- Base de conhecimento (artigos), por empresa
--
-- Origem: db/postgres/01-schema.sql. Mesmas colunas e regras:
--   - qualquer membro da empresa le;
--   - so a equipe de TI (administrador ou quem tem equipe) cria e altera;
--   - contagem de visualizacao sem perder acessos simultaneos.
-- Exclusao so logica (regra de produto), sem DELETE fisico.
-- =====================================================================

create table public.artigos (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  titulo         text not null,
  categoria_id   uuid,
  resumo         text,
  conteudo       text not null,
  status         text not null default 'rascunho'
                 check (status in ('publicado', 'revisar', 'rascunho')),
  visualizacoes  integer not null default 0,
  gerado_por_ia  boolean not null default false,
  autor_id       uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  excluido_em    timestamptz,
  excluido_por   uuid,
  constraint pk_artigos primary key (id),
  constraint uq_artigos_tenant_id unique (tenant_id, id),
  constraint fk_artigos_categoria foreign key (tenant_id, categoria_id)
    references public.categorias (tenant_id, id),
  constraint fk_artigos_autor foreign key (tenant_id, autor_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_artigos_status on public.artigos (tenant_id, status);
create index ix_artigos_categoria on public.artigos (tenant_id, categoria_id);
create index ix_artigos_atualizado on public.artigos (tenant_id, atualizado_em desc);

create trigger tg_artigos_atualizado before update on public.artigos
  for each row execute function app.tocar_atualizado_em();
create trigger tg_artigos_auditoria after insert or update on public.artigos
  for each row execute function app.auditar();
create trigger tg_artigos_sem_exclusao_fisica before delete on public.artigos
  for each row execute function app.bloquear_exclusao_fisica();

-- "Equipe de TI", como no legado: administrador ou quem tem equipe.
create or replace function app.eh_ti(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_membros m
      join public.tenants t on t.id = m.tenant_id and t.ativo
     where m.tenant_id = p_tenant and m.usuario_id = auth.uid() and m.ativo
       and (m.admin or m.equipe_id is not null))
$$;
grant execute on function app.eh_ti(uuid) to authenticated;

revoke all on public.artigos from anon;
alter table public.artigos enable row level security;

create policy artigos_ler on public.artigos for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()) and excluido_em is null);
create policy artigos_incluir on public.artigos for insert to authenticated
  with check (app.eh_ti(tenant_id) and autor_id = (select auth.uid()));
create policy artigos_alterar on public.artigos for update to authenticated
  using (app.eh_ti(tenant_id)) with check (app.eh_ti(tenant_id));

-- Visualizacao: qualquer leitor conta, mas so a TI altera o artigo.
-- Incremento direto no banco, sem ler antes: acessos simultaneos nao se perdem.
create or replace function public.registrar_visualizacao_artigo(p_id uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.artigos set visualizacoes = visualizacoes + 1
   where id = p_id and excluido_em is null
     and tenant_id in (select app.tenants_do_usuario())
$$;
revoke all on function public.registrar_visualizacao_artigo(uuid) from public, anon;
grant execute on function public.registrar_visualizacao_artigo(uuid) to authenticated;

-- Contagens para a Visao geral.
create or replace function public.ind_resumo_artigos(p_tenant uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total',     count(*),
    'pendentes', count(*) filter (where status <> 'publicado'))
  from public.artigos where tenant_id = p_tenant
$$;
revoke all on function public.ind_resumo_artigos(uuid) from public, anon;
grant execute on function public.ind_resumo_artigos(uuid) to authenticated;

-- A visualizacao nao mexe em atualizado_em: ler nao e editar.
create or replace function app.tocar_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'artigos'
     and (to_jsonb(new) - 'visualizacoes' - 'atualizado_em')
       = (to_jsonb(old) - 'visualizacoes' - 'atualizado_em') then
    return new;
  end if;
  new.atualizado_em := now();
  return new;
end $$;