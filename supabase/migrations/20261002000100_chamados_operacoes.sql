-- =====================================================================
-- Chamados (C2): leitura com nomes e operacoes atomicas
--
-- O legado fazia criar/alterar/comentar numa transacao (chamado +
-- historico juntos). Sem transacao pelo cliente do Supabase, cada
-- operacao vira uma funcao do banco: tudo ou nada. Rodam com a sessao
-- de quem chamou (SECURITY INVOKER), entao o RLS vale como sempre.
--
-- As regras de negocio (prioridade pela matriz, prazo pelo calendario,
-- roteamento, quem pode alterar) continuam no repositorio, como no
-- legado. As funcoes so gravam de forma atomica.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Visoes de leitura (respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------
create view public.chamados_v with (security_invoker = true) as
select c.*,
       sv.nome as servico_nome,
       si.nome as sistema_nome,
       us.nome as solicitante_nome,
       ur.nome as responsavel_nome,
       eq.nome as equipe_nome
  from public.chamados c
  left join public.servicos sv on sv.tenant_id = c.tenant_id and sv.id = c.servico_id
  left join public.sistemas si on si.tenant_id = c.tenant_id and si.id = c.sistema_id
  left join public.usuarios us on us.id = c.solicitante_id
  left join public.usuarios ur on ur.id = c.responsavel_id
  left join public.equipes  eq on eq.tenant_id = c.tenant_id and eq.id = c.equipe_id;

create view public.chamado_interacoes_v with (security_invoker = true) as
select i.*, u.nome as autor_nome
  from public.chamado_interacoes i
  left join public.usuarios u on u.id = i.autor_id;

create view public.chamado_historico_v with (security_invoker = true) as
select h.*, u.nome as autor_nome
  from public.chamado_historico h
  left join public.usuarios u on u.id = h.autor_id;

revoke all on public.chamados_v, public.chamado_interacoes_v, public.chamado_historico_v from anon;
grant select on public.chamados_v, public.chamado_interacoes_v, public.chamado_historico_v
  to authenticated;

-- ---------------------------------------------------------------------
-- Abrir chamado: chamado + historico de criacao (+ atribuicao automatica)
-- ---------------------------------------------------------------------
create or replace function public.abrir_chamado(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id     uuid;
  v_numero bigint;
  v_codigo text;
  v_criado timestamptz := coalesce((p->>'criado_em')::timestamptz, now());
begin
  insert into public.chamados
    (tenant_id, prefixo, titulo, descricao, tipo, categoria_id, servico_id, sistema_id,
     impacto, urgencia, prioridade, status, solicitante_id, responsavel_id, equipe_id,
     origem, criado_em, atualizado_em, prazo_resposta, prazo_sla)
  values
    ((p->>'tenant_id')::uuid, p->>'prefixo', p->>'titulo', p->>'descricao', p->>'tipo',
     (p->>'categoria_id')::uuid, (p->>'servico_id')::uuid, (p->>'sistema_id')::uuid,
     p->>'impacto', p->>'urgencia', p->>'prioridade', 'novo',
     (p->>'solicitante_id')::uuid, (p->>'responsavel_id')::uuid, (p->>'equipe_id')::uuid,
     coalesce(p->>'origem', 'portal'), v_criado, v_criado,
     (p->>'prazo_resposta')::timestamptz, (p->>'prazo_sla')::timestamptz)
  returning id, numero, codigo into v_id, v_numero, v_codigo;

  insert into public.chamado_historico
    (tenant_id, chamado_id, autor_id, campo, valor_anterior, valor_novo, criado_em)
  values ((p->>'tenant_id')::uuid, v_id, auth.uid(), 'criacao', null, p->>'resumo_criacao', v_criado);

  -- A atribuicao automatica entra no historico como qualquer outra.
  if p->>'responsavel_id' is not null then
    insert into public.chamado_historico
      (tenant_id, chamado_id, autor_id, campo, valor_anterior, valor_novo, criado_em)
    values ((p->>'tenant_id')::uuid, v_id, auth.uid(), 'responsavel_id', null,
            p->>'responsavel_id', v_criado);
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'codigo', v_codigo);
end $$;

-- ---------------------------------------------------------------------
-- Alterar chamado: so as colunas enviadas + um evento de historico por
-- campo alterado. "Enviada" = chave presente no JSON (nulo limpa o campo).
-- ---------------------------------------------------------------------
create or replace function public.alterar_chamado(p_id uuid, p_campos jsonb, p_eventos jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare v_tenant uuid;
begin
  update public.chamados c set
    status                 = case when p_campos ? 'status' then p_campos->>'status' else c.status end,
    responsavel_id         = case when p_campos ? 'responsavel_id' then (p_campos->>'responsavel_id')::uuid else c.responsavel_id end,
    equipe_id              = case when p_campos ? 'equipe_id' then (p_campos->>'equipe_id')::uuid else c.equipe_id end,
    impacto                = case when p_campos ? 'impacto' then p_campos->>'impacto' else c.impacto end,
    urgencia               = case when p_campos ? 'urgencia' then p_campos->>'urgencia' else c.urgencia end,
    prioridade             = case when p_campos ? 'prioridade' then p_campos->>'prioridade' else c.prioridade end,
    categoria_id           = case when p_campos ? 'categoria_id' then (p_campos->>'categoria_id')::uuid else c.categoria_id end,
    servico_id             = case when p_campos ? 'servico_id' then (p_campos->>'servico_id')::uuid else c.servico_id end,
    sistema_id             = case when p_campos ? 'sistema_id' then (p_campos->>'sistema_id')::uuid else c.sistema_id end,
    problema_vinculado_id  = case when p_campos ? 'problema_vinculado_id' then (p_campos->>'problema_vinculado_id')::uuid else c.problema_vinculado_id end,
    descricao_encerramento = case when p_campos ? 'descricao_encerramento' then p_campos->>'descricao_encerramento' else c.descricao_encerramento end,
    respondido_em          = case when p_campos ? 'respondido_em' then (p_campos->>'respondido_em')::timestamptz else c.respondido_em end,
    resolvido_em           = case when p_campos ? 'resolvido_em' then (p_campos->>'resolvido_em')::timestamptz else c.resolvido_em end,
    fechado_em             = case when p_campos ? 'fechado_em' then (p_campos->>'fechado_em')::timestamptz else c.fechado_em end
  where c.id = p_id
  returning c.tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'Chamado nao encontrado.' using errcode = 'P0002';
  end if;

  insert into public.chamado_historico
    (tenant_id, chamado_id, autor_id, campo, valor_anterior, valor_novo)
  select v_tenant, p_id, auth.uid(), e->>'campo', e->>'de', e->>'para'
    from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb)) as e;
end $$;

-- ---------------------------------------------------------------------
-- Interacao: a primeira resposta publica marca o SLA de resposta.
-- ---------------------------------------------------------------------
create or replace function public.registrar_interacao(p_chamado uuid, p_tipo text, p_corpo text)
returns void
language plpgsql security invoker set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.chamados where id = p_chamado;
  if v_tenant is null then
    raise exception 'Chamado nao encontrado.' using errcode = 'P0002';
  end if;

  insert into public.chamado_interacoes (tenant_id, chamado_id, autor_id, tipo, corpo)
  values (v_tenant, p_chamado, auth.uid(), p_tipo, p_corpo);

  if p_tipo = 'comentario' then
    update public.chamados set respondido_em = now()
     where id = p_chamado and respondido_em is null;
  end if;
end $$;

revoke all on function public.abrir_chamado(jsonb) from public, anon;
revoke all on function public.alterar_chamado(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.registrar_interacao(uuid, text, text) from public, anon;
grant execute on function public.abrir_chamado(jsonb) to authenticated;
grant execute on function public.alterar_chamado(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.registrar_interacao(uuid, text, text) to authenticated;