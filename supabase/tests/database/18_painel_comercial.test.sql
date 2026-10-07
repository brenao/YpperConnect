-- Comercial (CM3): painel da plataforma.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(6);

create temp table hoje as select (now() at time zone 'America/Sao_Paulo')::date as d;
grant select on hoje to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000003a1', 'op@ypper.com'),
  ('00000000-0000-0000-0000-0000000003a2', 'cli@alfa.com');
insert into public.plataforma_admins (usuario_id) values ('00000000-0000-0000-0000-0000000003a1');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa18', '00000000-0000-0000-0000-0000000003a2') as alfa;
grant select on t to authenticated;

insert into public.afiliados (codigo, nome, email) values ('parceiro-y', 'Parceiro Y', 'y@p.com');

set local role authenticated;

-- Cliente nao ve o painel
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000003a2","role":"authenticated"}', true);
-- 1
select throws_ok($$select * from public.painel_assinaturas()$$, '42501', null, 'Cliente nao acessa o painel');

-- Operador
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000003a1","role":"authenticated"}', true);

-- 2
select is((select status from public.painel_assinaturas() where slug = 'alfa18'), 'teste',
          'Operador ve a empresa em teste');

select public.atualizar_assinatura((select alfa from t), 'projetos_pro', 'mensal', 4, false,
                                   'ativa', false, (select d + 30 from hoje), 'parceiro-y');

-- 3
select is((select valor_mensal_centavos from public.painel_assinaturas() where slug = 'alfa18'), 38000,
          'Projetos Pro mensal, 4 usuarios: 4 x 95 = R$ 380');

-- 4
select is((select afiliado_codigo from public.painel_assinaturas() where slug = 'alfa18'), 'parceiro-y',
          'Venda atribuida ao afiliado');

-- 5
select throws_like($$select public.atualizar_assinatura((select alfa from t), 'itsm_pro', 'anual', 3, false,
                     'ativa', false, null, 'nao-existe')$$, '%nao encontrado%', 'Codigo de afiliado invalido e recusado');

reset role;

insert into public.faturas (id, tenant_id, assinatura_id, competencia, valor_centavos, vencimento, status, pago_em)
select '00000000-0000-0000-0000-0000000003b1', t.alfa, a.id, (select d from hoje), 38000, (select d from hoje), 'paga', now() - interval '31 days'
  from public.assinaturas a, t where a.tenant_id = t.alfa;
select app.gerar_comissao('00000000-0000-0000-0000-0000000003b1');

-- 6
select is(public.liberar_comissoes(), 1, 'Comissao com carencia vencida e liberada');

select * from finish();
rollback;