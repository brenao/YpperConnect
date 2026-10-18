-- =====================================================================
-- Departamentos por empresa e perfil pela combinacao departamento + cargo
--
-- Regras de produto:
--   - login so por e-mail: o login de rede sai da tela (a coluna fica,
--     sem unicidade, para uma futura integracao com AD);
--   - departamento e cadastro da empresa, com a marca "e TI";
--   - o administrador escolhe o CARGO (analista, gerente de projetos,
--     gestor/diretoria) e o departamento decide o perfil:
--       analista            + TI -> Analista de TI   | outro -> Usuario final
--       gerente de projetos + TI -> Gerente de Projetos de TI | outro -> Gerente de Projetos
--       gestor/diretoria    -> Gestor / Diretoria (igual nos dois)
--   - equipe de TI so para quem e do departamento TI;
--   - administrador do sistema continua uma chave a parte e passa a ter
--     o acesso do perfil Administrador de TI, qualquer que seja o cargo.
--
-- tenant_membros.departamento (texto) continua, preenchido pelo banco a
-- partir do cadastro: telas e consultas que ja o leem nao mudam.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cadastro de departamentos
-- ---------------------------------------------------------------------
create table public.departamentos (
  id             uuid not null default app.uuid_v7(),
  tenant_id      uuid not null default app.tenant_corrente()
                 references public.tenants (id) on delete cascade,
  nome           text not null check (length(trim(nome)) between 2 and 80),
  ti             boolean not null default false,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  excluido_em    timestamptz,
  excluido_por   uuid,
  constraint pk_departamentos primary key (id),
  constraint uq_departamentos_tenant_id unique (tenant_id, id)
);

-- Nome unico entre os nao excluidos: o de um excluido pode voltar.
create unique index ux_departamentos_nome
  on public.departamentos (tenant_id, lower(nome)) where excluido_em is null;

create trigger tg_departamentos_atualizado before update on public.departamentos
  for each row execute function app.tocar_atualizado_em();
create trigger tg_departamentos_auditoria after insert or update on public.departamentos
  for each row execute function app.auditar();
create trigger tg_departamentos_sem_exclusao_fisica before delete on public.departamentos
  for each row execute function app.bloquear_exclusao_fisica();

revoke all on public.departamentos from anon;
alter table public.departamentos enable row level security;

create policy departamentos_ler on public.departamentos for select to authenticated
  using (tenant_id in (select app.tenants_do_usuario()) and excluido_em is null);
create policy departamentos_incluir on public.departamentos for insert to authenticated
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));
create policy departamentos_alterar on public.departamentos for update to authenticated
  using (app.tem_permissao(tenant_id, 'cadastro.gerenciar'))
  with check (app.tem_permissao(tenant_id, 'cadastro.gerenciar'));

-- As mesmas restritivas das outras tabelas da empresa (adaptador e plano).
create policy departamentos_empresa_da_sessao on public.departamentos
  as restrictive for all to authenticated
  using (app.tenant_corrente() is null or tenant_id = app.tenant_corrente())
  with check (app.tenant_corrente() is null or tenant_id = app.tenant_corrente());
create policy departamentos_plano_incluir on public.departamentos
  as restrictive for insert to authenticated with check (app.escrita_liberada(tenant_id));
create policy departamentos_plano_alterar on public.departamentos
  as restrictive for update to authenticated using (app.escrita_liberada(tenant_id));
create policy departamentos_plano_excluir on public.departamentos
  as restrictive for delete to authenticated using (app.escrita_liberada(tenant_id));

-- Lista inicial de toda empresa nova (e das que ja existem, abaixo).
create or replace function app.criar_departamentos_padrao(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.departamentos (tenant_id, nome, ti)
  select p_tenant, v.nome, v.ti
    from (values ('TI', true), ('Financeiro', false), ('Recursos Humanos', false),
                 ('Comercial', false), ('Operações', false), ('Jurídico', false),
                 ('Diretoria', false)) as v(nome, ti)
   where not exists (select 1 from public.departamentos d
                      where d.tenant_id = p_tenant and lower(d.nome) = lower(v.nome)
                        and d.excluido_em is null);
$$;
revoke all on function app.criar_departamentos_padrao(uuid) from public, anon, authenticated;

-- Os cadastros iniciais de empresa nova passam a incluir os departamentos.
create or replace function app.criar_cadastros_iniciais(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.equipes (tenant_id, nome)
  values (p_tenant, 'Service Desk'), (p_tenant, 'Infraestrutura'), (p_tenant, 'Sistemas')
  on conflict do nothing;

  insert into public.categorias (tenant_id, nome, escopo) values
    (p_tenant, 'Acessos', 'servico'), (p_tenant, 'Infraestrutura', 'servico'),
    (p_tenant, 'Sistemas', 'servico'), (p_tenant, 'Acessos', 'chamado'),
    (p_tenant, 'Infraestrutura', 'chamado'), (p_tenant, 'Sistemas', 'chamado'),
    (p_tenant, 'Aplicações', 'sistema'), (p_tenant, 'Infraestrutura', 'sistema'),
    (p_tenant, 'Procedimentos', 'artigo'), (p_tenant, 'Soluções', 'artigo')
  on conflict do nothing;

  select app.criar_departamentos_padrao(p_tenant);
$$;
revoke all on function app.criar_cadastros_iniciais(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Membros: departamento do cadastro (o texto livre vira cadastro)
-- ---------------------------------------------------------------------
alter table public.tenant_membros
  add column departamento_id uuid,
  add constraint fk_membros_departamento foreign key (tenant_id, departamento_id)
    references public.departamentos (tenant_id, id);
create index ix_membros_departamento on public.tenant_membros (tenant_id, departamento_id);

-- Login de rede deixa de identificar a pessoa: sem unicidade. Com ela, o
-- ingresso por dominio (que grava a parte antes do @) falhava calado
-- para joao@a.com e joao@b.com na mesma empresa.
alter table public.tenant_membros drop constraint uq_membros_login;

-- Texto que ja existia vira departamento da empresa.
insert into public.departamentos (tenant_id, nome, ti)
select distinct on (m.tenant_id, lower(trim(m.departamento)))
       m.tenant_id, trim(m.departamento),
       lower(trim(m.departamento)) in ('ti', 't.i.', 't.i', 'tecnologia', 'tecnologia da informação',
                                       'tecnologia da informacao', 'informática', 'informatica')
  from public.tenant_membros m
 where length(trim(coalesce(m.departamento, ''))) >= 2
 order by m.tenant_id, lower(trim(m.departamento)), m.departamento
on conflict (tenant_id, lower(nome)) where excluido_em is null do nothing;

do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.criar_departamentos_padrao(t);
  end loop;
end $$;

update public.tenant_membros m
   set departamento_id = d.id
  from public.departamentos d
 where d.tenant_id = m.tenant_id and d.excluido_em is null
   and lower(d.nome) = lower(trim(m.departamento));

-- Daqui em diante o banco cuida da coerencia (criado DEPOIS da carga
-- acima, para nao tirar equipe de quem ja tinha).
create or replace function app.membro_departamento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_ti   boolean;
begin
  if new.departamento_id is null then
    if tg_op = 'UPDATE' and old.departamento_id is not null then
      new.departamento := null;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.departamento_id is not distinct from old.departamento_id
     and new.equipe_id is not distinct from old.equipe_id then
    return new;
  end if;

  select nome, ti into v_nome, v_ti
    from public.departamentos
   where tenant_id = new.tenant_id and id = new.departamento_id;
  new.departamento := v_nome;

  if not v_ti and new.equipe_id is not null then
    -- Mudou para departamento fora da TI: sai da equipe. Pedir equipe
    -- para quem continua fora da TI e erro de quem chamou.
    if tg_op = 'UPDATE' and new.departamento_id is not distinct from old.departamento_id then
      raise exception 'Equipe de TI é só para quem é do departamento de TI.'
        using errcode = 'P0001';
    end if;
    new.equipe_id := null;
  end if;
  return new;
end $$;

-- Nome antes de tg_tenant_membros_limite: o limite de pagantes ve a
-- equipe ja ajustada.
create trigger tg_tenant_membros_departamento before insert or update on public.tenant_membros
  for each row execute function app.membro_departamento();

-- Renomear o departamento atualiza o texto dos membros; tirar a marca de
-- TI com gente de equipe nele e recusado (a pessoa perderia a equipe sem
-- ninguem decidir).
create or replace function app.departamento_alterado() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_com_equipe integer;
begin
  if old.ti and not new.ti then
    select count(*) into v_com_equipe
      from public.tenant_membros
     where tenant_id = new.tenant_id and departamento_id = new.id
       and ativo and equipe_id is not null;
    if v_com_equipe > 0 then
      raise exception 'Há % pessoa(s) com equipe de TI neste departamento. Tire a equipe delas antes.',
        v_com_equipe using errcode = 'P0001';
    end if;
  end if;

  if new.nome is distinct from old.nome then
    update public.tenant_membros
       set departamento = new.nome
     where tenant_id = new.tenant_id and departamento_id = new.id;
  end if;
  return new;
end $$;

create trigger tg_departamentos_alterado after update on public.departamentos
  for each row execute function app.departamento_alterado();

-- Exclusao logica, com a contagem de quem esta no departamento antes.
create or replace function public.vinculos_departamento(p_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.departamentos where id = p_id and excluido_em is null;
  if v_tenant is null or not app.tem_permissao(v_tenant, 'cadastro.gerenciar') then
    raise exception 'Departamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  return (select count(*)::int from public.tenant_membros
           where tenant_id = v_tenant and departamento_id = p_id and ativo);
end $$;

create or replace function public.excluir_departamento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.departamentos where id = p_id and excluido_em is null;
  if v_tenant is null or not app.tem_permissao(v_tenant, 'cadastro.gerenciar') then
    raise exception 'Departamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if not app.escrita_liberada(v_tenant) then
    raise exception 'A assinatura desta empresa não permite alterações.' using errcode = '42501';
  end if;
  -- As pessoas continuam apontando para ele: o historico nao se perde.
  update public.departamentos
     set excluido_em = now(), excluido_por = auth.uid(), ativo = false
   where id = p_id;
end $$;

revoke all on function public.vinculos_departamento(uuid) from public, anon;
revoke all on function public.excluir_departamento(uuid) from public, anon;
grant execute on function public.vinculos_departamento(uuid) to authenticated;
grant execute on function public.excluir_departamento(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Perfis com cargo e area
-- ---------------------------------------------------------------------
alter table public.perfis_acesso
  add column cargo text check (cargo in ('administrador', 'analista', 'gerente_projetos', 'diretoria')),
  add column area  text check (area in ('ti', 'negocio'));

create unique index ux_perfis_cargo_area
  on public.perfis_acesso (tenant_id, cargo, coalesce(area, '*')) where cargo is not null;

create or replace function app.criar_perfis_padrao(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_perfil uuid;
begin
  for r in
    select * from (values
      ('Administrador de TI', 'administrador', 'ti',
       'Acesso total ao sistema, incluindo cadastros administrativos e perfis de acesso.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente','/projetos','/recursos',
             '/diretoria','/governanca','/administracao','/permissoes'],
       array['chamado.criar','chamado.editar','chamado.problema','conhecimento.editar',
             'catalogo.editar','projeto.criar','projeto.editar','recurso.editar',
             'admin.usuarios','admin.sistemas','admin.permissoes','projetos.coach']),
      ('Analista de TI', 'analista', 'ti',
       'Atende chamados, gerencia problemas, projetos e a base de conhecimento.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente','/projetos','/recursos',
             '/governanca'],
       array['chamado.criar','chamado.editar','chamado.problema','conhecimento.editar',
             'projeto.criar','projeto.editar','recurso.editar','projetos.coach']),
      ('Gerente de Projetos de TI', 'gerente_projetos', 'ti',
       'Conduz os projetos de TI: cronograma, recursos e acompanhamento dos chamados.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente','/projetos','/recursos',
             '/governanca'],
       array['chamado.criar','chamado.editar','projeto.criar','projeto.editar','recurso.editar',
             'projetos.portfolio','projetos.coach']),
      ('Gerente de Projetos', 'gerente_projetos', 'negocio',
       'Cria e gerencia os projetos da própria área e abre chamados.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente','/projetos'],
       array['chamado.criar','projeto.criar','projeto.editar','projetos.coach']),
      ('Gestor / Diretoria', 'diretoria', null,
       'Visualiza indicadores executivos de projetos e atendimento.',
       array['/','/chamados','/conhecimento','/projetos','/recursos','/diretoria','/governanca'],
       array['chamado.criar','projetos.coach']),
      ('Usuário final', 'analista', 'negocio',
       'Abre chamados pelo catálogo e consulta a base de conhecimento. Não cria problemas.',
       array['/','/chamados','/catalogo','/conhecimento','/assistente'],
       array['chamado.criar','projetos.coach'])
    ) as v(nome, cargo, area, descricao, modulos, features)
  loop
    insert into public.perfis_acesso (tenant_id, nome, descricao, sistema, cargo, area)
    values (p_tenant, r.nome, r.descricao, true, r.cargo, r.area)
    on conflict (tenant_id, nome) do nothing
    returning id into v_perfil;

    if v_perfil is null then
      -- Ja existia: so marca cargo e area (as permissoes sao da empresa).
      update public.perfis_acesso
         set cargo = r.cargo, area = r.area
       where tenant_id = p_tenant and nome = r.nome and sistema and cargo is null;
      continue;
    end if;

    insert into public.perfil_modulos (tenant_id, perfil_id, modulo_key)
    select p_tenant, v_perfil, m from unnest(r.modulos) as m;

    insert into public.perfil_features (tenant_id, perfil_id, feature_key)
    select p_tenant, v_perfil, f from unnest(r.features) as f;
  end loop;
end $$;
revoke all on function app.criar_perfis_padrao(uuid) from public, anon, authenticated;

do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform app.criar_perfis_padrao(t);
  end loop;
end $$;

-- Perfil da combinacao departamento + cargo (a tela so escolhe os dois).
create or replace function public.perfil_do_cargo(p_departamento uuid, p_cargo text) returns uuid
language sql stable security invoker set search_path = '' as $$
  select p.id
    from public.perfis_acesso p
    join public.departamentos d on d.id = p_departamento and d.tenant_id = p.tenant_id
   where p.cargo = p_cargo and p.ativo
     and (p.area is null or p.area = case when d.ti then 'ti' else 'negocio' end)
   order by p.area nulls last
   limit 1
$$;
revoke all on function public.perfil_do_cargo(uuid, text) from public, anon;
grant execute on function public.perfil_do_cargo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Administrador = acesso do perfil Administrador de TI + o do cargo
-- ---------------------------------------------------------------------
create or replace function public.meu_acesso(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'admin',           m.admin,
    'perfil_id',       m.perfil_id,
    'equipe_id',       m.equipe_id,
    'login',           m.login,
    'departamento',    m.departamento,
    'departamento_id', m.departamento_id,
    'modulos',         coalesce((select jsonb_agg(distinct pm.modulo_key)
                                   from public.perfil_modulos pm
                                   join public.perfis_acesso p on p.id = pm.perfil_id and p.ativo
                                  where pm.perfil_id = m.perfil_id
                                     or (m.admin and p.tenant_id = m.tenant_id
                                         and p.cargo = 'administrador')), '[]'::jsonb),
    'funcionalidades', coalesce((select jsonb_agg(distinct pf.feature_key)
                                   from public.perfil_features pf
                                   join public.perfis_acesso p on p.id = pf.perfil_id and p.ativo
                                  where pf.perfil_id = m.perfil_id
                                     or (m.admin and p.tenant_id = m.tenant_id
                                         and p.cargo = 'administrador')), '[]'::jsonb))
    from public.tenant_membros m
   where m.tenant_id = p_tenant and m.usuario_id = auth.uid() and m.ativo
$$;
revoke all on function public.meu_acesso(uuid) from public, anon;
grant execute on function public.meu_acesso(uuid) to authenticated;