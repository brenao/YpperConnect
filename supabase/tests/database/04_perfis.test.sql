-- Parte 2: perfis de acesso do legado, por empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000004a', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-00000000004b', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa4', '00000000-0000-0000-0000-00000000004a') as alfa,
       app.provisionar_tenant('Beta', 'beta4', '00000000-0000-0000-0000-00000000004b') as beta;
grant select on t to authenticated;

-- 1
select is((select count(*) from public.perfis_acesso p, t where p.tenant_id = t.alfa and p.sistema)::int,
          4, 'Empresa nasce com os 4 perfis do legado');

-- 2
select is((select count(*) from public.equipes e, t where e.tenant_id = t.alfa)::int,
          3, 'Empresa nasce com as 3 equipes do legado');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000004a","role":"authenticated"}', true);

-- 3
select ok((public.meu_acesso((select alfa from t))->>'admin')::boolean,
          'meu_acesso: dono e administrador');

-- 4
select ok((public.meu_acesso((select alfa from t))->'modulos') ? '/permissoes',
          'meu_acesso: modulos do perfil Administrador de TI');

-- 5
select is(public.meu_acesso((select beta from t)), null, 'meu_acesso: nada em empresa alheia');

-- 6
select lives_ok(
  format($$insert into public.perfis_acesso (tenant_id, nome) values (%L, 'Suporte N2')$$,
         (select alfa from t)),
  'Admin cria perfil na propria empresa');

-- 7
select is_empty($$select 1 from public.perfis_acesso p join t on p.tenant_id = t.beta$$,
                'Nao ve perfis de outra empresa');

select * from finish();
rollback;
