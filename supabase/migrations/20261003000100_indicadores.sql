-- =====================================================================
-- Chamados (C3): indicadores do painel e da diretoria, por empresa
--
-- Mesmas contas do legado (db/indicadores.repo.ts), com duas correcoes:
--   - "hoje" e as datas dos graficos no fuso da empresa (o banco legado
--     rodava em America/Sao_Paulo; o Supabase roda em UTC);
--   - na serie criados x atendidos, cada contagem e feita a parte (a
--     juncao dupla do legado multiplicava as linhas).
-- SECURITY INVOKER: o RLS dos chamados vale para quem consulta.
-- =====================================================================

create or replace function app.fuso_empresa(p_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select fuso_horario from public.tenants where id = p_tenant), 'America/Sao_Paulo')
$$;
grant execute on function app.fuso_empresa(uuid) to authenticated;

-- Resumo do painel
create or replace function public.ind_resumo_chamados(p_tenant uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total',        count(*),
    'abertos',      count(*) filter (where c.status not in ('resolvido','fechado')),
    'criticos',     count(*) filter (where c.status not in ('resolvido','fechado') and c.prioridade = 'P1'),
    'vencidos',     count(*) filter (where c.status not in ('resolvido','fechado') and c.prazo_sla < now()),
    'com_problema', count(*) filter (where c.problema_vinculado_id is not null))
  from public.chamados c
  where c.tenant_id = p_tenant
$$;

-- Abertos por prioridade / total por tipo / recorrencia
create or replace function public.ind_abertos_por_prioridade(p_tenant uuid)
returns table (prioridade text, total bigint)
language sql stable security invoker set search_path = '' as $$
  select c.prioridade, count(*) from public.chamados c
   where c.tenant_id = p_tenant and c.status not in ('resolvido','fechado')
   group by c.prioridade
$$;

create or replace function public.ind_total_por_tipo(p_tenant uuid)
returns table (tipo text, total bigint)
language sql stable security invoker set search_path = '' as $$
  select c.tipo, count(*) from public.chamados c
   where c.tenant_id = p_tenant
   group by c.tipo order by count(*) desc
$$;

create or replace function public.ind_sistemas_recorrentes(p_tenant uuid)
returns table (sistema_nome text, total bigint)
language sql stable security invoker set search_path = '' as $$
  select s.nome, count(*)
    from public.chamados c
    join public.sistemas s on s.tenant_id = c.tenant_id and s.id = c.sistema_id
   where c.tenant_id = p_tenant and c.tipo = 'incidente'
     and c.status not in ('resolvido','fechado')
   group by s.nome
  having count(*) >= 3
   order by count(*) desc
$$;

-- Volume dos ultimos 7 dias (dias sem chamado aparecem como zero)
create or replace function public.ind_volume_7_dias(p_tenant uuid)
returns table (dia text, incidentes bigint, requisicoes bigint, outros bigint)
language sql stable security invoker set search_path = '' as $$
  with fuso as (select app.fuso_empresa(p_tenant) as tz),
  dias as (
    select (now() at time zone (select tz from fuso))::date - 6 + g as d
      from generate_series(0, 6) as g
  )
  select to_char(dias.d, 'DD/MM'),
         count(c.id) filter (where c.tipo = 'incidente'),
         count(c.id) filter (where c.tipo = 'requisicao'),
         count(c.id) filter (where c.tipo not in ('incidente','requisicao'))
    from dias
    left join public.chamados c
      on c.tenant_id = p_tenant
     and (c.criado_em at time zone (select tz from fuso))::date = dias.d
   group by dias.d
   order by dias.d
$$;

-- Metricas do periodo (filtro por data de abertura)
create or replace function public.ind_metricas_chamados(p_tenant uuid, p_de timestamptz, p_ate timestamptz)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'criados',     count(*),
    'atendidos',   count(*) filter (where c.status in ('resolvido','fechado')),
    'backlog',     count(*) filter (where c.status not in ('resolvido','fechado')),
    'vencidos',    count(*) filter (where c.status not in ('resolvido','fechado') and c.prazo_sla < now()),
    'com_retorno', count(*) filter (where c.respondido_em is not null),
    'dentro_sla',  count(*) filter (where c.resolvido_em is not null and c.resolvido_em <= c.prazo_sla),
    'media_horas', avg(extract(epoch from (c.resolvido_em - c.criado_em)) / 3600)
                     filter (where c.resolvido_em is not null))
  from public.chamados c
  where c.tenant_id = p_tenant
    and (p_de is null or c.criado_em >= p_de)
    and (p_ate is null or c.criado_em <= p_ate)
$$;

-- Serie diaria criados x atendidos (cada contagem a parte)
create or replace function public.ind_serie_criados_atendidos(p_tenant uuid, p_de date, p_qtd int)
returns table (dia text, criados bigint, atendidos bigint)
language sql stable security invoker set search_path = '' as $$
  with fuso as (select app.fuso_empresa(p_tenant) as tz),
  dias as (select p_de + g as d from generate_series(0, greatest(p_qtd, 1) - 1) as g)
  select to_char(dias.d, 'DD/MM'),
         (select count(*) from public.chamados c
           where c.tenant_id = p_tenant
             and (c.criado_em at time zone (select tz from fuso))::date = dias.d),
         (select count(*) from public.chamados c
           where c.tenant_id = p_tenant
             and (c.resolvido_em at time zone (select tz from fuso))::date = dias.d)
    from dias
   order by dias.d
$$;

-- Agrupamento por prioridade, tipo, status ou equipe
create or replace function public.ind_agrupar_chamados(
  p_tenant uuid, p_por text, p_de timestamptz, p_ate timestamptz
) returns table (chave text, total bigint, atendidos bigint)
language sql stable security invoker set search_path = '' as $$
  select case p_por
           when 'prioridade' then c.prioridade
           when 'tipo'       then c.tipo
           when 'status'     then c.status
           else coalesce(eq.nome, 'Sem equipe') end as chave,
         count(*),
         count(*) filter (where c.status in ('resolvido','fechado'))
    from public.chamados c
    left join public.equipes eq on eq.tenant_id = c.tenant_id and eq.id = c.equipe_id
   where c.tenant_id = p_tenant
     and (p_de is null or c.criado_em >= p_de)
     and (p_ate is null or c.criado_em <= p_ate)
   group by 1
   order by count(*) desc
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ind_resumo_chamados(uuid)', 'ind_abertos_por_prioridade(uuid)', 'ind_total_por_tipo(uuid)',
    'ind_sistemas_recorrentes(uuid)', 'ind_volume_7_dias(uuid)',
    'ind_metricas_chamados(uuid, timestamptz, timestamptz)',
    'ind_serie_criados_atendidos(uuid, date, int)',
    'ind_agrupar_chamados(uuid, text, timestamptz, timestamptz)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;