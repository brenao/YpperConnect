-- =====================================================================
-- Comercial (CM5): portal do afiliado
--
-- O afiliado e uma pessoa com login, sem precisar pertencer a empresa
-- alguma. Ve so os proprios numeros; das empresas indicadas, so o nome
-- e a situacao (nada de dados internos delas).
-- =====================================================================

create or replace function public.sou_afiliado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.afiliados
                  where usuario_id = auth.uid() and ativo)
$$;

create or replace function public.meu_portal_afiliado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f record;
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
    'meses_recorrencia', f.meses_recorrencia,
    'cliques_30d', (select count(*) from public.indicacoes
                     where afiliado_id = f.id and criado_em >= now() - interval '30 days'),
    'cliques_total', (select count(*) from public.indicacoes where afiliado_id = f.id),
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empresa', t.nome,
               'status', a.status,
               'desde', (a.atribuido_em at time zone 'America/Sao_Paulo')::date)
             order by a.atribuido_em desc)
        from public.assinaturas a join public.tenants t on t.id = a.tenant_id
       where a.afiliado_id = f.id), '[]'::jsonb),
    'totais', jsonb_build_object(
      'prevista', (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status = 'prevista'),
      'liberada', (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status = 'liberada'),
      'paga',     (select coalesce(sum(valor_centavos), 0) from public.comissoes
                    where afiliado_id = f.id and status = 'paga')),
    'comissoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empresa', t.nome,
               'valor_centavos', c.valor_centavos,
               'status', c.status,
               'competencia', fa.competencia,
               'liberar_em', c.liberar_em,
               'pago_em', (c.pago_em at time zone 'America/Sao_Paulo')::date)
             order by c.criado_em desc)
        from public.comissoes c
        join public.faturas fa on fa.id = c.fatura_id
        join public.tenants t on t.id = fa.tenant_id
       where c.afiliado_id = f.id), '[]'::jsonb));
end $$;

-- Operador liga o cadastro do afiliado a uma conta de login.
create or replace function public.vincular_conta_afiliado(p_codigo text, p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin_plataforma();
  update public.afiliados set usuario_id = p_usuario where codigo = lower(p_codigo);
  if not found then
    raise exception 'Afiliado nao encontrado.' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.sou_afiliado(), public.meu_portal_afiliado(),
  public.vincular_conta_afiliado(text, uuid) from public, anon;
grant execute on function public.sou_afiliado(), public.meu_portal_afiliado(),
  public.vincular_conta_afiliado(text, uuid) to authenticated;