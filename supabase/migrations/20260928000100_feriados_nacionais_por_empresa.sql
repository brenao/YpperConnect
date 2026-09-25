-- =====================================================================
-- Passo 3.3 (correcao) - Feriado nacional volta a ser cadastro da empresa
--
-- Produto unico: a tela de feriados e a mesma do legado, onde a empresa
-- cadastra, edita, desativa e exclui tambem os nacionais. Para nenhuma
-- empresa precisar recadastrar o Natal, `feriados_plataforma` passa a
-- ser apenas o MODELO copiado para cada empresa ao ser criada.
-- =====================================================================

alter table public.feriados drop constraint feriados_tipo_check;
alter table public.feriados drop constraint ck_feriados_localidade;

alter table public.feriados
  add constraint feriados_tipo_check
  check (tipo in ('nacional', 'estadual', 'municipal', 'facultativo', 'empresa'));

-- Mesma regra do legado: nacional sem localidade; estadual e municipal
-- sempre com a localidade a que se aplicam.
alter table public.feriados
  add constraint ck_feriados_localidade check (
    (tipo = 'nacional' and localidade_id is null)
    or (tipo in ('estadual', 'municipal') and localidade_id is not null)
    or tipo in ('facultativo', 'empresa')
  );

comment on table public.feriados_plataforma is
  'Modelo de feriados nacionais copiado para cada empresa nova (app.copiar_feriados_nacionais).';

create or replace function app.copiar_feriados_nacionais(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.feriados (tenant_id, data, descricao, tipo, recorrente)
  select p_tenant, f.data, f.descricao, 'nacional', f.recorrente
    from public.feriados_plataforma f
   where f.ativo and f.pais = 'BR'
  on conflict do nothing
$$;

revoke all on function app.copiar_feriados_nacionais(uuid) from public, anon, authenticated;

create or replace function app.provisionar_tenant(p_nome text, p_slug text, p_dono uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_org    uuid;
begin
  insert into public.tenants (nome, slug) values (p_nome, lower(p_slug))
  returning id into v_tenant;

  insert into public.organizacoes (tenant_id, tipo, relacao, nome)
  values (v_tenant, 'empresa', 'interna', p_nome)
  returning id into v_org;

  perform app.criar_papeis_padrao(v_tenant);
  perform app.criar_calendario_padrao(v_tenant);
  perform app.copiar_feriados_nacionais(v_tenant);

  insert into public.tenant_membros (tenant_id, usuario_id, tipo, organizacao_id, origem)
  values (v_tenant, p_dono, 'interno', v_org, 'manual');

  insert into public.atribuicoes (tenant_id, usuario_id, papel_id)
  select v_tenant, p_dono, id from public.papeis
   where tenant_id = v_tenant and chave = 'admin_tenant';

  return v_tenant;
end $$;

revoke all on function app.provisionar_tenant(text, text, uuid) from public, anon, authenticated;

-- Empresas que ja existem recebem os nacionais agora.
do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.copiar_feriados_nacionais(t);
  end loop;
end $$;

-- O calculo passa a ler so os feriados da empresa: um nacional que ela
-- desativou ("nao parar neste ano") nao pode voltar pela porta do modelo.
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
       where tenant_id = p_tenant and ativo
         and (localidade_id is null or localidade_id = v_local)), '[]'::jsonb)
  );
end $$;
