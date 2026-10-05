-- Adaptador de SQL: empresa da sessao.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000fa', 'ana@alfa.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa15', '00000000-0000-0000-0000-0000000000fa') as alfa,
       app.provisionar_tenant('Beta', 'beta15', '00000000-0000-0000-0000-0000000000fa') as beta;
grant select on t to authenticated;

-- Ana participa das duas empresas
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000fa","role":"authenticated"}', true);

-- Sessao do adaptador na Alfa
select set_config('app.tenant_id', (select alfa::text from t), true);

-- 1
select lives_ok(
  $$insert into public.projetos (nome, inicio, fim) values ('Sem tenant explicito', '2026-01-01', '2026-02-01')$$,
  'Inclusao sem tenant_id recebe a empresa da sessao');

-- 2
select is((select tenant_id from public.projetos where nome = 'Sem tenant explicito'), (select alfa from t),
          'Registro gravado na empresa da sessao');

-- 3
select is((select count(*) from public.equipes)::int, 3,
          'Com a empresa na sessao, ve so as equipes dela (e nao as 6 das duas empresas)');

-- 4
select throws_ok(
  format($$insert into public.projetos (tenant_id, nome, inicio, fim) values (%L, 'X', '2026-01-01', '2026-02-01')$$,
         (select beta from t)),
  '42501', null, 'Nao grava em outra empresa durante a sessao da Alfa');

select * from finish();
rollback;