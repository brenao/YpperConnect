-- Comercial (CM2): somente leitura e limite de usuarios pagantes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000002a1', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000002a2', 'b@alfa.com'),
  ('00000000-0000-0000-0000-0000000002a3', 'c@alfa.com'),
  ('00000000-0000-0000-0000-0000000002a4', 'd@alfa.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa17', '00000000-0000-0000-0000-0000000002a1') as alfa;
grant select on t to authenticated;

-- Teste: 3 contratados. Admin + 2 agentes cabem; o 3o agente nao.
insert into public.tenant_membros (tenant_id, usuario_id, tipo, equipe_id)
select alfa, u, 'interno', (select id from public.equipes where tenant_id = t.alfa limit 1)
  from t, unnest(array['00000000-0000-0000-0000-0000000002a2',
                       '00000000-0000-0000-0000-0000000002a3']::uuid[]) as u;

-- 1
select is(public.usuarios_pagantes((select alfa from t)), 3, 'Admin + 2 agentes = 3 pagantes');

-- 2
select throws_like(
  format($$insert into public.tenant_membros (tenant_id, usuario_id, tipo, equipe_id)
           values (%L, '00000000-0000-0000-0000-0000000002a4', 'interno',
                   (select id from public.equipes where tenant_id = %L limit 1))$$,
         (select alfa from t), (select alfa from t)),
  '%Limite de usuarios pagantes%', 'Quarto pagante e recusado (limite do plano)');

-- 3
select lives_ok(
  format($$insert into public.tenant_membros (tenant_id, usuario_id, tipo)
           values (%L, '00000000-0000-0000-0000-0000000002a4', 'interno')$$, (select alfa from t)),
  'Usuario final (gratis) entra sem limite');

update public.assinaturas a set status = 'somente_leitura' from t where a.tenant_id = t.alfa;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}', true);

-- 4
select throws_ok(
  format($$insert into public.equipes (tenant_id, nome) values (%L, 'Nova')$$, (select alfa from t)),
  '42501', null, 'Somente leitura: banco recusa gravacao');

-- 5
select ok((select count(*) from public.equipes) > 0, 'Somente leitura: leitura continua');

reset role;
update public.assinaturas a set status = 'ativa' from t where a.tenant_id = t.alfa;
set local role authenticated;

-- 6
select lives_ok(
  format($$insert into public.equipes (tenant_id, nome) values (%L, 'Nova')$$, (select alfa from t)),
  'Regularizada: grava de novo');

select * from finish();
rollback;