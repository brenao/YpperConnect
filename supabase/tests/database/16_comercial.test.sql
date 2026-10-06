-- =====================================================================
-- Comercial (CM1): planos, assinaturas, faturas, afiliados e comissoes
--
-- Regras (backlog de produto):
--   - planos por modulo (itsm, projetos, suite) e nivel (essencial, pro);
--   - preco por usuario pagante/mes; anual e mensal; centavos;
--   - IA inclusa no Pro, add-on no Essencial;
--   - usuario pagante = admin, quem tem equipe (agente) ou quem gere
--     projeto; quem so abre chamado e gratis;
--   - minimo de 3 usuarios pagantes; teste de 14 dias;
--   - afiliado: 20% recorrente por 12 meses (parceiro: 30%), liberada
--     30 dias apos o pagamento do cliente.
-- Tabelas da plataforma: so operadores escrevem. O cliente le a propria
-- assinatura e faturas; o afiliado le os proprios dados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Planos (catalogo da plataforma)
-- ---------------------------------------------------------------------
create table public.planos (
  codigo               text primary key,
  nome                 text not null,
  modulo               text not null check (modulo in ('itsm','projetos','suite')),
  nivel                text not null check (nivel in ('essencial','pro')),
  preco_anual_centavos   integer not null check (preco_anual_centavos >= 0),
  preco_mensal_centavos  integer not null check (preco_mensal_centavos >= 0),
  ia_incluida          boolean not null default false,
  ativo                boolean not null default true,
  ordem                smallint not null default 0
);

insert into public.planos (codigo, nome, modulo, nivel, preco_anual_centavos, preco_mensal_centavos, ia_incluida, ordem) values
  ('itsm_essencial',     'ITSM Essencial',     'itsm',     'essencial',  6500,  7900, false, 1),
  ('itsm_pro',           'ITSM Pro',           'itsm',     'pro',        9900, 11900, true,  2),
  ('projetos_essencial', 'Projetos Essencial', 'projetos', 'essencial',  4900,  5900, false, 3),
  ('projetos_pro',       'Projetos Pro',       'projetos', 'pro',        7900,  9500, true,  4),
  ('suite_essencial',    'Suíte Essencial',    'suite',    'essencial',  8900, 10900, false, 5),
  ('suite_pro',          'Suíte Pro',          'suite',    'pro',       11900, 14500, true,  6);

create table public.planos_addons (
  codigo                 text primary key,
  nome                   text not null,
  preco_anual_centavos   integer not null,
  preco_mensal_centavos  integer not null,
  ativo                  boolean not null default true
);
insert into public.planos_addons values ('ia', 'BeagleOne IA', 3900, 4700, true);

-- ---------------------------------------------------------------------
-- Afiliados
-- ---------------------------------------------------------------------
create table public.afiliados (
  id                 uuid primary key default app.uuid_v7(),
  usuario_id         uuid unique references public.usuarios (id),
  codigo             text not null unique check (codigo ~ '^[a-z0-9-]{3,30}$'),
  nome               text not null,
  email              text not null,
  tipo               text not null default 'afiliado' check (tipo in ('afiliado','parceiro')),
  comissao_pct       numeric(5,2) not null default 20 check (comissao_pct between 0 and 100),
  meses_recorrencia  smallint not null default 12 check (meses_recorrencia between 1 and 120),
  -- Conta do afiliado no gateway (split). Dados bancarios ficam no gateway, nunca aqui.
  gateway_conta_id   text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);

-- Cliques no link de indicacao (atribuicao: ultimo clique em 90 dias)
create table public.indicacoes (
  id           uuid primary key default app.uuid_v7(),
  afiliado_id  uuid not null references public.afiliados (id),
  visitante    text not null,
  origem       text,
  criado_em    timestamptz not null default now()
);
create index ix_indicacoes_visitante on public.indicacoes (visitante, criado_em desc);
create index ix_indicacoes_afiliado on public.indicacoes (afiliado_id, criado_em desc);

-- ---------------------------------------------------------------------
-- Assinaturas (uma vigente por empresa)
-- ---------------------------------------------------------------------
create table public.assinaturas (
  id                     uuid primary key default app.uuid_v7(),
  tenant_id              uuid not null references public.tenants (id) on delete cascade,
  plano_codigo           text not null references public.planos (codigo),
  ciclo                  text not null default 'anual' check (ciclo in ('mensal','anual')),
  usuarios_contratados   integer not null check (usuarios_contratados >= 3),
  addon_ia               boolean not null default false,
  status                 text not null default 'teste'
                         check (status in ('teste','ativa','inadimplente','somente_leitura',
                                           'suspensa','cancelada')),
  cortesia               boolean not null default false,
  teste_ate              date,
  periodo_inicio         date,
  periodo_fim            date,
  inadimplente_desde     date,
  afiliado_id            uuid references public.afiliados (id),
  atribuido_em           timestamptz,
  gateway                text check (gateway in ('asaas','pagarme','stripe')),
  gateway_cliente_id     text,
  gateway_assinatura_id  text,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  cancelada_em           timestamptz
);
create unique index ux_assinatura_vigente on public.assinaturas (tenant_id)
  where status <> 'cancelada';

-- ---------------------------------------------------------------------
-- Faturas, comissoes e eventos do gateway (idempotencia de webhook)
-- ---------------------------------------------------------------------
create table public.faturas (
  id                 uuid primary key default app.uuid_v7(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  assinatura_id      uuid not null references public.assinaturas (id),
  competencia        date not null,
  valor_centavos     integer not null check (valor_centavos >= 0),
  vencimento         date not null,
  status             text not null default 'pendente'
                     check (status in ('pendente','paga','vencida','estornada','cancelada')),
  metodo             text check (metodo in ('pix','boleto','cartao')),
  pago_em            timestamptz,
  gateway_fatura_id  text unique,
  link_pagamento     text,
  criado_em          timestamptz not null default now()
);
create index ix_faturas_tenant on public.faturas (tenant_id, vencimento desc);

create table public.comissoes (
  id               uuid primary key default app.uuid_v7(),
  afiliado_id      uuid not null references public.afiliados (id),
  assinatura_id    uuid not null references public.assinaturas (id),
  fatura_id        uuid not null unique references public.faturas (id),
  valor_centavos   integer not null check (valor_centavos >= 0),
  status           text not null default 'prevista'
                   check (status in ('prevista','liberada','paga','estornada')),
  liberar_em       date,
  pago_em          timestamptz,
  criado_em        timestamptz not null default now()
);
create index ix_comissoes_afiliado on public.comissoes (afiliado_id, status);

create table public.eventos_gateway (
  gateway        text not null,
  evento_id      text not null,
  tipo           text not null,
  payload        jsonb not null,
  recebido_em    timestamptz not null default now(),
  processado_em  timestamptz,
  erro           text,
  primary key (gateway, evento_id)
);

-- ---------------------------------------------------------------------
-- Triggers: atualizado_em, auditoria, sem exclusao fisica
-- ---------------------------------------------------------------------
create trigger tg_assinaturas_atualizado before update on public.assinaturas
  for each row execute function app.tocar_atualizado_em();
do $$
declare t text;
begin
  foreach t in array array['assinaturas','faturas','comissoes','afiliados'] loop
    execute format('create trigger tg_%1$s_auditoria after insert or update on public.%1$I
                    for each row execute function app.auditar()', t);
    execute format('create trigger tg_%1$s_sem_exclusao_fisica before delete on public.%1$I
                    for each row execute function app.bloquear_exclusao_fisica()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Regras como funcoes (usadas pela tela, pelo checkout e pelo bloqueio)
-- ---------------------------------------------------------------------

-- Usuario pagante: admin, agente (tem equipe) ou quem gere projeto.
create or replace function app.eh_pagante(m public.tenant_membros) returns boolean
language sql stable security definer set search_path = '' as $$
  select m.ativo and m.tipo = 'interno' and (
    m.admin or m.equipe_id is not null
    or exists (select 1 from public.perfil_features pf
                where pf.perfil_id = m.perfil_id
                  and pf.feature_key in ('projeto.criar','projeto.editar')))
$$;

create or replace function public.usuarios_pagantes(p_tenant uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tenant_membros m
   where m.tenant_id = p_tenant and app.eh_pagante(m)
$$;

-- Assinatura vigente e o que ela libera.
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
    -- Inadimplencia em degraus: aviso -> 7 dias somente leitura -> suspensao.
    'acesso', case
      when a.status = 'teste' and a.teste_ate < (now() at time zone 'America/Sao_Paulo')::date
        then 'bloqueado'
      when a.status in ('teste','ativa') then 'total'
      when a.status = 'inadimplente' then 'total_com_aviso'
      when a.status = 'somente_leitura' then 'somente_leitura'
      else 'bloqueado' end);
end $$;

-- Valor mensal da assinatura (usuarios contratados x preco + add-on).
create or replace function public.valor_mensal_assinatura(p_assinatura uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (a.usuarios_contratados *
          (case a.ciclo when 'anual' then p.preco_anual_centavos else p.preco_mensal_centavos end
           + case when a.addon_ia and not p.ia_incluida
                  then (select case a.ciclo when 'anual' then preco_anual_centavos
                                            else preco_mensal_centavos end
                          from public.planos_addons where codigo = 'ia')
                  else 0 end))::int
    from public.assinaturas a join public.planos p on p.codigo = a.plano_codigo
   where a.id = p_assinatura
$$;

-- Atribuicao do afiliado: ultimo clique do visitante nos ultimos 90 dias.
create or replace function app.afiliado_do_visitante(p_visitante text) returns uuid
language sql stable security definer set search_path = '' as $$
  select i.afiliado_id from public.indicacoes i
    join public.afiliados f on f.id = i.afiliado_id and f.ativo
   where i.visitante = p_visitante and i.criado_em >= now() - interval '90 days'
   order by i.criado_em desc limit 1
$$;

-- Fatura paga: gera a comissao (se dentro da recorrencia), liberada em 30 dias.
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
  insert into public.comissoes (afiliado_id, assinatura_id, fatura_id, valor_centavos, liberar_em)
  values (af.id, a.id, f.id, round(f.valor_centavos * af.comissao_pct / 100)::int,
          (coalesce(f.pago_em, now()) at time zone 'America/Sao_Paulo')::date + 30)
  on conflict (fatura_id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Empresas existentes: cortesia de Suite Pro (nao sao bloqueadas)
-- ---------------------------------------------------------------------
insert into public.assinaturas (tenant_id, plano_codigo, ciclo, usuarios_contratados, status, cortesia)
select t.id, 'suite_pro', 'anual', 9999, 'ativa', true
  from public.tenants t
 where t.excluido_em is null
   and not exists (select 1 from public.assinaturas a where a.tenant_id = t.id);

-- ---------------------------------------------------------------------
-- Seguranca
-- ---------------------------------------------------------------------
revoke all on public.planos, public.planos_addons, public.afiliados, public.indicacoes,
  public.assinaturas, public.faturas, public.comissoes, public.eventos_gateway from anon;
alter table public.planos          enable row level security;
alter table public.planos_addons   enable row level security;
alter table public.afiliados       enable row level security;
alter table public.indicacoes      enable row level security;
alter table public.assinaturas     enable row level security;
alter table public.faturas         enable row level security;
alter table public.comissoes       enable row level security;
alter table public.eventos_gateway enable row level security;

-- Catalogo de planos: publico para quem esta logado (a pagina de precos
-- publica le pelo servidor).
create policy planos_ler on public.planos for select to authenticated using (true);
create policy addons_ler on public.planos_addons for select to authenticated using (true);

-- Operadores da plataforma: tudo
do $$
declare t text;
begin
  foreach t in array array['planos','planos_addons','afiliados','indicacoes','assinaturas',
                           'faturas','comissoes','eventos_gateway'] loop
    execute format('create policy %1$s_plataforma on public.%1$I for all to authenticated
                    using (app.eh_admin_plataforma()) with check (app.eh_admin_plataforma())', t);
  end loop;
end $$;

-- Cliente: administrador le a propria assinatura e faturas
create policy assinaturas_cliente on public.assinaturas for select to authenticated
  using (app.tem_permissao(tenant_id, 'admin.usuarios'));
create policy faturas_cliente on public.faturas for select to authenticated
  using (app.tem_permissao(tenant_id, 'admin.usuarios'));

-- Afiliado: le o proprio cadastro, cliques e comissoes
create policy afiliados_proprio on public.afiliados for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy indicacoes_proprias on public.indicacoes for select to authenticated
  using (afiliado_id in (select id from public.afiliados where usuario_id = (select auth.uid())));
create policy comissoes_proprias on public.comissoes for select to authenticated
  using (afiliado_id in (select id from public.afiliados where usuario_id = (select auth.uid())));

revoke all on function public.usuarios_pagantes(uuid), public.situacao_assinatura(uuid),
  public.valor_mensal_assinatura(uuid) from public, anon;
grant execute on function public.usuarios_pagantes(uuid), public.situacao_assinatura(uuid),
  public.valor_mensal_assinatura(uuid) to authenticated;
revoke all on function app.afiliado_do_visitante(text), app.gerar_comissao(uuid),
  app.eh_pagante(public.tenant_membros) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Empresa nova nasce em teste: 14 dias de Suite Pro com 3 usuarios.
-- ---------------------------------------------------------------------
create or replace function app.provisionar_tenant(p_nome text, p_slug text, p_dono uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_org    uuid;
  v_email  text;
begin
  insert into public.tenants (nome, slug) values (p_nome, lower(p_slug))
  returning id into v_tenant;

  insert into public.organizacoes (tenant_id, tipo, relacao, nome)
  values (v_tenant, 'empresa', 'interna', p_nome)
  returning id into v_org;

  perform app.criar_perfis_padrao(v_tenant);
  perform app.criar_cadastros_iniciais(v_tenant);
  perform app.criar_catalogo_inicial(v_tenant);
  perform app.criar_calendario_padrao(v_tenant);
  perform app.copiar_feriados_nacionais(v_tenant);
  perform app.criar_configuracoes_padrao(v_tenant);

  insert into public.assinaturas (tenant_id, plano_codigo, ciclo, usuarios_contratados, status, teste_ate)
  values (v_tenant, 'suite_pro', 'anual', 3, 'teste',
          (now() at time zone 'America/Sao_Paulo')::date + 14);

  select email into v_email from public.usuarios where id = p_dono;

  insert into public.tenant_membros
    (tenant_id, usuario_id, tipo, organizacao_id, origem, login, admin, perfil_id)
  values
    (v_tenant, p_dono, 'interno', v_org, 'manual', split_part(v_email, '@', 1), true,
     (select id from public.perfis_acesso where tenant_id = v_tenant and nome = 'Administrador de TI'));

  return v_tenant;
end $$;
revoke all on function app.provisionar_tenant(text, text, uuid) from public, anon, authenticated;