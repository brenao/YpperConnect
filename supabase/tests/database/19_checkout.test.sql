-- Comercial (CM4): checkout, eventos do gateway e inadimplencia.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

create temp table hoje as select (now() at time zone 'America/Sao_Paulo')::date as d;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000004a1', 'novo@cliente.com');
insert into public.afiliados (codigo, nome, email) values ('parceiro-z', 'Parceiro Z', 'z@p.com');

-- 1
select ok(public.registrar_indicacao('PARCEIRO-Z', 'visitante-1', 'google'), 'Clique no link do afiliado registrado');

create temp table t as
select public.checkout_criar_empresa('Cliente Novo', 'cliente-novo', '00000000-0000-0000-0000-0000000004a1',
                                     'itsm_pro', 'mensal', 5, false, 'visitante-1') as tid;

-- 2
select is((select plano_codigo || '|' || ciclo || '|' || usuarios_contratados || '|' || status
             from public.assinaturas a, t where a.tenant_id = t.tid),
          'itsm_pro|mensal|5|teste', 'Checkout cria a empresa em teste com o plano escolhido');

-- 3
select ok((select afiliado_id is not null from public.assinaturas a, t where a.tenant_id = t.tid),
          'Venda atribuida ao afiliado do ultimo clique');

select public.vincular_gateway((select tid from t), 'asaas', 'cus_1', 'sub_1');

create temp table ev as select jsonb_build_object(
  'assinatura', 'sub_1', 'fatura', 'pay_1', 'valor_centavos', 59500,
  'vencimento', (select d from hoje), 'metodo', 'pix', 'link', 'https://pague') as p;

select public.processar_evento_gateway('asaas', 'evt_1', 'pagamento_criado', (select p from ev));
select public.processar_evento_gateway('asaas', 'evt_2', 'pagamento_confirmado', (select p from ev));

-- 4
select is((select status from public.assinaturas a, t where a.tenant_id = t.tid), 'ativa',
          'Pagamento confirmado ativa a assinatura');

-- 5
select is((select count(*) from public.comissoes)::int, 1, 'Pagamento confirmado gera a comissao');

-- 6
select is(public.processar_evento_gateway('asaas', 'evt_2', 'pagamento_confirmado', (select p from ev)),
          'repetido', 'Webhook repetido nao e aplicado duas vezes');

-- 7
select is((select count(*) from public.comissoes)::int, 1, 'Sem comissao em dobro');

-- Vencimento e degraus
update ev set p = jsonb_set(p, '{fatura}', '"pay_2"');
select public.processar_evento_gateway('asaas', 'evt_3', 'pagamento_vencido', (select p from ev));
update public.assinaturas a set inadimplente_desde = (select d from hoje) - 8 from t where a.tenant_id = t.tid;
select public.aplicar_inadimplencia();

-- 8
select is((select status from public.assinaturas a, t where a.tenant_id = t.tid), 'somente_leitura',
          '7 dias inadimplente: somente leitura');

update public.assinaturas a set inadimplente_desde = (select d from hoje) - 15 from t where a.tenant_id = t.tid;
select public.aplicar_inadimplencia();

-- 9
select is((select status from public.assinaturas a, t where a.tenant_id = t.tid), 'suspensa',
          '14 dias inadimplente: suspensa');

select * from finish();
rollback;