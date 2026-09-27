-- Plataforma: cadastro de empresas so para operadores.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000008a', 'op@ypper.com'),
  ('00000000-0000-0000-0000-00000000008b', 'cliente@alfa.com'),
  ('00000000-0000-0000-0000-00000000008c', 'admin@nova.com');

insert into public.plataforma_admins (usuario_id) values ('00000000-0000-0000-0000-00000000008a');
select app.provisionar_tenant('Alfa', 'alfa8', '00000000-0000-0000-0000-00000000008b');

set local role authenticated;

-- Cliente comum
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000008b","role":"authenticated"}', true);

-- 1
select throws_ok($$select * from public.listar_empresas()$$, '42501', null,
                 'Cliente nao lista empresas');

-- 2
select throws_ok($$select public.criar_empresa('X', 'xyz', '00000000-0000-0000-0000-00000000008b')$$,
                 '42501', null, 'Cliente nao cria empresa');

-- Operador da plataforma
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000008a","role":"authenticated"}', true);

-- 3
select lives_ok($$select public.criar_empresa('Nova Empresa', 'nova8', '00000000-0000-0000-0000-00000000008c')$$,
                'Operador cria empresa com o primeiro administrador');

-- 4
select throws_ok($$select public.criar_empresa('Outra', 'nova8', '00000000-0000-0000-0000-00000000008c')$$,
                 '23505', null, 'Endereco (slug) nao se repete');

-- 5
select ok(exists(select 1 from public.listar_empresas() where slug = 'nova8' and usuarios = 1),
          'Lista mostra a empresa nova com o administrador');

reset role;

-- 6
select ok((select m.admin from public.tenant_membros m join public.tenants t on t.id = m.tenant_id
            where t.slug = 'nova8' and m.usuario_id = '00000000-0000-0000-0000-00000000008c'),
          'Primeiro administrador entra como admin da empresa');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000008a","role":"authenticated"}', true);

-- 7
select lives_ok(
  $$select public.excluir_empresa((select id from public.listar_empresas() where slug = 'nova8'), 'nova8')$$,
  'Operador exclui (logico) com confirmacao do endereco');

select * from finish();
rollback;
