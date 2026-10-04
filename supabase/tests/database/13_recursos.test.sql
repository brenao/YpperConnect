-- Recursos, ausencias e fornecedores por empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000da', 'ana@alfa.com', '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-0000000000db', 'caio@alfa.com', '{"full_name":"Caio"}'),
  ('00000000-0000-0000-0000-0000000000dc', 'beto@beta.com', '{}');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa13', '00000000-0000-0000-0000-0000000000da') as alfa,
       app.provisionar_tenant('Beta', 'beta13', '00000000-0000-0000-0000-0000000000dc') as beta;
grant select on t to authenticated;
-- Caio: usuario final (perfil sem recurso.editar)
insert into public.tenant_membros (tenant_id, usuario_id, tipo, departamento, perfil_id)
select alfa, '00000000-0000-0000-0000-0000000000db', 'interno', 'Financeiro',
       (select id from public.perfis_acesso where tenant_id = t.alfa and nome = 'Usuário final') from t;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000da","role":"authenticated"}', true);

-- 1
select is(public.criar_recursos_de_usuarios((select alfa from t),
          array['00000000-0000-0000-0000-0000000000da','00000000-0000-0000-0000-0000000000db']::uuid[],
          50::smallint, 8), 2, 'Admin cria recursos em lote a partir dos usuarios');

-- 2
select is(public.criar_recursos_de_usuarios((select alfa from t),
          array['00000000-0000-0000-0000-0000000000db']::uuid[], 50::smallint, 8), 0,
          'Clique duplo nao duplica recurso');

-- 3
select is((select papel from public.recursos_v where usuario_nome = 'Caio'), 'Financeiro',
          'Recurso herda o departamento como papel');

insert into public.recurso_ausencias (tenant_id, recurso_id, inicio, fim, criado_por_id)
select r.tenant_id, r.id, '2026-12-01', '2026-12-10', '00000000-0000-0000-0000-0000000000da'
  from public.recursos r where r.usuario_id = '00000000-0000-0000-0000-0000000000db';

-- 4
delete from public.recurso_ausencias;
select is((select count(*) from public.recurso_ausencias)::int, 1,
          'Ausencia nao se apaga fisicamente');

update public.recurso_ausencias set excluido_em = now();

-- 5
select is_empty($$select 1 from public.recurso_ausencias_v$$, 'Ausencia excluida some da lista');

-- 6
select lives_ok(
  format($$insert into public.fornecedores (tenant_id, nome, cnpj) values (%L, 'Consultoria X', '12345678000199')$$,
         (select alfa from t)),
  'Cadastra fornecedor');

-- Caio (usuario final)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000db","role":"authenticated"}', true);

-- 7
select throws_ok(
  format($$insert into public.fornecedores (tenant_id, nome) values (%L, 'Outra')$$, (select alfa from t)),
  '42501', null, 'Perfil sem recurso.editar nao gere fornecedores');

-- Beto (outra empresa)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000dc","role":"authenticated"}', true);

-- 8
select is_empty($$select 1 from public.recursos_v$$, 'Outra empresa nao ve os recursos');

select * from finish();
rollback;