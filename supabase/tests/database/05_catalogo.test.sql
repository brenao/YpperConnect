-- Catalogo: servicos e sistemas por empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000005a', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-00000000005b', 'beto@beta.com'),
  ('00000000-0000-0000-0000-00000000005c', 'caio@alfa.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa5', '00000000-0000-0000-0000-00000000005a') as alfa,
       app.provisionar_tenant('Beta', 'beta5', '00000000-0000-0000-0000-00000000005b') as beta;
grant select on t to authenticated;

-- Caio: membro comum (nao admin) do Alfa
insert into public.tenant_membros (tenant_id, usuario_id, tipo)
select alfa, '00000000-0000-0000-0000-00000000005c', 'interno' from t;

-- 1
select is((select count(*) from public.servicos s, t where s.tenant_id = t.alfa)::int, 6,
          'Empresa nasce com os 6 servicos do legado');

-- 2
select is((select count(*) from public.sistemas s, t where s.tenant_id = t.alfa and s.equipe_id is not null)::int, 5,
          'Empresa nasce com os 5 sistemas iniciais, ja com equipe');

-- 3
select throws_ok(
  format($$insert into public.sistemas (tenant_id, nome, criticidade, responsavel_id)
           values (%L, 'SAP', 'alta', '00000000-0000-0000-0000-00000000005b')$$, (select alfa from t)),
  '23503', null, 'Responsavel precisa ser membro da mesma empresa');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000005a","role":"authenticated"}', true);

-- 4
select lives_ok(
  format($$insert into public.sistemas (tenant_id, nome, criticidade, responsavel_id)
           values (%L, 'SAP', 'alta', '00000000-0000-0000-0000-00000000005c')$$, (select alfa from t)),
  'Admin cadastra sistema com responsavel da propria empresa');

-- 5
select is_empty($$select 1 from public.servicos s join t on s.tenant_id = t.beta$$,
                'Nao ve servicos de outra empresa');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000005c","role":"authenticated"}', true);

-- 6
select is((select count(*) from public.servicos s, t where s.tenant_id = t.alfa)::int, 6,
          'Usuario comum le o catalogo da empresa');

-- 7
select throws_ok(
  format($$insert into public.servicos (tenant_id, nome, tipo_padrao, sla_horas)
           values (%L, 'X', 'incidente', 4)$$, (select alfa from t)),
  '42501', null, 'Usuario comum nao altera o catalogo');

select * from finish();
rollback;