-- =====================================================================
-- Autoindicacao: o afiliado nao compra com o proprio cupom
--
-- Antes so se comparava o e-mail, e bastava usar outro e-mail. Agora a
-- regra compara o CPF/CNPJ:
--   - o operador informa o documento ao cadastrar o afiliado;
--   - no checkout, cupom de afiliado com o mesmo documento do comprador
--     e recusado; pelo link, a venda so fica sem afiliado;
--   - rede de seguranca: se o documento do afiliado for informado depois
--     da venda, a comissao dessa assinatura deixa de ser gerada.
-- =====================================================================

alter table public.afiliados
  add column documento text check (documento ~ '^([0-9]{11}|[0-9]{14})$');

comment on column public.afiliados.documento is
  'CPF ou CNPJ do afiliado (so digitos). Bloqueia o uso do proprio cupom.';

-- Um documento, um afiliado (evita varios codigos para a mesma pessoa).
create unique index ux_afiliados_documento on public.afiliados (documento)
  where documento is not null;

alter table public.assinaturas
  add column documento_cliente text check (documento_cliente ~ '^([0-9]{11}|[0-9]{14})$');

comment on column public.assinaturas.documento_cliente is
  'CPF ou CNPJ informado na contratacao (so digitos).';

-- ---------------------------------------------------------------------
-- Operador: desconto, situacao e documento do afiliado
-- ---------------------------------------------------------------------
drop function public.atualizar_afiliado(uuid, numeric, boolean);

create or replace function public.atualizar_afiliado(
  p_id uuid, p_desconto numeric, p_ativo boolean, p_documento text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_doc text := nullif(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'), '');
begin
  perform app.exigir_admin_plataforma();
  update public.afiliados
     set desconto_pct = p_desconto, ativo = p_ativo,
         documento = coalesce(v_doc, documento)
   where id = p_id;
  if not found then
    raise exception 'Afiliado não encontrado.' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.atualizar_afiliado(uuid, numeric, boolean, text) from public, anon;
grant execute on function public.atualizar_afiliado(uuid, numeric, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Checkout: mesma funcao de 20261101000100, com o documento do comprador.
-- ---------------------------------------------------------------------
drop function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text, text, text, text);

create or replace function public.checkout_criar_empresa(
  p_nome text, p_slug text, p_admin uuid, p_plano text, p_ciclo text,
  p_usuarios integer, p_addon_ia boolean, p_visitante text, p_cupom text default null,
  p_versao_termos text default null, p_ip text default null, p_user_agent text default null,
  p_documento text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant   uuid;
  v_afiliado uuid;
  v_desconto numeric(5,2) := 0;
  v_cupom    text;
  v_email    text;
  v_doc      text := nullif(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'), '');
  f          record;
begin
  if exists (select 1 from public.tenants where slug = lower(p_slug) and excluido_em is null) then
    raise exception 'Ja existe uma empresa com o endereco "%".', p_slug using errcode = '23505';
  end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo) then
    raise exception 'Plano invalido.' using errcode = 'P0001';
  end if;

  select email into v_email from public.usuarios where id = p_admin;

  if nullif(trim(coalesce(p_cupom, '')), '') is not null then
    select id, codigo, email, desconto_pct, documento into f
      from public.afiliados
     where upper(codigo) = upper(trim(p_cupom)) and ativo;
    if f.id is null then
      raise exception 'Cupom "%" não encontrado ou inativo.', upper(trim(p_cupom))
        using errcode = '22023';
    end if;
    if lower(coalesce(v_email, '')) = lower(f.email) or (v_doc is not null and v_doc = f.documento) then
      raise exception 'Não é possível usar o próprio cupom.' using errcode = '22023';
    end if;
    v_afiliado := f.id;
    v_desconto := f.desconto_pct;
    v_cupom    := f.codigo;
  elsif p_visitante is not null then
    -- Sem cupom digitado: vale o ultimo clique em link (90 dias), sem desconto.
    v_afiliado := app.afiliado_do_visitante(p_visitante);
    -- Link do proprio afiliado: a venda vale, mas sem afiliado.
    if v_afiliado is not null and v_doc is not null
       and exists (select 1 from public.afiliados where id = v_afiliado and documento = v_doc) then
      v_afiliado := null;
    end if;
  end if;

  v_tenant := app.provisionar_tenant(trim(p_nome), lower(trim(p_slug)), p_admin);

  update public.assinaturas set
    plano_codigo = p_plano, ciclo = p_ciclo, usuarios_contratados = greatest(p_usuarios, 3),
    addon_ia = p_addon_ia, afiliado_id = v_afiliado,
    atribuido_em = case when v_afiliado is not null then now() end,
    cupom = v_cupom, desconto_pct = v_desconto, documento_cliente = v_doc
   where tenant_id = v_tenant;

  if nullif(trim(coalesce(p_versao_termos, '')), '') is not null then
    insert into public.aceites_termos (tenant_id, usuario_id, email, versao, ip, user_agent)
    values (v_tenant, p_admin, coalesce(v_email, ''), trim(p_versao_termos),
            left(nullif(trim(coalesce(p_ip, '')), ''), 64),
            left(nullif(trim(coalesce(p_user_agent, '')), ''), 500));
  end if;

  return v_tenant;
end $$;

revoke all on function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------
-- Comissao: mesma funcao de 20261021000100, sem comissao na autoindicacao.
-- ---------------------------------------------------------------------
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
  -- Autoindicacao descoberta depois da venda: sem comissao.
  if af.documento is not null and af.documento = a.documento_cliente then return; end if;
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
-- Split no gateway: mesma funcao de 20261021000100. Na autoindicacao
-- descoberta depois da venda, o split sai na proxima sincronizacao.
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
                 and f.documento is distinct from a.documento_cliente
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
