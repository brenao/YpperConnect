-- =====================================================================
-- Comercial (CM2): o plano manda no acesso
--
--   1. Somente leitura / suspensao / teste vencido: o banco recusa
--      gravacoes da empresa (vale para tela, adaptador e API).
--   2. Limite de usuarios pagantes: ninguem vira pagante alem do contratado.
-- Assinaturas e faturas ficam de fora do bloqueio: e por elas que a
-- plataforma regulariza a empresa.
-- =====================================================================

create or replace function app.escrita_liberada(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select a.cortesia
        or a.status in ('ativa', 'inadimplente')
        or (a.status = 'teste' and a.teste_ate >= (now() at time zone 'America/Sao_Paulo')::date)
      from public.assinaturas a
     where a.tenant_id = p_tenant and a.status <> 'cancelada'), false)
$$;
grant execute on function app.escrita_liberada(uuid) to authenticated;

do $$
declare t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'tenant_id'
       and tb.table_type = 'BASE TABLE'
       and c.table_name not in ('assinaturas', 'faturas')
  loop
    execute format('create policy %I on public.%I as restrictive for insert to authenticated
                    with check (app.escrita_liberada(tenant_id))', t || '_plano_incluir', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated
                    using (app.escrita_liberada(tenant_id))', t || '_plano_alterar', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated
                    using (app.escrita_liberada(tenant_id))', t || '_plano_excluir', t);
  end loop;
end $$;

-- Limite de usuarios pagantes
create or replace function app.conferir_limite_pagantes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contratados integer;
  v_outros      integer;
begin
  if not app.eh_pagante(new) then return new; end if;
  if tg_op = 'UPDATE' and app.eh_pagante(old) then return new; end if;

  select usuarios_contratados into v_contratados
    from public.assinaturas where tenant_id = new.tenant_id and status <> 'cancelada';
  if v_contratados is null then return new; end if;

  select count(*) into v_outros
    from public.tenant_membros m
   where m.tenant_id = new.tenant_id and m.usuario_id <> new.usuario_id and app.eh_pagante(m);

  if v_outros + 1 > v_contratados then
    raise exception 'Limite de usuarios pagantes do plano atingido (% de %).', v_outros, v_contratados
      using errcode = 'P0001', hint = 'limite_pagantes';
  end if;
  return new;
end $$;

create trigger tg_tenant_membros_limite before insert or update on public.tenant_membros
  for each row execute function app.conferir_limite_pagantes();