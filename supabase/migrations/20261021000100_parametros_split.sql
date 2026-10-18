-- =====================================================================
-- Parametros comerciais, cupom por 12 meses (nao cumulativo) e split
--
-- Regras de produto:
--   - o operador da plataforma define: dias de teste, dias gratis do
--     plano anual, desconto maximo do cupom e por quantos meses ele vale;
--   - preco anual = mensal x (365 - dias gratis) / 365, em reais inteiros;
--   - nao cumulativo: no anual vale o MAIOR entre o desconto do anual e o
--     do cupom; no mensal, so o cupom;
--   - o desconto do cupom vale N meses (padrao 12) depois do teste;
--   - split no Asaas: o afiliado informa a carteira (walletId) no portal e
--     a comissao cai direto na conta dele enquanto durar a recorrencia;
--   - o banco diz como cada assinatura deve estar no gateway; uma rotina
--     diaria aplica a diferenca (fim do desconto, fim do split, carteira
--     cadastrada depois da venda).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Parametros (uma linha so)
-- ---------------------------------------------------------------------
create table public.parametros_comerciais (
  id                    boolean primary key default true check (id),
  dias_teste            smallint not null default 14 check (dias_teste between 0 and 90),
  dias_gratis_anual     smallint not null default 60 check (dias_gratis_anual between 0 and 180),
  desconto_cupom_max    numeric(5,2) not null default 50 check (desconto_cupom_max between 0 and 90),
  meses_desconto_cupom  smallint not null default 12 check (meses_desconto_cupom between 1 and 60),
  atualizado_em         timestamptz not null default now(),
  atualizado_por        uuid
);
insert into public.parametros_comerciais default values;

alter table public.parametros_comerciais enable row level security;
revoke all on public.parametros_comerciais from anon;
-- Leitura liberada a quem esta logado (tela de assinatura, portal); a
-- gravacao so pela funcao do operador.
create policy parametros_ler on public.parametros_comerciais for select to authenticated using (true);
grant select on public.parametros_comerciais to authenticated, service_role;

create trigger tg_parametros_comerciais_auditoria after update on public.parametros_comerciais
  for each row execute function app.auditar();

-- Preco anual (por usuario/mes) a partir do mensal, arredondado em reais.
create or replace function app.preco_anual(p_mensal integer) returns integer
language sql stable security definer set search_path = '' as $$
  select (round(p_mensal * (365 - p.dias_gratis_anual) / 365.0 / 100) * 100)::int
    from public.parametros_comerciais p
$$;

-- As tabelas de preco guardam o anual ja calculado: quem le o catalogo
-- (checkout, telas) nao precisa saber da regra.
create or replace function app.recalcular_precos_anuais() returns void
language sql security definer set search_path = '' as $$
  update public.planos set preco_anual_centavos = app.preco_anual(preco_mensal_centavos);
  update public.planos_addons set preco_anual_centavos = app.preco_anual(preco_mensal_centavos);
$$;
select app.recalcular_precos_anuais();

create or replace function public.salvar_parametros_comerciais(
  p_dias_teste integer, p_dias_gratis_anual integer,
  p_desconto_cupom_max numeric, p_meses_desconto_cupom integer
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  if exists (select 1 from public.afiliados where ativo and desconto_pct > p_desconto_cupom_max) then
    raise exception using errcode = 'P0001',
      message = 'Há afiliados ativos com desconto acima de ' || p_desconto_cupom_max::text
                || '%. Ajuste-os antes.';
  end if;
  update public.parametros_comerciais set
    dias_teste = p_dias_teste, dias_gratis_anual = p_dias_gratis_anual,
    desconto_cupom_max = p_desconto_cupom_max, meses_desconto_cupom = p_meses_desconto_cupom,
    atualizado_em = now(), atualizado_por = auth.uid();
  perform app.recalcular_precos_anuais();
end $$;
revoke all on function public.salvar_parametros_comerciais(integer, integer, numeric, integer) from public, anon;
grant execute on function public.salvar_parametros_comerciais(integer, integer, numeric, integer) to authenticated;

-- Teste da empresa nova pelo parametro (o provisionamento grava 14 fixo).
create or replace function app.assinatura_dias_teste() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'teste' then
    new.teste_ate := (now() at time zone 'America/Sao_Paulo')::date
                     + (select dias_teste from public.parametros_comerciais);
  end if;
  return new;
end $$;
create trigger tg_assinaturas_dias_teste before insert on public.assinaturas
  for each row execute function app.assinatura_dias_teste();

-- ---------------------------------------------------------------------
-- 2. Desconto do afiliado limitado pelo parametro
-- ---------------------------------------------------------------------
alter table public.afiliados drop constraint afiliados_desconto_pct_check;
alter table public.afiliados add constraint afiliados_desconto_pct_check
  check (desconto_pct between 0 and 90);

create or replace function app.afiliado_desconto_maximo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max numeric;
begin
  select desconto_cupom_max into v_max from public.parametros_comerciais;
  if new.desconto_pct > v_max then
    raise exception using errcode = '23514',
      message = 'Desconto máximo do cupom é de ' || v_max::text || '%.';
  end if;
  return new;
end $$;
create trigger tg_afiliados_desconto_maximo before insert or update of desconto_pct on public.afiliados
  for each row execute function app.afiliado_desconto_maximo();

-- Carteira do Asaas: o proprio afiliado informa no portal.
create or replace function public.salvar_carteira_afiliado(p_carteira text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_carteira text := nullif(lower(trim(coalesce(p_carteira, ''))), '');
begin
  if v_carteira is not null
     and v_carteira !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identificador de carteira inválido. Copie o walletId exatamente como aparece no Asaas.'
      using errcode = '22023';
  end if;
  update public.afiliados set gateway_conta_id = v_carteira
   where usuario_id = auth.uid() and ativo;
  if not found then
    raise exception 'Você não é afiliado.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.salvar_carteira_afiliado(text) from public, anon;
grant execute on function public.salvar_carteira_afiliado(text) to authenticated;

-- Operador ajusta desconto e situacao do afiliado (o codigo nao muda:
-- ja foi divulgado).
create or replace function public.atualizar_afiliado(p_id uuid, p_desconto numeric, p_ativo boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  update public.afiliados set desconto_pct = p_desconto, ativo = p_ativo where id = p_id;
  if not found then
    raise exception 'Afiliado não encontrado.' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.atualizar_afiliado(uuid, numeric, boolean) from public, anon;
grant execute on function public.atualizar_afiliado(uuid, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Assinatura: prazo do desconto e o que esta aplicado no gateway
-- ---------------------------------------------------------------------
alter table public.assinaturas
  add column desconto_ate            date,
  add column gateway_valor_centavos  integer,
  add column gateway_split_carteira  text,
  add column gateway_split_pct       numeric(5,2),
  add column gateway_sincronizado_em timestamptz;

-- Cupons ja usados: o prazo conta do fim do teste.
update public.assinaturas
   set desconto_ate = (coalesce(teste_ate, (criado_em at time zone 'America/Sao_Paulo')::date)
                       + make_interval(months => (select meses_desconto_cupom from public.parametros_comerciais)))::date
 where desconto_pct > 0 and desconto_ate is null;

-- Valor mensal: maior desconto entre anual e cupom (nao cumulativo).
create or replace function public.valor_mensal_assinatura(p_assinatura uuid) returns integer
language sql stable security definer set search_path = '' as $$
  with x as (
    select a.usuarios_contratados as qtd, a.ciclo,
           p.preco_mensal_centavos
             + case when a.addon_ia and not p.ia_incluida
                    then (select preco_mensal_centavos from public.planos_addons where codigo = 'ia')
                    else 0 end as mensal,
           p.preco_anual_centavos
             + case when a.addon_ia and not p.ia_incluida
                    then (select preco_anual_centavos from public.planos_addons where codigo = 'ia')
                    else 0 end as anual,
           case when a.desconto_pct > 0
                 and (a.desconto_ate is null
                      or (now() at time zone 'America/Sao_Paulo')::date < a.desconto_ate)
                then a.desconto_pct else 0 end as cupom
      from public.assinaturas a join public.planos p on p.codigo = a.plano_codigo
     where a.id = p_assinatura
  )
  select case
           when ciclo = 'anual' and qtd * mensal * (100 - cupom) / 100 >= qtd * anual
             then qtd * anual
           else round(qtd * mensal * (100 - cupom) / 100)::int
         end
    from x
$$;

-- ---------------------------------------------------------------------
-- 4. Checkout: grava o prazo do desconto
-- ---------------------------------------------------------------------
create or replace function app.assinatura_prazo_desconto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.desconto_pct > 0 and (tg_op = 'INSERT' or old.desconto_pct is distinct from new.desconto_pct) then
    new.desconto_ate := (coalesce(new.teste_ate, (now() at time zone 'America/Sao_Paulo')::date)
                         + make_interval(months => (select meses_desconto_cupom
                                                      from public.parametros_comerciais)))::date;
  elsif new.desconto_pct = 0 then
    new.desconto_ate := null;
  end if;
  return new;
end $$;
create trigger tg_assinaturas_prazo_desconto before insert or update of desconto_pct on public.assinaturas
  for each row execute function app.assinatura_prazo_desconto();

-- ---------------------------------------------------------------------
-- 5. Como cada assinatura deve estar no gateway, e o que mudou
-- ---------------------------------------------------------------------
create or replace function public.estado_gateway_desejado(p_assinatura uuid default null)
returns table (
  assinatura_id uuid, gateway_assinatura_id text,
  valor_ciclo_centavos integer, split_carteira text, split_pct numeric, mudou boolean
)
language sql stable security definer set search_path = '' as $$
  with d as (
    select a.id, a.gateway_assinatura_id,
           public.valor_mensal_assinatura(a.id) * case a.ciclo when 'anual' then 12 else 1 end as valor,
           case when f.id is not null and f.ativo and f.gateway_conta_id is not null
                 and not a.cortesia
                 and (now() at time zone 'America/Sao_Paulo')::date
                     < ((a.atribuido_em at time zone 'America/Sao_Paulo')::date
                        + make_interval(months => f.meses_recorrencia))::date
                then f.gateway_conta_id end as carteira,
           f.comissao_pct,
           a.gateway_valor_centavos, a.gateway_split_carteira, a.gateway_split_pct
      from public.assinaturas a
      left join public.afiliados f on f.id = a.afiliado_id
     where a.status <> 'cancelada' and a.gateway_assinatura_id is not null
       and (p_assinatura is null or a.id = p_assinatura)
  )
  select id, gateway_assinatura_id, valor, carteira,
         case when carteira is not null then comissao_pct end,
         (gateway_valor_centavos is distinct from valor
          or gateway_split_carteira is distinct from carteira
          or gateway_split_pct is distinct from case when carteira is not null then comissao_pct end)
    from d
$$;

create or replace function public.registrar_estado_gateway(
  p_assinatura uuid, p_valor integer, p_carteira text, p_pct numeric
) returns void
language sql security definer set search_path = '' as $$
  update public.assinaturas
     set gateway_valor_centavos = p_valor, gateway_split_carteira = p_carteira,
         gateway_split_pct = p_pct, gateway_sincronizado_em = now()
   where id = p_assinatura
$$;

revoke all on function public.estado_gateway_desejado(uuid) from public, anon, authenticated;
revoke all on function public.registrar_estado_gateway(uuid, integer, text, numeric) from public, anon, authenticated;
grant execute on function public.estado_gateway_desejado(uuid) to service_role;
grant execute on function public.registrar_estado_gateway(uuid, integer, text, numeric) to service_role;

-- ---------------------------------------------------------------------
-- 6. Comissao paga pelo split nasce paga
-- ---------------------------------------------------------------------
alter table public.comissoes add column via_split boolean not null default false;

create or replace function app.gerar_comissao(p_fatura uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f record;
  a record;
  af record;
begin
  select * into f from public.faturas where id = p_fatura and status = 'paga';
  if f.id is null then return; end if;
  select * into a from public.assinaturas where id = f.assinatura_id;
  if a.afiliado_id is null or a.cortesia then return; end if;
  select * into af from public.afiliados where id = a.afiliado_id and ativo;
  if af.id is null then return; end if;
  if f.competencia >= (a.atribuido_em at time zone 'America/Sao_Paulo')::date
                      + make_interval(months => af.meses_recorrencia) then
    return;
  end if;

  if a.gateway_split_carteira is not null then
    -- O gateway ja repassou a parte do afiliado: so registra.
    insert into public.comissoes
      (afiliado_id, assinatura_id, fatura_id, valor_centavos, status, pago_em, via_split)
    values (af.id, a.id, f.id, round(f.valor_centavos * coalesce(a.gateway_split_pct, af.comissao_pct) / 100)::int,
            'paga', coalesce(f.pago_em, now()), true)
    on conflict (fatura_id) do nothing;
  else
    insert into public.comissoes (afiliado_id, assinatura_id, fatura_id, valor_centavos, liberar_em)
    values (af.id, a.id, f.id, round(f.valor_centavos * af.comissao_pct / 100)::int,
            (coalesce(f.pago_em, now()) at time zone 'America/Sao_Paulo')::date + 30)
    on conflict (fatura_id) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Portal do afiliado: vendas, comissoes e carteira
-- ---------------------------------------------------------------------
create or replace function public.meu_portal_afiliado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f      record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into f from public.afiliados where usuario_id = auth.uid() and ativo;
  if f.id is null then
    raise exception 'Voce nao e afiliado.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'codigo', f.codigo,
    'nome', f.nome,
    'tipo', f.tipo,
    'comissao_pct', f.comissao_pct,
    'desconto_pct', f.desconto_pct,
    'meses_recorrencia', f.meses_recorrencia,
    'carteira', f.gateway_conta_id,
    'cliques_30d', (select count(*) from public.indicacoes
                     where afiliado_id = f.id and criado_em >= now() - interval '30 days'),
    'cliques_total', (select count(*) from public.indicacoes where afiliado_id = f.id),
    'vendas', (
      select jsonb_build_object(
               'em_teste', count(*) filter (where a.status = 'teste'),
               'ativas',   count(*) filter (where a.status in ('ativa', 'inadimplente')),
               'canceladas', count(*) filter (where a.status = 'cancelada'),
               'receita_mensal_centavos', coalesce(sum(public.valor_mensal_assinatura(a.id))
                                            filter (where a.status in ('ativa', 'inadimplente')), 0))
        from public.assinaturas a where a.afiliado_id = f.id),
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empresa', t.nome,
               'plano', p.nome,
               'usuarios', a.usuarios_contratados,
               'ciclo', a.ciclo,
               'status', a.status,
               'cupom', a.cupom,
               'desde', (a.atribuido_em at time zone 'America/Sao_Paulo')::date,
               'valor_mensal_centavos', public.valor_mensal_assinatura(a.id),
               'comissao_ate', ((a.atribuido_em at time zone 'America/Sao_Paulo')::date
                                + make_interval(months => f.meses_recorrencia))::date,
               'comissoes_centavos', (select coalesce(sum(c.valor_centavos), 0)
                                        from public.comissoes c where c.assinatura_id = a.id))
             order by a.atribuido_em desc)
        from public.assinaturas a
        join public.tenants t on t.id = a.tenant_id
        join public.planos p on p.codigo = a.plano_codigo
       where a.afiliado_id = f.id), '[]'::jsonb),
    'totais', jsonb_build_object(
      'prevista', (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status = 'prevista'),
      'liberada', (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status = 'liberada'),
      'paga',     (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status = 'paga'),
      'mes',      (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status <> 'estornada'
                      and date_trunc('month', criado_em at time zone 'America/Sao_Paulo')
                          = date_trunc('month', v_hoje::timestamp))),
    'comissoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empresa', t.nome,
               'valor_centavos', c.valor_centavos,
               'status', c.status,
               'via_split', c.via_split,
               'competencia', fa.competencia,
               'liberar_em', c.liberar_em,
               'pago_em', (c.pago_em at time zone 'America/Sao_Paulo')::date)
             order by c.criado_em desc)
        from public.comissoes c
        join public.faturas fa on fa.id = c.fatura_id
        join public.tenants t on t.id = fa.tenant_id
       where c.afiliado_id = f.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 8. Desempenho por afiliado (painel do operador)
-- ---------------------------------------------------------------------
create or replace function public.desempenho_afiliados()
returns table (
  afiliado_id uuid, em_teste integer, ativas integer, canceladas integer,
  receita_mensal_centavos bigint, comissao_total_centavos bigint,
  comissao_a_pagar_centavos bigint, tem_carteira boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  return query
    select f.id,
           (count(a.id) filter (where a.status = 'teste'))::int,
           (count(a.id) filter (where a.status in ('ativa', 'inadimplente')))::int,
           (count(a.id) filter (where a.status = 'cancelada'))::int,
           coalesce(sum(public.valor_mensal_assinatura(a.id))
                    filter (where a.status in ('ativa', 'inadimplente')), 0)::bigint,
           (select coalesce(sum(c.valor_centavos), 0) from public.comissoes c
             where c.afiliado_id = f.id and c.status <> 'estornada')::bigint,
           (select coalesce(sum(c.valor_centavos), 0) from public.comissoes c
             where c.afiliado_id = f.id and c.status in ('prevista', 'liberada'))::bigint,
           f.gateway_conta_id is not null
      from public.afiliados f
      left join public.assinaturas a on a.afiliado_id = f.id
     group by f.id;
end $$;
revoke all on function public.desempenho_afiliados() from public, anon;
grant execute on function public.desempenho_afiliados() to authenticated;