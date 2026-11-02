-- Aceite dos termos na contratacao: gravado junto com a empresa e imutavel.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000026a1', 'cliente@aceite.com'),
  ('00000000-0000-0000-0000-0000000026a2', 'outro@aceite.com');

create temp table t as
select public.checkout_criar_empresa('Empresa Aceite', 'empresa-aceite-26', '00000000-0000-0000-0000-0000000026a1',
                                     'suite_pro', 'anual', 5, false, null, null,
                                     '2026-11-01', '203.0.113.7', 'Mozilla/5.0 teste') as tid;

-- 1 e 2: o aceite sai com a empresa, a versao, o IP e o navegador
select is((select count(*)::int from public.aceites_termos a, t where a.tenant_id = t.tid), 1,
          'Contratacao grava um registro de aceite');
select is((select versao || '|' || email || '|' || ip || '|' || user_agent || '|' || array_to_string(documentos, ',')
             from public.aceites_termos a, t where a.tenant_id = t.tid),
          '2026-11-01|cliente@aceite.com|203.0.113.7|Mozilla/5.0 teste|termos,privacidade',
          'Aceite guarda versao, e-mail, IP, navegador e documentos');

-- 3: sem versao (chamada antiga), nada e gravado
create temp table t2 as
select public.checkout_criar_empresa('Sem Aceite', 'sem-aceite-26', '00000000-0000-0000-0000-0000000026a2',
                                     'itsm_pro', 'mensal', 3, false, null) as tid;
select is((select count(*)::int from public.aceites_termos a, t2 where a.tenant_id = t2.tid), 0,
          'Sem versao dos termos, nenhum aceite e gravado');

-- 4: versao em formato invalido e recusada
select throws_ok($$select public.checkout_criar_empresa('X', 'x-aceite-26', '00000000-0000-0000-0000-0000000026a2',
                                                       'itsm_pro', 'mensal', 3, false, null, null, 'v1')$$,
                 '23514', null, 'Versao fora do formato AAAA-MM-DD e recusada');

-- 5 e 6: imutavel, nem o servidor altera ou apaga
set local role service_role;
select throws_ok($$update public.aceites_termos set versao = '2020-01-01'$$, '42501', null,
                 'Aceite nao pode ser alterado');
select throws_ok($$delete from public.aceites_termos$$, '42501', null,
                 'Aceite nao pode ser excluido');
reset role;

-- 7: usuario logado sem permissao de admin nao le aceites
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a2"}', true);
select is((select count(*)::int from public.aceites_termos), 0,
          'Quem nao e admin da empresa nao enxerga os aceites');
reset role;

select * from finish();
rollback;