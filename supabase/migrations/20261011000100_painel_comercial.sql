-- =====================================================================
-- Comercial (CM3): painel da plataforma
--
-- So operadores da plataforma. Ate o gateway (CM4), o operador ajusta a
-- assinatura a mao (venda direta, ajuste, regularizacao).
-- =====================================================================

-- Uma linha por empresa, com o que o painel mostra.
create or replace function public.painel_assinaturas()
returns table (
  tenant_id uuid, empresa text, slug text, assinatura_id uuid,
  plano text, nivel text, ciclo text, status text, cortesia boolean, addon_ia boolean,
  usuarios_contratados integer, usuarios_pagantes integer, valor_mensal_centavos integer,
  teste_ate date, periodo_fim date, afiliado_codigo text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  return query
    select t.id, t.nome, t.slug, a.id, a.plano_codigo, p.nivel, a.ciclo, a.status, a.cortesia,
           a.addon_ia, a.usuarios_contratados, public.usuarios_pagantes(t.id),
           case when a.cortesia then 0 else public.valor_mensal_assinatura(a.id) end,
           a.teste_ate, a.periodo_fim, f.codigo
      from public.tenants t
      left join public.assinaturas a on a.tenant_id = t.id and a.status <> 'cancelada'
      left join public.planos p on p.codigo = a.plano_codigo
      left join public.afiliados f on f.id = a.afiliado_id
     where t.excluido_em is null
     order by t.nome;
end $$;

-- Ajuste manual da assinatura pelo operador.
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
    select id into v_afiliado from public.afiliados where codigo = lower(p_afiliado_codigo) and ativo;
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

-- Comissao prevista vira liberada passados os 30 dias de carencia.
create or replace function public.liberar_comissoes() returns integer
language sql security definer set search_path = '' as $$
  with liberadas as (
    update public.comissoes set status = 'liberada'
     where status = 'prevista' and liberar_em <= (now() at time zone 'America/Sao_Paulo')::date
    returning 1)
  select count(*)::int from liberadas
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('liberar-comissoes', '30 6 * * *', 'select public.liberar_comissoes()');
  end if;
end $$;

revoke all on function public.painel_assinaturas(), public.atualizar_assinatura(uuid, text, text, integer, boolean, text, boolean, date, text) from public, anon;
grant execute on function public.painel_assinaturas(), public.atualizar_assinatura(uuid, text, text, integer, boolean, text, boolean, date, text) to authenticated;
revoke all on function public.liberar_comissoes() from public, anon, authenticated;