-- Rodar: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

-- Pessoas (o trigger cria public.usuarios)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@alfa.com',  '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@beta.com', '{"full_name":"Beto"}');

-- Dois tenants: Ana administra Alfa, Beto administra Beta
create temp table t as
select app.provisionar_tenant('Alfa', 'alfa', '00000000-0000-0000-0000-00000000000a') as alfa,
       app.provisionar_tenant('Beta', 'beta', '00000000-0000-0000-0000-00000000000b') as beta;
grant select on t to authenticated;

-- Dominio verificado do Alfa: Caio entra sozinho como solicitante
insert into public.tenant_dominios (dominio, tenant_id, verificado)
select 'alfa.com', alfa, true from t;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000c', 'caio@alfa.com');

-- 1
select throws_ok(
  format($$insert into public.organizacoes (tenant_id, pai_id, tipo, nome)
           values (%L, (select id from public.organizacoes where tenant_id = %L limit 1), 'area', 'Invasora')$$,
         (select alfa from t), (select beta from t)),
  '23503', null, 'FK composta impede pai de outro tenant');

-- 2
select ok(exists(select 1 from public.tenant_membros m, t
                  where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-00000000000c'),
          'Dominio verificado inclui o usuario no tenant');

-- 3
select is((select p.nome from public.tenant_membros m join public.perfis_acesso p on p.id = m.perfil_id
            where m.usuario_id = '00000000-0000-0000-0000-00000000000c'),
          'Usuário final', 'Ingresso por dominio recebe o perfil Usuario final');

-- Agora como Ana (usuaria autenticada, sujeita ao RLS)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- 4
select is((select count(*) from public.tenants)::int, 1, 'Ana ve apenas o proprio tenant');

-- 5
select is_empty(
  $$select 1 from public.organizacoes o join t on o.tenant_id = t.beta$$,
  'Ana nao ve organizacoes do Beta');

-- 6
select throws_ok(
  format($$insert into public.organizacoes (tenant_id, tipo, nome) values (%L, 'area', 'X')$$,
         (select beta from t)),
  '42501', null, 'Ana nao grava no Beta');

-- 7
select lives_ok(
  format($$insert into public.organizacoes (tenant_id, tipo, nome) values (%L, 'area', 'TI')$$,
         (select alfa from t)),
  'Ana (admin) grava no Alfa');

-- 8
select is((select count(*) from public.usuarios)::int, 2, 'Ana ve a si e ao Caio, nao ao Beto');

-- Agora como Caio (solicitante)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

-- 9
select throws_ok(
  format($$insert into public.organizacoes (tenant_id, tipo, nome) values (%L, 'area', 'RH')$$,
         (select alfa from t)),
  '42501', null, 'Solicitante nao gerencia organizacoes');

select * from finish();
rollback;
