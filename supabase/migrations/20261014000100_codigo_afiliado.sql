-- =====================================================================
-- Codigo do afiliado em maiusculas e unico (cupom)
--
-- Padrao: PRIMEIRONOME + percentual (ex.: LUCIANA20). Unico sem
-- diferenciar maiusculas/minusculas; links antigos continuam valendo.
-- =====================================================================

update public.afiliados set codigo = upper(codigo) where codigo <> upper(codigo);

alter table public.afiliados drop constraint afiliados_codigo_check;
alter table public.afiliados drop constraint afiliados_codigo_key;
alter table public.afiliados add constraint afiliados_codigo_check
  check (codigo ~ '^[A-Z0-9-]{3,30}$');
create unique index ux_afiliados_codigo on public.afiliados (upper(codigo));

-- Grava sempre em maiusculas, venha de onde vier.
create or replace function app.codigo_maiusculo() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.codigo := upper(trim(new.codigo));
  return new;
end $$;
create trigger tg_afiliados_codigo before insert or update of codigo on public.afiliados
  for each row execute function app.codigo_maiusculo();

-- Quais destes codigos ja estao em uso (para sugerir e validar na tela).
create or replace function public.codigos_afiliado_em_uso(p_codigos text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  return coalesce((select array_agg(upper(c)) from unnest(p_codigos) as c
                    where exists (select 1 from public.afiliados f where upper(f.codigo) = upper(c))),
                  '{}');
end $$;
revoke all on function public.codigos_afiliado_em_uso(text[]) from public, anon;
grant execute on function public.codigos_afiliado_em_uso(text[]) to authenticated;

-- As buscas por codigo passam a comparar em maiusculas.
create or replace function public.registrar_indicacao(p_codigo text, p_visitante text, p_origem text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_afiliado uuid;
begin
  select id into v_afiliado from public.afiliados where upper(codigo) = upper(p_codigo) and ativo;
  if v_afiliado is null then return false; end if;
  insert into public.indicacoes (afiliado_id, visitante, origem)
  values (v_afiliado, p_visitante, left(p_origem, 300));
  return true;
end $$;

create or replace function public.vincular_conta_afiliado(p_codigo text, p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  update public.afiliados set usuario_id = p_usuario where upper(codigo) = upper(p_codigo);
  if not found then
    raise exception 'Afiliado nao encontrado.' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.atualizar_assinatura(
  p_tenant uuid, p_plano text, p_ciclo text, p_usuarios integer, p_addon_ia boolean,
  p_status text, p_cortesia boolean, p_periodo_fim date, p_afiliado_codigo text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_afiliado uuid;
begin
  perform app.exigir_admin_plataforma();

  if p_afiliado_codigo is not null and p_afiliado_codigo <> '' then
    select id into v_afiliado from public.afiliados
     where upper(codigo) = upper(trim(p_afiliado_codigo)) and ativo;
    if v_afiliado is null then
      raise exception 'Afiliado "%" nao encontrado.', p_afiliado_codigo using errcode = 'P0001';
    end if;
  end if;

  update public.assinaturas a set
    plano_codigo = p_plano, ciclo = p_ciclo, usuarios_contratados = p_usuarios,
    addon_ia = p_addon_ia, status = p_status, cortesia = p_cortesia,
    periodo_inicio = case when p_status = 'ativa' and a.status <> 'ativa'
                          then (now() at time zone 'America/Sao_Paulo')::date else a.periodo_inicio end,
    periodo_fim = p_periodo_fim,
    inadimplente_desde = case when p_status = 'inadimplente' and a.status <> 'inadimplente'
                              then (now() at time zone 'America/Sao_Paulo')::date
                              when p_status in ('ativa','teste') then null
                              else a.inadimplente_desde end,
    afiliado_id = coalesce(v_afiliado, a.afiliado_id),
    atribuido_em = case when v_afiliado is not null and a.afiliado_id is distinct from v_afiliado
                        then now() else a.atribuido_em end,
    cancelada_em = case when p_status = 'cancelada' then now() else a.cancelada_em end
   where a.tenant_id = p_tenant and a.status <> 'cancelada';
  if not found then
    raise exception 'Empresa sem assinatura vigente.' using errcode = 'P0002';
  end if;
end $$;