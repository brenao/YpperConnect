-- Comercial: planos, usuarios pagantes, valor, acesso e comissoes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(10);

-- "Hoje" no fuso do produto (o Supabase roda em UTC).
create temp table hoje as select (now() at time zone 'America/Sao_Paulo')::date as d;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a1', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000001a2', 'caio@alfa.com'),
  ('00000000-0000-0000-0000-0000000001a3', 'dani@alfa.com'),
  ('00000000-0000-0000-0000-0000000001a4', 'afi@parceiro.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa16', '00000000-0000-0000-0000-0000000001a1') as alfa;
grant select on t to authenticated;

-- Caio: usuario final (gratis). Dani: agente com equipe (pagante).
insert into public.tenant_membros (tenant_id, usuario_id, tipo, perfil_id)
select alfa, '00000000-0000-0000-0000-0000000001a2', 'interno',
       (select id from public.perfis_acesso where tenant_id = t.alfa and nome = 'Usuário final') from t;
insert into public.tenant_membros (tenant_id, usuario_id, tipo, equipe_id)
select alfa, '00000000-0000-0000-0000-0000000001a3', 'interno',
       (select id from public.equipes where tenant_id = t.alfa limit 1) from t;

create temp table s as select public.situacao_assinatura((select alfa from t)) as j;

-- 1
select is((select j->>'status' || '|' || (j->>'acesso') from s), 'teste|total',
          'Empresa nova nasce em teste, com acesso total');

-- 2
select is((select (j->'modulos')::text || '|' || (j->>'ia') from s), '["itsm", "projetos"]|true',
          'Teste da Suite Pro libera ITSM, Projetos e IA');

-- 3
select is(public.usuarios_pagantes((select alfa from t)), 2,
          'Pagantes: admin e agente; usuario final nao conta');

update public.assinaturas a set plano_codigo = 'itsm_essencial', usuarios_contratados = 5,
       addon_ia = true, status = 'ativa' from t where a.tenant_id = t.alfa;

-- 4
select is(public.valor_mensal_assinatura((select a.id from public.assinaturas a, t where a.tenant_id = t.alfa)),
          52000, 'ITSM Essencial anual, 5 usuarios + IA: 5 x (65 + 39) = R$ 520');

update public.assinaturas a set plano_codigo = 'itsm_pro' from t where a.tenant_id = t.alfa;

-- 5
select is(public.valor_mensal_assinatura((select a.id from public.assinaturas a, t where a.tenant_id = t.alfa)),
          49500, 'No Pro a IA ja esta inclusa: 5 x 99 = R$ 495');

update public.assinaturas a set status = 'teste', teste_ate = (select d from hoje) - 1 from t where a.tenant_id = t.alfa;

-- 6
select is(public.situacao_assinatura((select alfa from t))->>'acesso', 'bloqueado',
          'Teste vencido bloqueia o acesso');

-- Afiliado: 20% por 12 meses
insert into public.afiliados (id, usuario_id, codigo, nome, email)
values ('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-0000000001a4',
        'parceiro-x', 'Parceiro X', 'afi@parceiro.com');
update public.assinaturas a set status = 'ativa', afiliado_id = '00000000-0000-0000-0000-0000000001f1',
       atribuido_em = now() from t where a.tenant_id = t.alfa;

insert into public.faturas (id, tenant_id, assinatura_id, competencia, valor_centavos, vencimento, status, pago_em)
select '00000000-0000-0000-0000-0000000001b1', t.alfa, a.id, (select d from hoje), 49500, (select d from hoje), 'paga', now()
  from public.assinaturas a, t where a.tenant_id = t.alfa;
select app.gerar_comissao('00000000-0000-0000-0000-0000000001b1');

-- 7
select is((select valor_centavos || '|' || status || '|' || (liberar_em - (select d from hoje))
             from public.comissoes), '9900|prevista|30',
          'Fatura paga gera comissao de 20%, liberada em 30 dias');

insert into public.faturas (id, tenant_id, assinatura_id, competencia, valor_centavos, vencimento, status, pago_em)
select '00000000-0000-0000-0000-0000000001b2', t.alfa, a.id, (select d from hoje) + 400, 49500, (select d from hoje) + 400, 'paga', now()
  from public.assinaturas a, t where a.tenant_id = t.alfa;
select app.gerar_comissao('00000000-0000-0000-0000-0000000001b2');

-- 8
select is((select count(*) from public.comissoes)::int, 1,
          'Depois dos 12 meses de recorrencia, nao gera comissao');

set local role authenticated;

-- Caio (usuario final) nao ve a assinatura; Ana (admin) ve
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000001a2","role":"authenticated"}', true);
-- 9
select is_empty($$select 1 from public.assinaturas$$, 'Usuario final nao ve a assinatura');

-- Afiliado ve so a propria comissao
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000001a4","role":"authenticated"}', true);
-- 10
select is((select count(*) from public.comissoes)::int, 1, 'Afiliado ve a propria comissao');

select * from finish();
rollback;