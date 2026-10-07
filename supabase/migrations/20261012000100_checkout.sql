-- =====================================================================
-- Comercial (CM4): checkout, gateway (webhook) e inadimplencia
--
-- Tudo aqui roda pelo servidor com a chave de servico (service_role):
-- checkout publico, cliques de indicacao e eventos do gateway nao tem
-- usuario logado. Nenhuma funcao fica acessivel a anon/authenticated.
-- =====================================================================

-- E-mail de boas-vindas (convite do administrador) na fila
alter table public.notificacoes drop constraint notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'chamado_criado', 'chamado_aberto_confirmacao', 'chamado_atribuido', 'chamado_atividade',
  'chamado_resolvido', 'chamado_reaberto', 'chamado_status', 'projeto_lembrete',
  'acesso_solicitado', 'acesso_decidido', 'boas_vindas'));

-- ---------------------------------------------------------------------
-- Indicacao: clique no link do afiliado
-- ---------------------------------------------------------------------
create or replace function public.registrar_indicacao(p_codigo text, p_visitante text, p_origem text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_afiliado uuid;
begin
  select id into v_afiliado from public.afiliados where codigo = lower(p_codigo) and ativo;
  if v_afiliado is null then return false; end if;
  insert into public.indicacoes (afiliado_id, visitante, origem)
  values (v_afiliado, p_visitante, left(p_origem, 300));
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Checkout: cria a empresa em teste com o plano escolhido
-- ---------------------------------------------------------------------
create or replace function public.checkout_criar_empresa(
  p_nome text, p_slug text, p_admin uuid, p_plano text, p_ciclo text,
  p_usuarios integer, p_addon_ia boolean, p_visitante text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant   uuid;
  v_afiliado uuid;
begin
  if exists (select 1 from public.tenants where slug = lower(p_slug) and excluido_em is null) then
    raise exception 'Ja existe uma empresa com o endereco "%".', p_slug using errcode = '23505';
  end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo) then
    raise exception 'Plano invalido.' using errcode = 'P0001';
  end if;

  v_tenant := app.provisionar_tenant(trim(p_nome), lower(trim(p_slug)), p_admin);
  v_afiliado := case when p_visitante is null then null else app.afiliado_do_visitante(p_visitante) end;

  update public.assinaturas set
    plano_codigo = p_plano, ciclo = p_ciclo, usuarios_contratados = greatest(p_usuarios, 3),
    addon_ia = p_addon_ia, afiliado_id = v_afiliado,
    atribuido_em = case when v_afiliado is not null then now() end
   where tenant_id = v_tenant;

  return v_tenant;
end $$;

create or replace function public.vincular_gateway(
  p_tenant uuid, p_gateway text, p_cliente text, p_assinatura text
) returns void
language sql security definer set search_path = '' as $$
  update public.assinaturas
     set gateway = p_gateway, gateway_cliente_id = p_cliente, gateway_assinatura_id = p_assinatura
   where tenant_id = p_tenant and status <> 'cancelada'
$$;

-- ---------------------------------------------------------------------
-- Eventos do gateway (idempotente: o mesmo evento so e aplicado uma vez)
-- Formato normalizado pelo adaptador do gateway:
--   tipo: pagamento_criado | pagamento_confirmado | pagamento_vencido |
--         pagamento_estornado | assinatura_cancelada
--   payload: { assinatura, fatura, valor_centavos, vencimento, pago_em,
--              metodo, link }
-- ---------------------------------------------------------------------
create or replace function public.processar_evento_gateway(
  p_gateway text, p_evento_id text, p_tipo text, p_payload jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a        record;
  v_fatura uuid;
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.eventos_gateway (gateway, evento_id, tipo, payload)
  values (p_gateway, p_evento_id, p_tipo, p_payload)
  on conflict do nothing;
  if not found then return 'repetido'; end if;

  select * into a from public.assinaturas
   where gateway = p_gateway and gateway_assinatura_id = p_payload->>'assinatura'
     and status <> 'cancelada';
  if a.id is null then
    update public.eventos_gateway set processado_em = now(), erro = 'assinatura nao encontrada'
     where gateway = p_gateway and evento_id = p_evento_id;
    return 'ignorado';
  end if;

  if p_tipo = 'assinatura_cancelada' then
    update public.assinaturas set status = 'cancelada', cancelada_em = now() where id = a.id;
  else
    -- Fatura: cria ou atualiza pelo id do gateway
    insert into public.faturas (tenant_id, assinatura_id, competencia, valor_centavos, vencimento,
                                gateway_fatura_id, link_pagamento)
    values (a.tenant_id, a.id, (p_payload->>'vencimento')::date, (p_payload->>'valor_centavos')::int,
            (p_payload->>'vencimento')::date, p_payload->>'fatura', p_payload->>'link')
    on conflict (gateway_fatura_id) do update
      set link_pagamento = coalesce(excluded.link_pagamento, public.faturas.link_pagamento)
    returning id into v_fatura;

    if p_tipo = 'pagamento_confirmado' then
      update public.faturas
         set status = 'paga', metodo = p_payload->>'metodo',
             pago_em = coalesce((p_payload->>'pago_em')::timestamptz, now())
       where id = v_fatura;
      update public.assinaturas
         set status = 'ativa', inadimplente_desde = null,
             periodo_inicio = coalesce(periodo_inicio, v_hoje),
             periodo_fim = (p_payload->>'vencimento')::date
                           + case ciclo when 'anual' then interval '1 year' else interval '1 month' end
       where id = a.id;
      perform app.gerar_comissao(v_fatura);
    elsif p_tipo = 'pagamento_vencido' then
      update public.faturas set status = 'vencida' where id = v_fatura and status = 'pendente';
      update public.assinaturas
         set status = 'inadimplente', inadimplente_desde = coalesce(inadimplente_desde, v_hoje)
       where id = a.id and status in ('ativa', 'teste');
    elsif p_tipo = 'pagamento_estornado' then
      update public.faturas set status = 'estornada' where id = v_fatura;
      update public.comissoes set status = 'estornada' where fatura_id = v_fatura and status <> 'paga';
    end if;
  end if;

  update public.eventos_gateway set processado_em = now()
   where gateway = p_gateway and evento_id = p_evento_id;
  return 'processado';
end $$;

-- ---------------------------------------------------------------------
-- Inadimplencia em degraus (rotina diaria):
-- aviso -> 7 dias: somente leitura -> 14 dias: suspensa. Nada se apaga.
-- ---------------------------------------------------------------------
create or replace function public.aplicar_inadimplencia() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  n1 integer;
  n2 integer;
begin
  update public.assinaturas set status = 'suspensa'
   where status in ('inadimplente', 'somente_leitura') and not cortesia
     and inadimplente_desde <= v_hoje - 14;
  get diagnostics n1 = row_count;
  update public.assinaturas set status = 'somente_leitura'
   where status = 'inadimplente' and not cortesia and inadimplente_desde <= v_hoje - 7;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('aplicar-inadimplencia', '0 7 * * *', 'select public.aplicar_inadimplencia()');
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'registrar_indicacao(text, text, text)',
    'checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text)',
    'vincular_gateway(uuid, text, text, text)',
    'processar_evento_gateway(text, text, text, jsonb)',
    'aplicar_inadimplencia()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- O checkout calcula o valor pelo servidor (chave de servico).
grant execute on function public.valor_mensal_assinatura(uuid) to service_role;