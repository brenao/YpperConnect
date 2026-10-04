-- =====================================================================
-- Notificacoes por empresa, encerramento pelo solicitante, fechamento
-- automatico em 3 dias uteis e tipo de sistema.
--
-- Regras de produto:
--   - a TI resolve; quem fecha e o solicitante (confirma ou reabre);
--   - sem resposta em 3 dias uteis (calendario da empresa), fecha sozinho;
--   - sistema ganha tipo (aplicacao/infraestrutura).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fila de e-mails (origem: db/postgres/01-schema.sql), por empresa
-- ---------------------------------------------------------------------
create table public.notificacoes (
  id                  uuid not null default app.uuid_v7(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  tipo                text not null check (tipo in (
                        'chamado_criado', 'chamado_aberto_confirmacao', 'chamado_atribuido',
                        'chamado_atividade', 'chamado_resolvido', 'chamado_reaberto',
                        'chamado_status', 'projeto_lembrete', 'acesso_solicitado',
                        'acesso_decidido')),
  destinatario_id     uuid,
  destinatario_email  text not null,
  assunto             text not null,
  corpo               text,
  referencia_tipo     text check (referencia_tipo in ('chamado', 'projeto', 'solicitacao_acesso')),
  referencia_id       uuid,
  status              text not null default 'pendente' check (status in ('pendente', 'enviado', 'erro')),
  tentativas          smallint not null default 0,
  erro                text,
  criado_em           timestamptz not null default now(),
  enviado_em          timestamptz,
  constraint pk_notificacoes primary key (id),
  constraint fk_notificacoes_destinatario foreign key (tenant_id, destinatario_id)
    references public.tenant_membros (tenant_id, usuario_id)
);
create index ix_notificacoes_fila on public.notificacoes (status, tentativas, criado_em);
create index ix_notificacoes_tenant on public.notificacoes (tenant_id, criado_em desc);

revoke all on public.notificacoes from anon;
alter table public.notificacoes enable row level security;

-- Quem age no sistema enfileira o aviso; so o administrador ve a fila.
-- O envio (marcar enviada/erro) e rotina do servidor, com a chave de servico.
create policy notificacoes_incluir on public.notificacoes for insert to authenticated
  with check (tenant_id in (select app.tenants_do_usuario()));
create policy notificacoes_ler on public.notificacoes for select to authenticated
  using (app.tem_permissao(tenant_id, 'admin.usuarios'));

-- ---------------------------------------------------------------------
-- 2. Dias uteis pelo calendario da empresa (localidade padrao)
-- ---------------------------------------------------------------------
create or replace function app.dias_uteis_entre(p_tenant uuid, p_de date, p_ate date)
returns integer
language sql stable security definer set search_path = '' as $$
  with padrao as (
    select id from public.localidades where tenant_id = p_tenant and padrao
  )
  select count(*)::int
    from generate_series(p_de + 1, p_ate, interval '1 day') as g(dia)
   where exists (select 1 from public.expediente e
                  where e.tenant_id = p_tenant and e.ativo
                    and e.localidade_id = (select id from padrao)
                    and e.dia_semana = extract(isodow from g.dia))
     and not exists (select 1 from public.feriados f
                      where f.tenant_id = p_tenant and f.ativo and f.excluido_em is null
                        and (f.localidade_id is null or f.localidade_id = (select id from padrao))
                        and ((f.recorrente and f.mes = extract(month from g.dia)
                                           and f.dia = extract(day from g.dia))
                             or (not f.recorrente and f.data = g.dia::date)))
$$;

revoke all on function app.dias_uteis_entre(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Solicitante confirma a solucao (fecha) ou reabre (com motivo)
-- ---------------------------------------------------------------------
create or replace function public.confirmar_solucao(p_id uuid, p_aceita boolean, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  select id, tenant_id, solicitante_id, status into c
    from public.chamados
   where id = p_id and excluido_em is null;

  if c.id is null or c.tenant_id not in (select app.tenants_do_usuario()) then
    raise exception 'Chamado nao encontrado.' using errcode = 'P0002';
  end if;
  if c.solicitante_id is distinct from auth.uid() then
    raise exception 'Somente quem abriu o chamado pode confirmar a solucao.' using errcode = '42501';
  end if;
  if c.status <> 'resolvido' then
    raise exception 'O chamado nao esta aguardando confirmacao.' using errcode = 'P0001';
  end if;

  if p_aceita then
    update public.chamados set status = 'fechado', fechado_em = now() where id = p_id;
    insert into public.chamado_historico (tenant_id, chamado_id, autor_id, campo, valor_anterior, valor_novo)
    values (c.tenant_id, p_id, auth.uid(), 'status', 'resolvido', 'fechado'),
           (c.tenant_id, p_id, auth.uid(), 'confirmacao', null, 'Solução confirmada pelo solicitante');
  else
    if coalesce(trim(p_motivo), '') = '' then
      raise exception 'Informe o motivo da reabertura.' using errcode = 'P0001';
    end if;
    update public.chamados set status = 'em_andamento', resolvido_em = null where id = p_id;
    insert into public.chamado_interacoes (tenant_id, chamado_id, autor_id, tipo, corpo)
    values (c.tenant_id, p_id, auth.uid(), 'comentario', 'Reaberto pelo solicitante: ' || trim(p_motivo));
    insert into public.chamado_historico (tenant_id, chamado_id, autor_id, campo, valor_anterior, valor_novo)
    values (c.tenant_id, p_id, auth.uid(), 'status', 'resolvido', 'em_andamento'),
           (c.tenant_id, p_id, auth.uid(), 'reabertura', null, trim(p_motivo));
  end if;
end $$;

revoke all on function public.confirmar_solucao(uuid, boolean, text) from public, anon;
grant execute on function public.confirmar_solucao(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Fechamento automatico: resolvido ha 3 dias uteis sem confirmacao
-- ---------------------------------------------------------------------
create or replace function public.fechar_chamados_resolvidos()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_total integer := 0;
begin
  for c in
    select ch.id, ch.tenant_id, ch.resolvido_em, app.fuso_empresa(ch.tenant_id) as tz
      from public.chamados ch
      join public.tenants t on t.id = ch.tenant_id and t.ativo
     where ch.status = 'resolvido' and ch.excluido_em is null and ch.resolvido_em is not null
  loop
    if app.dias_uteis_entre(c.tenant_id,
                            (c.resolvido_em at time zone c.tz)::date,
                            (now() at time zone c.tz)::date) >= 3 then
      update public.chamados set status = 'fechado', fechado_em = now() where id = c.id;
      insert into public.chamado_historico
        (tenant_id, chamado_id, autor_id, campo, valor_anterior, valor_novo)
      values (c.tenant_id, c.id, null, 'status', 'resolvido', 'fechado'),
             (c.tenant_id, c.id, null, 'fechamento_automatico', null,
              'Fechado automaticamente: 3 dias úteis sem confirmação do solicitante');
      v_total := v_total + 1;
    end if;
  end loop;
  return v_total;
end $$;

revoke all on function public.fechar_chamados_resolvidos() from public, anon, authenticated;

-- Agenda a cada hora, no proprio banco (pg_cron do Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('fechar-chamados-resolvidos', '15 * * * *',
                          'select public.fechar_chamados_resolvidos()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Tipo de sistema: aplicacao ou infraestrutura
-- ---------------------------------------------------------------------
alter table public.sistemas
  add column tipo text not null default 'aplicacao' check (tipo in ('aplicacao', 'infraestrutura'));

update public.sistemas s set tipo = 'infraestrutura'
  from public.categorias c
 where c.tenant_id = s.tenant_id and c.id = s.categoria_id and c.nome = 'Infraestrutura';

-- "Estacoes de trabalho" e servico do catalogo, nao sistema: sai da carga
-- inicial. Nas empresas que ja existem, sai por exclusao logica se
-- nenhum chamado o usa.
update public.sistemas s set excluido_em = now(), ativo = false
 where s.nome = 'Estações de trabalho' and s.excluido_em is null
   and not exists (select 1 from public.chamados c where c.sistema_id = s.id);

create or replace function app.criar_catalogo_inicial(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.servicos where tenant_id = p_tenant)
     or exists (select 1 from public.sistemas where tenant_id = p_tenant) then
    return;
  end if;

  insert into public.servicos
    (tenant_id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id)
  select p_tenant, v.nome,
         (select id from public.categorias
           where tenant_id = p_tenant and escopo = 'servico' and nome = v.categoria),
         v.descricao, v.tipo, v.sla,
         (select id from public.equipes where tenant_id = p_tenant and nome = v.equipe)
    from (values
      ('Acesso a sistemas', 'Acessos',
       'Criação, alteração e revogação de acessos a sistemas corporativos.',
       'requisicao', 24, 'Service Desk'),
      ('Estação de trabalho', 'Infraestrutura',
       'Instalação, configuração e manutenção de computadores e periféricos.',
       'requisicao', 24, 'Service Desk'),
      ('Rede e conectividade', 'Infraestrutura',
       'Links, switches, Wi-Fi e conectividade entre unidades.',
       'incidente', 8, 'Infraestrutura'),
      ('Sistemas corporativos', 'Sistemas',
       'Suporte funcional e técnico aos sistemas de negócio.',
       'incidente', 4, 'Sistemas'),
      ('E-mail e colaboração', 'Sistemas',
       'Caixas postais, listas de distribuição e ferramentas de colaboração.',
       'requisicao', 24, 'Service Desk'),
      ('Relatórios e indicadores', 'Sistemas',
       'Extrações, painéis e relatórios gerenciais.',
       'melhoria', 72, 'Sistemas')
    ) as v(nome, categoria, descricao, tipo, sla, equipe);

  insert into public.sistemas (tenant_id, nome, tipo, categoria_id, equipe_id, criticidade)
  select p_tenant, v.nome, v.tipo,
         (select id from public.categorias
           where tenant_id = p_tenant and escopo = 'sistema' and nome = v.categoria),
         (select id from public.equipes where tenant_id = p_tenant and nome = v.equipe),
         v.criticidade
    from (values
      ('ERP', 'aplicacao', 'Aplicações', 'Sistemas', 'alta'),
      ('Portal do Colaborador', 'aplicacao', 'Aplicações', 'Service Desk', 'media'),
      ('Active Directory', 'infraestrutura', 'Infraestrutura', 'Infraestrutura', 'alta'),
      ('E-mail corporativo', 'infraestrutura', 'Infraestrutura', 'Service Desk', 'alta'),
      ('Rede e Wi-Fi', 'infraestrutura', 'Infraestrutura', 'Infraestrutura', 'alta')
    ) as v(nome, tipo, categoria, equipe, criticidade)
  on conflict do nothing;
end $$;

revoke all on function app.criar_catalogo_inicial(uuid) from public, anon, authenticated;