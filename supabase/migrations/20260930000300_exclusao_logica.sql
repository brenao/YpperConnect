-- =====================================================================
-- Exclusao sempre LOGICA
--
-- Regra de produto: nada e apagado do banco. Excluir = marcar
-- excluido_em/excluido_por e desativar. O registro some das telas, mas
-- continua no banco e na auditoria. A exclusao fisica nas tabelas de
-- negocio passa a ser recusada pelo proprio banco.
--
-- Antes de excluir, a tela consulta os vinculos (chamados e projetos)
-- e mostra ao usuario, que confirma ou desiste.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas de exclusao logica
-- ---------------------------------------------------------------------
alter table public.tenants
  add column excluido_em  timestamptz,
  add column excluido_por uuid;
alter table public.sistemas
  add column excluido_em  timestamptz,
  add column excluido_por uuid;
alter table public.feriados
  add column excluido_em  timestamptz,
  add column excluido_por uuid;

-- Unicidade so entre os NAO excluidos: o nome de um sistema excluido
-- pode ser usado de novo.
alter table public.tenants drop constraint tenants_slug_key;
create unique index ux_tenants_slug on public.tenants (slug) where excluido_em is null;

alter table public.sistemas drop constraint uq_sistemas_nome;
create unique index ux_sistemas_nome on public.sistemas (tenant_id, nome) where excluido_em is null;

alter table public.feriados drop constraint uq_feriados;
create unique index ux_feriados on public.feriados (tenant_id, localidade_id, data)
  nulls not distinct where excluido_em is null;

-- ---------------------------------------------------------------------
-- 2. Sem DELETE pela API, e o banco recusa exclusao fisica
-- ---------------------------------------------------------------------
drop policy if exists sistemas_excluir on public.sistemas;
drop policy if exists feriados_excluir on public.feriados;
drop policy if exists expediente_excluir on public.expediente;

create or replace function app.bloquear_exclusao_fisica() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Exclusao fisica nao e permitida em %: use a exclusao logica.', tg_table_name
    using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','organizacoes','tenant_membros','perfis_acesso','equipes',
                           'categorias','localidades','expediente','feriados','servicos','sistemas']
  loop
    execute format('create trigger tg_%1$s_sem_exclusao_fisica before delete on public.%1$I
                    for each row execute function app.bloquear_exclusao_fisica()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Vinculos: quantos chamados e projetos apontam para um registro.
--    As tabelas de chamados e projetos entram nos proximos modulos; a
--    funcao ja as considera assim que existirem, sem mudar de novo.
-- ---------------------------------------------------------------------
create or replace function app.contar_vinculos(p_coluna text, p_valor uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tabela text;
  v_total  bigint;
  v_saida  jsonb := '{}'::jsonb;
begin
  foreach v_tabela in array array['chamados', 'projetos'] loop
    v_total := 0;
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = v_tabela
                  and column_name = p_coluna) then
      execute format('select count(*) from public.%I where %I = $1', v_tabela, p_coluna)
        into v_total using p_valor;
    end if;
    v_saida := v_saida || jsonb_build_object(v_tabela, v_total);
  end loop;
  return v_saida;
end $$;

revoke all on function app.contar_vinculos(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Sistema: vinculos e exclusao logica (administrador da empresa)
-- ---------------------------------------------------------------------
create or replace function public.vinculos_sistema(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.sistemas where id = p_id and excluido_em is null;
  if v_tenant is null or not app.tem_permissao(v_tenant, 'admin.sistemas') then
    raise exception 'Sistema nao encontrado ou sem permissao.' using errcode = '42501';
  end if;
  return app.contar_vinculos('sistema_id', p_id);
end $$;

create or replace function public.excluir_sistema(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.sistemas where id = p_id and excluido_em is null;
  if v_tenant is null or not app.tem_permissao(v_tenant, 'admin.sistemas') then
    raise exception 'Sistema nao encontrado ou sem permissao.' using errcode = '42501';
  end if;
  update public.sistemas
     set excluido_em = now(), excluido_por = auth.uid(), ativo = false
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 5. Feriado: exclusao logica (administrador da empresa)
-- ---------------------------------------------------------------------
create or replace function public.excluir_feriado(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.feriados where id = p_id and excluido_em is null;
  if v_tenant is null or not app.tem_permissao(v_tenant, 'cadastro.gerenciar') then
    raise exception 'Feriado nao encontrado ou sem permissao.' using errcode = '42501';
  end if;
  update public.feriados
     set excluido_em = now(), excluido_por = auth.uid(), ativo = false
   where id = p_id;
end $$;

revoke all on function public.vinculos_sistema(uuid) from public, anon;
revoke all on function public.excluir_sistema(uuid) from public, anon;
revoke all on function public.excluir_feriado(uuid) from public, anon;
grant execute on function public.vinculos_sistema(uuid) to authenticated;
grant execute on function public.excluir_sistema(uuid) to authenticated;
grant execute on function public.excluir_feriado(uuid) to authenticated;

-- O calculo de SLA e cronograma ignora feriado excluido.
create or replace function public.calendario_localidade(p_tenant uuid, p_localidade uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_local   uuid;
  v_padrao  uuid;
  v_fuso    text;
  v_origem  uuid;
begin
  if p_tenant not in (select app.tenants_do_usuario()) then
    raise exception 'Sem acesso a esta empresa.' using errcode = '42501';
  end if;

  select id into v_padrao
    from public.localidades
   where tenant_id = p_tenant and padrao;

  select id into v_local
    from public.localidades
   where tenant_id = p_tenant and id = p_localidade and ativo;
  v_local := coalesce(v_local, v_padrao);

  select fuso_horario into v_fuso from public.localidades where id = v_local;

  v_origem := case
    when exists (select 1 from public.expediente
                  where tenant_id = p_tenant and localidade_id = v_local and ativo)
    then v_local else v_padrao end;

  return jsonb_build_object(
    'localidade_id', v_local,
    'fuso_horario',  coalesce(v_fuso, 'America/Sao_Paulo'),
    'expediente', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia_semana, 'ini', minuto_ini, 'fim', minuto_fim)
                       order by dia_semana, minuto_ini)
        from public.expediente
       where tenant_id = p_tenant and localidade_id = v_origem and ativo), '[]'::jsonb),
    'feriados', coalesce((
      select jsonb_agg(jsonb_build_object('data', data, 'recorrente', recorrente))
        from public.feriados
       where tenant_id = p_tenant and ativo and excluido_em is null
         and (localidade_id is null or localidade_id = v_local)), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 6. Empresa: resumo antes de excluir e exclusao logica (plataforma)
-- ---------------------------------------------------------------------
create or replace function app.resumo_empresa(p_slug text)
returns table (nome text, slug text, usuarios bigint, sistemas bigint, chamados bigint, projetos bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_vinc jsonb;
begin
  select t.id into v_id from public.tenants t where t.slug = lower(p_slug) and t.excluido_em is null;
  if v_id is null then
    raise exception 'Empresa com slug "%" nao encontrada.', p_slug;
  end if;
  v_vinc := app.contar_vinculos('tenant_id', v_id);
  return query
    select t.nome, t.slug,
           (select count(*) from public.tenant_membros m where m.tenant_id = v_id and m.ativo),
           (select count(*) from public.sistemas s where s.tenant_id = v_id and s.excluido_em is null),
           (v_vinc->>'chamados')::bigint,
           (v_vinc->>'projetos')::bigint
      from public.tenants t where t.id = v_id;
end $$;

create or replace function app.excluir_empresa(p_slug text, p_confirmacao text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_nome text;
begin
  if p_confirmacao is distinct from p_slug then
    raise exception 'Confirmacao nao confere. Repita o slug exato da empresa.';
  end if;

  select id, nome into v_id, v_nome
    from public.tenants where slug = lower(p_slug) and excluido_em is null;
  if v_id is null then
    raise exception 'Empresa com slug "%" nao encontrada.', p_slug;
  end if;

  -- Logica: a empresa sai de todas as telas e ninguem mais entra nela,
  -- mas os dados continuam no banco.
  update public.tenants
     set ativo = false, excluido_em = now(), excluido_por = auth.uid()
   where id = v_id;
  return format('Empresa "%s" (%s) excluida (exclusao logica).', v_nome, p_slug);
end $$;

revoke all on function app.resumo_empresa(text) from public, anon, authenticated;
revoke all on function app.excluir_empresa(text, text) from public, anon, authenticated;
