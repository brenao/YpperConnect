-- Exclusao de sistema (tela) e de empresa (plataforma).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000006a', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-00000000006b', 'beto@beta.com'),
  ('00000000-0000-0000-0000-00000000006c', 'caio@alfa.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa6', '00000000-0000-0000-0000-00000000006a') as alfa,
       app.provisionar_tenant('Beta', 'beta6', '00000000-0000-0000-0000-00000000006b') as beta;
grant select on t to authenticated;

insert into public.tenant_membros (tenant_id, usuario_id, tipo)
select alfa, '00000000-0000-0000-0000-00000000006c', 'interno' from t;

set local role authenticated;

-- Caio (nao admin) tenta excluir: o RLS nao deixa, nada some.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000006c","role":"authenticated"}', true);
delete from public.sistemas where nome = 'ERP';

-- 1
select is((select count(*) from public.sistemas s, t where s.tenant_id = t.alfa and s.nome = 'ERP')::int,
          1, 'Usuario comum nao exclui sistema');

-- Ana (admin) exclui
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000006a","role":"authenticated"}', true);
delete from public.sistemas s using t where s.tenant_id = t.alfa and s.nome = 'ERP';

-- 2
select is((select count(*) from public.sistemas s, t where s.tenant_id = t.alfa and s.nome = 'ERP')::int,
          0, 'Admin exclui sistema da propria empresa');

-- 3
select ok(exists(select 1 from public.auditoria a, t
                  where a.tenant_id = t.alfa and a.tabela = 'sistemas' and a.operacao = 'DELETE'),
          'Exclusao fica na auditoria');

reset role;

-- 4
select throws_like($$select app.excluir_empresa('alfa6', 'alfa')$$,
                   '%Confirmacao nao confere%', 'Exclusao de empresa exige confirmar o slug');

-- 5
select lives_ok($$select app.excluir_empresa('alfa6', 'alfa6')$$, 'Plataforma exclui a empresa');

-- 6
select ok(not exists(select 1 from public.tenants where slug = 'alfa6')
          and exists(select 1 from public.tenants where slug = 'beta6')
          and exists(select 1 from auth.users where email = 'ana@alfa.com'),
          'Some so a empresa excluida; as contas de login ficam');

select * from finish();
rollback;
