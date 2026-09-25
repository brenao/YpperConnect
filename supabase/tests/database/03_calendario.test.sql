-- Passo 3.3: funcao de calendario usada pelo SLA e pelo cronograma.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000002a', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-00000000002b', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa33', '00000000-0000-0000-0000-00000000002a') as alfa,
       app.provisionar_tenant('Beta', 'beta33', '00000000-0000-0000-0000-00000000002b') as beta;
grant select on t to authenticated;

-- Filial com feriado municipal proprio e sem expediente proprio.
insert into public.localidades (tenant_id, nome, cidade)
select alfa, 'Filial Caxias', 'Caxias do Sul' from t;
insert into public.feriados (tenant_id, localidade_id, data, descricao, tipo)
select l.tenant_id, l.id, '2026-06-26', 'Aniversario de Caxias', 'municipal'
  from public.localidades l, t where l.tenant_id = t.alfa and l.nome = 'Filial Caxias';

create temp table filial as
select l.id from public.localidades l, t where l.tenant_id = t.alfa and l.nome = 'Filial Caxias';
grant select on filial to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000002a","role":"authenticated"}', true);

-- 1
select is(jsonb_array_length(public.calendario_localidade((select alfa from t))->'expediente'),
          10, 'Padrao: expediente com 10 faixas');

-- 2
select ok(jsonb_array_length(public.calendario_localidade((select alfa from t))->'feriados') >= 17,
          'Padrao: inclui os feriados nacionais da plataforma');

-- 3
select is(jsonb_array_length(public.calendario_localidade((select alfa from t), (select id from filial))->'expediente'),
          10, 'Filial sem expediente proprio herda o da padrao');

-- 4
select ok((public.calendario_localidade((select alfa from t), (select id from filial))->'feriados')
            @> '[{"data":"2026-06-26"}]',
          'Filial enxerga o proprio feriado municipal');

-- 5
select ok(not (public.calendario_localidade((select alfa from t))->'feriados')
            @> '[{"data":"2026-06-26"}]',
          'Padrao nao enxerga o feriado da filial');

-- 7
select is((select count(*) from public.feriados f, t where f.tenant_id = t.alfa and f.tipo = 'nacional')::int,
          (select count(*) from public.feriados_plataforma where ativo and pais = 'BR')::int,
          'Empresa nova nasce com os feriados nacionais do modelo');

-- 8
select lives_ok(
  format($$update public.feriados set ativo = false
            where tenant_id = %L and tipo = 'nacional' and data = '2026-12-25'$$, (select alfa from t)),
  'Admin desativa um feriado nacional da propria empresa');

-- 9
select ok(not (public.calendario_localidade((select alfa from t))->'feriados')
            @> '[{"data":"2026-12-25"}]',
          'Nacional desativado sai do calculo');

-- 6
select throws_ok(
  format($$select public.calendario_localidade(%L)$$, (select beta from t)),
  '42501', null, 'Nao le o calendario de outro tenant');

select * from finish();
rollback;
