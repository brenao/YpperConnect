-- Esqueci minha senha: limite de pedidos e acesso so pelo servidor.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(5);

set local role service_role;
select ok(public.registrar_recuperacao_senha('e1', 'ip1'), '1o pedido do e-mail e aceito');
select ok(public.registrar_recuperacao_senha('e1', 'ip1'), '2o pedido e aceito');
select ok(public.registrar_recuperacao_senha('e1', 'ip1'), '3o pedido e aceito');
select ok(not public.registrar_recuperacao_senha('e1', 'ip2'), '4o pedido na mesma hora e recusado');
reset role;

set local role authenticated;
select throws_ok($$select public.registrar_recuperacao_senha('e2', 'ip1')$$, '42501', null,
                 'Usuario logado nao chama a funcao direto');

select * from finish();
rollback;
