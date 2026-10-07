-- Comercial (CM5): portal do afiliado.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'afi@parceiro.com'),
  ('00000000-0000-0000-0000-0000000005a2', 'outro@x.com'),
  ('00000000-0000-0000-0000-0000000005a3', 'cli@alfa.com');

insert into public.afiliados (id, usuario_id, codigo, nome, email)
values ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000005a1',
        'parceiro-w', 'Parceiro W', 'afi@parceiro.com');
select public.registrar_indicacao('parceiro-w', 'v1', null);
select public.registrar_indicacao('parceiro-w', 'v2', null);

create temp table t as
select public.checkout_criar_empresa('Cliente W', 'cliente-w', '00000000-0000-0000-0000-0000000005a3',
                                     'suite_essencial', 'anual', 3, false, 'v1') as tid;

set local role authenticated;

-- Afiliado
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);

-- 1
select ok(public.sou_afiliado(), 'Afiliado e reconhecido');

create temp table p as select public.meu_portal_afiliado() as j;

-- 2
select is((select (j->>'cliques_total')::int from p), 2, 'Portal mostra os cliques');

-- 3
select is((select j->'clientes'->0->>'empresa' || '|' || (j->'clientes'->0->>'status') from p),
          'Cliente W|teste', 'Portal mostra o cliente indicado e a situacao');

-- 4
select is((select (j->'totais'->>'prevista')::int from p), 0, 'Sem pagamento ainda, sem comissao');

-- Outra pessoa
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);

-- 5
select ok(not public.sou_afiliado(), 'Quem nao e afiliado nao e reconhecido');

-- 6
select throws_ok($$select public.meu_portal_afiliado()$$, '42501', null,
                 'Quem nao e afiliado nao acessa o portal');

select * from finish();
rollback;