-- =====================================================================
-- Cupom de indicacao digitado na compra
--
-- Regras de produto:
--   - o cliente informa o codigo do afiliado no checkout (o link so
--     preenche o campo); o codigo digitado vence o clique antigo;
--   - o numero do codigo e o desconto do comprador: LUCIANA20 = 20%
--     (desconto_pct do afiliado, ate 50%), por toda a assinatura;
--   - a comissao do afiliado continua pelo tipo (20% ou 30%) e incide
--     sobre o valor pago, ja com o desconto;
--   - so empresa nova; o afiliado nao usa o proprio cupom.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Desconto do afiliado e o que ficou gravado na assinatura
-- ---------------------------------------------------------------------
alter table public.afiliados
  add column desconto_pct numeric(5,2) not null default 0 check (desconto_pct between 0 and 50);

-- Codigos que ja existem: o numero do final vira o desconto (LUCIANA20 -> 20).
update public.afiliados
   set desconto_pct = least(50, (substring(codigo from '([0-9]+)$'))::numeric)
 where codigo ~ '[0-9]+$';

alter table public.assinaturas
  add column cupom        text,
  add column desconto_pct numeric(5,2) not null default 0 check (desconto_pct between 0 and 100);

-- Valor mensal ja com o desconto do cupom (o gateway cobra este valor e
-- a comissao sai da fatura paga).
create or replace function public.valor_mensal_assinatura(p_assinatura uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select round(
           a.usuarios_contratados *
           (case a.ciclo when 'anual' then p.preco_anual_centavos else p.preco_mensal_centavos end
            + case when a.addon_ia and not p.ia_incluida
                   then (select case a.ciclo when 'anual' then preco_anual_centavos
                                             else preco_mensal_centavos end
                           from public.planos_addons where codigo = 'ia')
                   else 0 end)
           * (100 - a.desconto_pct) / 100)::int
    from public.assinaturas a join public.planos p on p.codigo = a.plano_codigo
   where a.id = p_assinatura
$$;

-- ---------------------------------------------------------------------
-- 2. Validacao do cupom (tela de compra, pelo servidor)
-- ---------------------------------------------------------------------
create or replace function public.validar_cupom(p_codigo text, p_email text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f record;
begin
  select codigo, nome, email, desconto_pct into f
    from public.afiliados
   where upper(codigo) = upper(trim(coalesce(p_codigo, ''))) and ativo;

  if f.codigo is null then
    return jsonb_build_object('valido', false, 'motivo', 'Cupom não encontrado ou inativo.');
  end if;
  if p_email is not null and lower(trim(p_email)) = lower(f.email) then
    return jsonb_build_object('valido', false, 'motivo', 'Não é possível usar o próprio cupom.');
  end if;

  return jsonb_build_object(
    'valido',       true,
    'codigo',       f.codigo,
    'afiliado',     split_part(trim(f.nome), ' ', 1),
    'desconto_pct', f.desconto_pct);
end $$;

-- ---------------------------------------------------------------------
-- 3. Checkout com cupom (prioridade sobre o clique no link)
-- ---------------------------------------------------------------------
drop function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text);

create or replace function public.checkout_criar_empresa(
  p_nome text, p_slug text, p_admin uuid, p_plano text, p_ciclo text,
  p_usuarios integer, p_addon_ia boolean, p_visitante text, p_cupom text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant   uuid;
  v_afiliado uuid;
  v_desconto numeric(5,2) := 0;
  v_cupom    text;
  v_email    text;
  f          record;
begin
  if exists (select 1 from public.tenants where slug = lower(p_slug) and excluido_em is null) then
    raise exception 'Ja existe uma empresa com o endereco "%".', p_slug using errcode = '23505';
  end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo) then
    raise exception 'Plano invalido.' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_cupom, '')), '') is not null then
    select id, codigo, email, desconto_pct into f
      from public.afiliados
     where upper(codigo) = upper(trim(p_cupom)) and ativo;
    if f.id is null then
      raise exception 'Cupom "%" não encontrado ou inativo.', upper(trim(p_cupom))
        using errcode = '22023';
    end if;
    select email into v_email from public.usuarios where id = p_admin;
    if lower(coalesce(v_email, '')) = lower(f.email) then
      raise exception 'Não é possível usar o próprio cupom.' using errcode = '22023';
    end if;
    v_afiliado := f.id;
    v_desconto := f.desconto_pct;
    v_cupom    := f.codigo;
  elsif p_visitante is not null then
    -- Sem cupom digitado: vale o ultimo clique em link (90 dias), sem desconto.
    v_afiliado := app.afiliado_do_visitante(p_visitante);
  end if;

  v_tenant := app.provisionar_tenant(trim(p_nome), lower(trim(p_slug)), p_admin);

  update public.assinaturas set
    plano_codigo = p_plano, ciclo = p_ciclo, usuarios_contratados = greatest(p_usuarios, 3),
    addon_ia = p_addon_ia, afiliado_id = v_afiliado,
    atribuido_em = case when v_afiliado is not null then now() end,
    cupom = v_cupom, desconto_pct = v_desconto
   where tenant_id = v_tenant;

  return v_tenant;
end $$;

revoke all on function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text)
  to service_role;
revoke all on function public.validar_cupom(text, text) from public, anon, authenticated;
grant execute on function public.validar_cupom(text, text) to service_role;