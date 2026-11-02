-- Cancelamento no fim do periodo pago: o acesso continua ate o ultimo dia pago.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(12);

create temp table hoje as select (now() at time zone 'America/Sao_Paulo')::date as d;
grant select on hoje to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000027a0', 'op@cancela.com'),
  ('00000000-0000-0000-0000-0000000027a1', 'mensal@cancela.com'),
  ('00000000-0000-0000-0000-0000000027a2', 'anual@cancela.com'),
  ('00000000-0000-0000-0000-0000000027a3', 'teste@cancela.com');
insert into public.plataforma_admins (usuario_id) values ('00000000-0000-0000-0000-0000000027a0');

create temp table t as select
  public.checkout_criar_empresa('Mensal', 'mensal-27', '00000000-0000-0000-0000-0000000027a1',
                                'itsm_pro', 'mensal', 3, false, null) as mensal,
  public.checkout_criar_empresa('Anual', 'anual-27', '00000000-0000-0000-0000-0000000027a2',
                                'suite_pro', 'anual', 3, false, null) as anual,
  public.checkout_criar_empresa('Teste', 'teste-27', '00000000-0000-0000-0000-0000000027a3',
                                'itsm_pro', 'mensal', 3, false, null) as teste;
grant select on t to authenticated;

-- Mensal e anual pagos hoje
select public.vincular_gateway((select mensal from t), 'asaas', 'cus_27m', 'sub_27m');
select public.vincular_gateway((select anual from t), 'asaas', 'cus_27a', 'sub_27a');
select public.processar_evento_gateway('asaas', 'evt_27m', 'pagamento_confirmado', jsonb_build_object(
  'assinatura', 'sub_27m', 'fatura', 'pay_27m', 'valor_centavos', 35700,
  'vencimento', (select d from hoje), 'metodo', 'pix'));
select public.processar_evento_gateway('asaas', 'evt_27a', 'pagamento_confirmado', jsonb_build_object(
  'assinatura', 'sub_27a', 'fatura', 'pay_27a', 'valor_centavos', 435600,
  'vencimento', (select d from hoje), 'metodo', 'pix'));

set local role authenticated;

-- 1: cliente nao agenda cancelamento pelo banco
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000027a1","role":"authenticated"}', true);
select throws_ok($$select public.agendar_cancelamento((select mensal from t))$$, '42501', null,
                 'So o operador agenda o cancelamento');

-- Operador
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000027a0","role":"authenticated"}', true);

-- 2 e 3: mensal vai ate o fim do mes pago, e a assinatura continua ativa
select is((public.agendar_cancelamento((select mensal from t))->>'encerra_em')::date,
          (select (d + interval '1 month')::date from hoje),
          'Mensal: acesso ate o fim do mes ja pago');
select is((select status from public.painel_assinaturas() where slug = 'mensal-27'), 'ativa',
          'Com cancelamento agendado, a assinatura segue ativa');

-- 4: agendar de novo nao muda a data
select is((public.agendar_cancelamento((select mensal from t))->>'encerra_em')::date,
          (select (d + interval '1 month')::date from hoje),
          'Agendar de novo mantem a mesma data');

-- 5: o gateway volta junto, para o servidor cancelar as proximas cobrancas
select is(public.agendar_cancelamento((select mensal from t))->>'gateway_assinatura_id', 'sub_27m',
          'Devolve a assinatura do gateway');

-- 6: em teste, encerra no mesmo dia
select is((public.agendar_cancelamento((select teste from t))->>'encerra_em')::date,
          (select d from hoje), 'Em teste: encerra hoje, sem cobranca');

-- 7: a situacao mostra ate quando vai o acesso
select is((public.situacao_assinatura((select mensal from t))->>'encerra_em')::date,
          (select (d + interval '1 month')::date from hoje),
          'Situacao da assinatura informa o fim do acesso');
select is(public.situacao_assinatura((select mensal from t))->>'acesso', 'total',
          'Acesso continua total ate o fim do periodo');

reset role;

-- 9: anual cancelado direto no Asaas vai ate o fim dos 12 meses
select public.processar_evento_gateway('asaas', 'evt_27c', 'assinatura_cancelada',
                                       jsonb_build_object('assinatura', 'sub_27a'));
select is((select encerra_em || '|' || status from public.assinaturas a, t where a.tenant_id = t.anual),
          (select (d + interval '1 year')::date || '|ativa' from hoje),
          'Anual cancelado no gateway: acesso ate o fim dos 12 meses');

-- 10 e 11: a rotina so encerra depois do ultimo dia
set local role service_role;
select is(public.encerrar_assinaturas_vencidas(), 0, 'Antes do fim, a rotina nao encerra nada');
reset role;
update public.assinaturas a set encerra_em = (select d - 1 from hoje) from t where a.tenant_id = t.mensal;
set local role service_role;
select is(public.encerrar_assinaturas_vencidas(), 1, 'Depois do ultimo dia, a rotina encerra');
reset role;

-- 12: encerrada, a empresa perde o acesso
select is(public.situacao_assinatura((select mensal from t))->>'acesso', 'bloqueado',
          'Encerrada, a empresa fica sem acesso');

select * from finish();
rollback;
