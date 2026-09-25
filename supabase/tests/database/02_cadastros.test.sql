-- Passo 3: cadastros base. Rodar como o 01 (psql -f ...).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000001a', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-00000000001b', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa3', '00000000-0000-0000-0000-00000000001a') as alfa,
       app.provisionar_tenant('Beta', 'beta3', '00000000-0000-0000-0000-00000000001b') as beta;
grant select on t to authenticated;

insert into public.equipes (tenant_id, nome) select beta, 'Infra Beta' from t;

-- 1
select is((select count(*) from public.localidades l, t where l.tenant_id = t.alfa and l.padrao)::int,
          1, 'Tenant novo nasce com uma localidade padrao');

-- 2
select is((select count(*) from public.expediente e, t where e.tenant_id = t.alfa)::int,
          10, 'Expediente padrao: 5 dias x 2 faixas');

-- 3
select ok(exists(select 1 from public.tenant_membros m join public.perfis_acesso p on p.id = m.perfil_id, t
                  where m.tenant_id = t.alfa and m.admin and p.nome = 'Administrador de TI'),
          'Dono da empresa entra como administrador, perfil Administrador de TI');

-- 4
select throws_ok(
  format($$update public.tenant_membros set equipe_id = (select id from public.equipes where tenant_id = %L and nome = 'Infra Beta')
           where tenant_id = %L$$, (select beta from t), (select alfa from t)),
  '23503', null, 'Membro nao pode apontar para equipe de outro tenant');

-- Como Ana (admin do Alfa)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000001a","role":"authenticated"}', true);

-- 5
select lives_ok(
  format($$insert into public.equipes (tenant_id, nome) values (%L, 'Suporte N2')$$, (select alfa from t)),
  'Admin cria equipe no proprio tenant');

-- 6
select is_empty($$select 1 from public.equipes e join t on e.tenant_id = t.beta$$,
                'Ana nao ve equipes do Beta');

-- 7
select throws_ok(
  format($$insert into public.equipes (tenant_id, nome) values (%L, 'Invasao')$$, (select beta from t)),
  '42501', null, 'Ana nao cria equipe no Beta');

-- 8
select ok((select count(*) from public.feriados_plataforma) > 0,
          'Feriados nacionais visiveis para usuario logado');

-- 9
select throws_ok(
  $$insert into public.feriados_plataforma (data, descricao) values ('2030-01-01', 'X')$$,
  '42501', null, 'Usuario nao altera feriados da plataforma');

-- 10
select lives_ok(
  format($$insert into public.feriados (tenant_id, localidade_id, data, descricao, tipo)
           select %L, id, '2026-01-25', 'Aniversario de SP', 'municipal'
             from public.localidades where tenant_id = %L and padrao$$,
         (select alfa from t), (select alfa from t)),
  'Admin cadastra feriado municipal na localidade');

select * from finish();
rollback;
