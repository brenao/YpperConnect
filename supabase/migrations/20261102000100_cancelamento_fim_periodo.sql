-- Cancelamento no fim do periodo pago (regra comercial de 2026-11-02):
--   - mensal: acesso ate o fim do mes ja pago, sem novas cobrancas;
--   - anual:  acesso ate o fim dos 12 meses pagos;
--   - teste:  encerra no mesmo dia, sem cobranca.
--
-- Antes, cancelar gravava status 'cancelada' na hora e o acesso caia no
-- mesmo instante. Agora o cancelamento so AGENDA o fim (encerra_em) e a
-- assinatura continua valendo ate la. A rotina diaria (/api/rotinas)
-- chama encerrar_assinaturas_vencidas(), que grava 'cancelada' no dia
-- seguinte ao fim. Como todo o controle de acesso ja olha para
-- "status <> 'cancelada'", nada mais precisou mudar.

alter table public.assinaturas add column encerra_em date;

comment on column public.assinaturas.encerra_em is
  'Ultimo dia de acesso de uma assinatura com cancelamento agendado. Nulo = sem cancelamento.';

-- Ultimo dia de acesso: o fim do periodo ja pago, nunca antes de hoje.
create or replace function app.fim_do_acesso(a public.assinaturas) returns date
language sql stable set search_path = '' as $$
  select greatest((now() at time zone 'America/Sao_Paulo')::date,
                  coalesce(case when a.status = 'teste' then null else a.periodo_fim end,
                           (now() at time zone 'America/Sao_Paulo')::date))
$$;
revoke all on function app.fim_do_acesso(public.assinaturas) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Operador agenda o cancelamento (pedido do cliente por e-mail).
-- Devolve o fim do acesso e o id da assinatura no gateway, para o
-- servidor cancelar as proximas cobrancas.
-- ---------------------------------------------------------------------
create or replace function public.agendar_cancelamento(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.assinaturas;
begin
  perform app.exigir_admin_plataforma();

  select * into a from public.assinaturas where tenant_id = p_tenant and status <> 'cancelada';
  if a.id is null then
    raise exception 'Empresa sem assinatura vigente.' using errcode = 'P0002';
  end if;

  if a.encerra_em is null then
    update public.assinaturas
       set encerra_em = app.fim_do_acesso(a), cancelada_em = now()
     where id = a.id
    returning * into a;
  end if;

  return jsonb_build_object('encerra_em', a.encerra_em, 'gateway', a.gateway,
                            'gateway_assinatura_id', a.gateway_assinatura_id);
end $$;

revoke all on function public.agendar_cancelamento(uuid) from public, anon;
grant execute on function public.agendar_cancelamento(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Rotina diaria: encerra o que passou do ultimo dia de acesso.
-- ---------------------------------------------------------------------
create or replace function public.encerrar_assinaturas_vencidas() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_qtd integer;
begin
  update public.assinaturas
     set status = 'cancelada'
   where status <> 'cancelada'
     and encerra_em is not null
     and encerra_em < (now() at time zone 'America/Sao_Paulo')::date;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

revoke all on function public.encerrar_assinaturas_vencidas() from public, anon, authenticated;
grant execute on function public.encerrar_assinaturas_vencidas() to service_role;

-- ---------------------------------------------------------------------
-- Eventos do gateway: mesma funcao de 20261012000100, com uma mudanca.
-- Assinatura cancelada no gateway (pelo operador ou direto no Asaas)
-- agenda o fim do acesso em vez de cortar na hora.
-- ---------------------------------------------------------------------
create or replace function public.processar_evento_gateway(
  p_gateway text, p_evento_id text, p_tipo text, p_payload jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a        public.assinaturas;
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
    update public.assinaturas
       set encerra_em = coalesce(encerra_em, app.fim_do_acesso(a)),
           cancelada_em = coalesce(cancelada_em, now())
     where id = a.id;
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
-- Situacao da assinatura: mesma funcao de 20261009000100, com encerra_em
-- (a tela de assinatura avisa ate quando vai o acesso).
-- ---------------------------------------------------------------------
create or replace function public.situacao_assinatura(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a record;
  p record;
begin
  -- Com usuario logado: so a propria empresa (ou operador da plataforma).
  -- Sem usuario: chamada interna do sistema (rotinas com a chave de servico).
  if auth.uid() is not null
     and p_tenant not in (select app.tenants_do_usuario())
     and not app.eh_admin_plataforma() then
    raise exception 'Sem acesso a esta empresa.' using errcode = '42501';
  end if;

  select * into a from public.assinaturas where tenant_id = p_tenant and status <> 'cancelada';
  if a.id is null then
    return jsonb_build_object('status', 'sem_assinatura', 'acesso', 'bloqueado',
                              'modulos', '[]'::jsonb, 'ia', false);
  end if;
  select * into p from public.planos where codigo = a.plano_codigo;

  return jsonb_build_object(
    'status', a.status,
    'plano', a.plano_codigo,
    'nivel', p.nivel,
    'cortesia', a.cortesia,
    'modulos', case p.modulo when 'suite' then '["itsm","projetos"]'::jsonb
                             else jsonb_build_array(p.modulo) end,
    'ia', p.ia_incluida or a.addon_ia,
    'usuarios_contratados', a.usuarios_contratados,
    'usuarios_pagantes', public.usuarios_pagantes(p_tenant),
    'teste_ate', a.teste_ate,
    'periodo_fim', a.periodo_fim,
    'encerra_em', a.encerra_em,
    -- Inadimplencia em degraus: aviso -> 7 dias somente leitura -> suspensao.
    'acesso', case
      when a.status = 'teste' and a.teste_ate < (now() at time zone 'America/Sao_Paulo')::date
        then 'bloqueado'
      when a.status in ('teste','ativa') then 'total'
      when a.status = 'inadimplente' then 'total_com_aviso'
      when a.status = 'somente_leitura' then 'somente_leitura'
      else 'bloqueado' end);
end $$;

-- ---------------------------------------------------------------------
-- Painel da plataforma: mesma funcao de 20261011000100, com encerra_em.
-- ---------------------------------------------------------------------
drop function public.painel_assinaturas();

create or replace function public.painel_assinaturas()
returns table (
  tenant_id uuid, empresa text, slug text, assinatura_id uuid,
  plano text, nivel text, ciclo text, status text, cortesia boolean, addon_ia boolean,
  usuarios_contratados integer, usuarios_pagantes integer, valor_mensal_centavos integer,
  teste_ate date, periodo_fim date, afiliado_codigo text, encerra_em date
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  return query
    select t.id, t.nome, t.slug, a.id, a.plano_codigo, p.nivel, a.ciclo, a.status, a.cortesia,
           a.addon_ia, a.usuarios_contratados, public.usuarios_pagantes(t.id),
           case when a.cortesia then 0 else public.valor_mensal_assinatura(a.id) end,
           a.teste_ate, a.periodo_fim, f.codigo, a.encerra_em
      from public.tenants t
      left join public.assinaturas a on a.tenant_id = t.id and a.status <> 'cancelada'
      left join public.planos p on p.codigo = a.plano_codigo
      left join public.afiliados f on f.id = a.afiliado_id
     where t.excluido_em is null
     order by t.nome;
end $$;

revoke all on function public.painel_assinaturas() from public, anon;
grant execute on function public.painel_assinaturas() to authenticated;
