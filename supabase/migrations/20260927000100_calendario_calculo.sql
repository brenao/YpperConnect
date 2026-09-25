-- =====================================================================
-- Passo 3.3 - Calendario para o motor de calculo (SLA e cronograma)
--
-- O motor (sla.server.ts) precisa do calendario mesmo quando quem esta
-- logado e um solicitante, que pelo RLS nao le localidades/expediente.
-- Esta funcao entrega SO o necessario para o calculo (faixas e datas),
-- e so para um tenant do qual a pessoa e membro.
--
-- Regras herdadas do legado:
--   - expediente: o da localidade se ela tiver faixas proprias; senao,
--     o da localidade padrao do tenant (heranca tudo-ou-nada);
--   - feriados: nacionais da plataforma (pais da localidade) + os do
--     tenant sem localidade + os daquela localidade.
-- =====================================================================

create or replace function public.calendario_localidade(p_tenant uuid, p_localidade uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_local   uuid;
  v_padrao  uuid;
  v_pais    char(2);
  v_fuso    text;
  v_origem  uuid;
begin
  if p_tenant not in (select app.tenants_do_usuario()) then
    raise exception 'Sem acesso a esta empresa.' using errcode = '42501';
  end if;

  select id into v_padrao
    from public.localidades
   where tenant_id = p_tenant and padrao;

  -- Localidade informada so vale se for deste tenant e estiver ativa.
  select id into v_local
    from public.localidades
   where tenant_id = p_tenant and id = p_localidade and ativo;
  v_local := coalesce(v_local, v_padrao);

  select pais, fuso_horario into v_pais, v_fuso
    from public.localidades where id = v_local;

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
      select jsonb_agg(jsonb_build_object('data', f.data, 'recorrente', f.recorrente))
        from (
          select data, recorrente from public.feriados_plataforma
           where ativo and pais = coalesce(v_pais, 'BR')
          union all
          select data, recorrente from public.feriados
           where tenant_id = p_tenant and ativo
             and (localidade_id is null or localidade_id = v_local)
        ) f), '[]'::jsonb)
  );
end $$;

revoke all on function public.calendario_localidade(uuid, uuid) from public, anon;
grant execute on function public.calendario_localidade(uuid, uuid) to authenticated;
