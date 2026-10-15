-- Codigo do afiliado: maiusculas e unico.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000006a1', 'op@ypper.com');
insert into public.plataforma_admins (usuario_id) values ('00000000-0000-0000-0000-0000000006a1');

insert into public.afiliados (codigo, nome, email) values ('luciana20', 'Luciana', 'l@x.com');

-- 1
select is((select codigo from public.afiliados where nome = 'Luciana'), 'LUCIANA20',
          'Codigo gravado em maiusculas');

-- 2
select throws_ok($$insert into public.afiliados (codigo, nome, email) values ('Luciana20', 'Outra', 'o@x.com')$$,
                 '23505', null, 'Codigo unico, sem diferenciar maiusculas');

-- 3
select ok(public.registrar_indicacao('luciana20', 'v1', null), 'Link antigo em minusculas continua valendo');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);

-- 4
select is(public.codigos_afiliado_em_uso(array['LUCIANA20','LUCIANAS20']), array['LUCIANA20'],
          'Tela descobre quais sugestoes ja estao em uso');

select * from finish();
rollback;