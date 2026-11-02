-- Correcao de 20261102000200: sem documento do afiliado, o split continua.
-- "null is distinct from null" e falso, entao o split sumia quando nem o
-- afiliado nem o comprador tinham documento. So bloqueia quando o
-- documento do afiliado existe e e igual ao do comprador.
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
                 and (f.documento is null or f.documento is distinct from a.documento_cliente)
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
