-- Exclusao sempre logica: sistema, feriado e empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(11);

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

create temp table erp as
select s.id from public.sistemas s, t where s.tenant_id = t.alfa and s.nome = 'ERP';
grant select on erp to authenticated;

-- 1
select throws_ok($$delete from public.sistemas where id = (select id from erp)$$,
                 '42501', null, 'Banco recusa exclusao fisica');

set local role authenticated;

-- Caio (nao admin)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000006c","role":"authenticated"}', true);

-- 2
select throws_ok($$select public.excluir_sistema((select id from erp))$$,
                 '42501', null, 'Usuario comum nao exclui sistema');

-- Ana (admin)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000006a","role":"authenticated"}', true);

-- 3
select is(public.vinculos_sistema((select id from erp)),
          '{"chamados": 0, "projetos": 0}'::jsonb, 'Vinculos do sistema sao consultados antes');

-- 4
select lives_ok($$select public.excluir_sistema((select id from erp))$$, 'Admin exclui sistema');

-- 5
select ok((select excluido_em is not null and excluido_por = '00000000-0000-0000-0000-00000000006a'
                  and not ativo
             from public.sistemas where id = (select id from erp)),
          'Exclusao logica: registro fica, com data e autor');

-- 6
select lives_ok(
  format($$insert into public.sistemas (tenant_id, nome, criticidade) values (%L, 'ERP', 'alta')$$,
         (select alfa from t)),
  'Nome de sistema excluido pode ser usado de novo');

-- 7
select lives_ok(
  format($$select public.excluir_feriado((select id from public.feriados
            where tenant_id = %L and data = '2026-12-25'))$$, (select alfa from t)),
  'Admin exclui feriado (logico)');

-- 8
select ok(not (public.calendario_localidade((select alfa from t))->'feriados') @> '[{"data":"2026-12-25"}]',
          'Feriado excluido sai do calculo');

reset role;

-- 9
select is((select usuarios from app.resumo_empresa('alfa6'))::int, 2,
          'Resumo da empresa antes de excluir');

-- 10
select throws_like($$select app.excluir_empresa('alfa6', 'alfa')$$,
                   '%Confirmacao nao confere%', 'Exclusao de empresa exige confirmar o slug');

-- 11
select app.excluir_empresa('alfa6', 'alfa6');
select ok((select excluido_em is not null and not ativo from public.tenants where slug = 'alfa6')
          and exists(select 1 from public.sistemas s, t where s.tenant_id = t.alfa)
          and exists(select 1 from public.tenants where slug = 'beta6' and ativo),
          'Empresa excluida logicamente: dados ficam, outras empresas intactas');

select * from finish();
rollback;
