-- Departamentos por empresa e perfil pela combinacao departamento + cargo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000022aa', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000022bb', 'beto@beta.com'),
  ('00000000-0000-0000-0000-0000000022cc', 'caio@alfa.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa22', '00000000-0000-0000-0000-0000000022aa') as alfa,
       app.provisionar_tenant('Beta', 'beta22', '00000000-0000-0000-0000-0000000022bb') as beta;
grant select on t to authenticated;

create temp table d as
select (select id from public.departamentos x, t where x.tenant_id = t.alfa and x.nome = 'TI') as ti,
       (select id from public.departamentos x, t where x.tenant_id = t.alfa and x.nome = 'Financeiro') as fin,
       (select id from public.equipes e, t where e.tenant_id = t.alfa and e.nome = 'Sistemas') as equipe;
grant select on d to authenticated;

-- 1
select is((select count(*)::int from public.departamentos x, t where x.tenant_id = t.alfa),
          7, 'Empresa nasce com 7 departamentos');

-- 2
select is((select count(*)::int from public.departamentos x, t where x.tenant_id = t.alfa and x.ti),
          1, 'Somente o departamento TI vem marcado como TI');

-- 3 a 7: perfil pela combinacao
select is((select nome from public.perfis_acesso where id = public.perfil_do_cargo((select ti from d), 'analista')),
          'Analista de TI', 'Analista + TI = Analista de TI');
select is((select nome from public.perfis_acesso where id = public.perfil_do_cargo((select fin from d), 'analista')),
          'Usuário final', 'Analista + outro departamento = Usuario final');
select is((select nome from public.perfis_acesso where id = public.perfil_do_cargo((select ti from d), 'gerente_projetos')),
          'Gerente de Projetos de TI', 'Gerente de projetos + TI');
select is((select nome from public.perfis_acesso where id = public.perfil_do_cargo((select fin from d), 'gerente_projetos')),
          'Gerente de Projetos', 'Gerente de projetos + outro departamento');
select is((select nome from public.perfis_acesso where id = public.perfil_do_cargo((select fin from d), 'diretoria')),
          'Gestor / Diretoria', 'Gestor/diretoria e o mesmo em qualquer departamento');

-- 8: fora da TI nao fica com equipe; texto do departamento vem do cadastro
insert into public.tenant_membros (tenant_id, usuario_id, tipo, departamento_id, equipe_id, perfil_id)
select t.alfa, '00000000-0000-0000-0000-0000000022cc', 'interno', d.fin, d.equipe,
       public.perfil_do_cargo(d.fin, 'gerente_projetos')
  from t, d;
select ok((select equipe_id is null and departamento = 'Financeiro'
             from public.tenant_membros m, t
            where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-0000000022cc'),
          'Membro fora da TI entra sem equipe e com o nome do departamento');

-- 9: gerente de projetos de outra area conta como pagante
select ok((select app.eh_pagante(m) from public.tenant_membros m, t
            where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-0000000022cc'),
          'Gerente de projetos fora da TI e usuario pagante');

-- 10: pedir equipe para quem continua fora da TI e erro
select throws_ok(
  format($$update public.tenant_membros set equipe_id = %L
            where tenant_id = %L and usuario_id = '00000000-0000-0000-0000-0000000022cc'$$,
         (select equipe from d), (select alfa from t)),
  'P0001', null, 'Equipe de TI recusada para quem nao e da TI');

-- 11: mudar para a TI libera a equipe
update public.tenant_membros m set departamento_id = d.ti, equipe_id = d.equipe
  from t, d where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-0000000022cc';
select ok((select equipe_id is not null and departamento = 'TI'
             from public.tenant_membros m, t
            where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-0000000022cc'),
          'No departamento TI a equipe fica');

-- 12: tirar a marca de TI com gente de equipe e recusado
select throws_ok(format($$update public.departamentos set ti = false where id = %L$$, (select ti from d)),
                 'P0001', null, 'Nao tira a marca de TI de departamento com equipe');

-- 13: renomear atualiza o texto dos membros
update public.departamentos set nome = 'Tecnologia' where id = (select ti from d);
select is((select departamento from public.tenant_membros m, t
            where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-0000000022cc'),
          'Tecnologia', 'Renomear o departamento atualiza os membros');

set local role authenticated;

-- Ana (admin da Alfa)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000022aa","role":"authenticated"}', true);

-- 14: administrador tem o acesso do Administrador de TI mesmo com outro cargo
reset role;
update public.tenant_membros m set perfil_id = public.perfil_do_cargo(d.ti, 'analista')
  from t, d where m.tenant_id = t.alfa and m.usuario_id = '00000000-0000-0000-0000-0000000022aa';
set local role authenticated;
select ok((public.meu_acesso((select alfa from t))->'modulos') ? '/diretoria',
          'Administrador com cargo de analista continua vendo a visao diretoria');

-- 15: exclusao logica
select lives_ok(format($$select public.excluir_departamento(%L)$$, (select fin from d)),
                'Admin exclui departamento');
select ok(not exists (select 1 from public.departamentos where id = (select fin from d)),
          'Departamento excluido some das telas');

select * from finish();
rollback;