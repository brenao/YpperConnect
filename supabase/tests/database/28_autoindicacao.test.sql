-- Autoindicacao: o afiliado nao compra com o proprio cupom (pelo CPF/CNPJ).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000028a0', 'op@auto28.com'),
  ('00000000-0000-0000-0000-0000000028a1', 'outro-email@auto28.com'),
  ('00000000-0000-0000-0000-0000000028a2', 'cliente@auto28.com'),
  ('00000000-0000-0000-0000-0000000028a3', 'link@auto28.com'),
  ('00000000-0000-0000-0000-0000000028a4', 'depois@auto28.com');
insert into public.plataforma_admins (usuario_id) values ('00000000-0000-0000-0000-0000000028a0');

insert into public.afiliados (codigo, nome, email, desconto_pct, documento) values
  ('TESTEAUTO15', 'Ana Auto', 'ana@auto28.com', 15, '28000000028');
insert into public.afiliados (codigo, nome, email, desconto_pct, gateway_conta_id) values
  ('TESTEDEPOIS10', 'Bruno Depois', 'bruno@auto28.com', 10, 'wal_28');

-- 1: mesmo CPF com outro e-mail, recusado
select throws_ok($$select public.checkout_criar_empresa('Auto', 'auto-28', '00000000-0000-0000-0000-0000000028a1',
                     'itsm_pro', 'mensal', 3, false, null, 'testeauto15', null, null, null, '280.000.000-28')$$,
                 '22023', 'Não é possível usar o próprio cupom.',
                 'Afiliado nao usa o proprio cupom com outro e-mail');

-- 2 e 3: outro comprador usa o cupom e o documento fica gravado
create temp table t as
select public.checkout_criar_empresa('Cliente', 'cliente-28', '00000000-0000-0000-0000-0000000028a2',
         'itsm_pro', 'mensal', 3, false, null, 'TESTEAUTO15', null, null, null, '11122233396') as tid;
select is((select cupom from public.assinaturas a, t where a.tenant_id = t.tid), 'TESTEAUTO15',
          'Outro comprador usa o cupom normalmente');
select is((select documento_cliente from public.assinaturas a, t where a.tenant_id = t.tid), '11122233396',
          'Documento do comprador fica na assinatura');

-- 4: pelo proprio link, a venda vale sem afiliado
select public.registrar_indicacao('TESTEAUTO15', 'visitante-28', null);
create temp table t2 as
select public.checkout_criar_empresa('Link', 'link-28', '00000000-0000-0000-0000-0000000028a3',
         'itsm_pro', 'mensal', 3, false, 'visitante-28', null, null, null, null, '28000000028') as tid;
select is((select afiliado_id from public.assinaturas a, t2 where a.tenant_id = t2.tid), null,
          'Pelo proprio link, a venda fica sem afiliado');

-- 5: um documento, um afiliado
select throws_ok($$insert into public.afiliados (codigo, nome, email, documento)
                   values ('TESTEDUP', 'Dup', 'dup@auto28.com', '28000000028')$$,
                 '23505', null, 'Mesmo documento nao cadastra dois afiliados');

-- Venda pelo cupom de quem ainda nao tinha documento
create temp table t3 as
select public.checkout_criar_empresa('Depois', 'depois-28', '00000000-0000-0000-0000-0000000028a4',
         'itsm_pro', 'mensal', 3, false, null, 'TESTEDEPOIS10', null, null, null, '99988877700') as tid;
select public.vincular_gateway((select tid from t3), 'asaas', 'cus_28', 'sub_28');

-- 6: antes de saber, o split vai para a carteira do afiliado
select is((select split_carteira from public.estado_gateway_desejado()
            where gateway_assinatura_id = 'sub_28'), 'wal_28',
          'Sem documento do afiliado, o split segue normal');

-- 7: cliente nao altera afiliado; operador informa o documento depois
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000028a4","role":"authenticated"}', true);
select throws_ok($$select public.atualizar_afiliado((select id from public.afiliados where codigo = 'TESTEDEPOIS10'),
                                                    10, true, '999.888.777-00')$$,
                 '42501', null, 'So o operador informa o documento do afiliado');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000028a0","role":"authenticated"}', true);
select public.atualizar_afiliado((select id from public.afiliados where codigo = 'TESTEDEPOIS10'),
                                 10, true, '999.888.777-00');
reset role;

-- 8: descoberta a autoindicacao, o split sai
select is((select split_carteira from public.estado_gateway_desejado()
            where gateway_assinatura_id = 'sub_28'), null,
          'Autoindicacao descoberta: o split sai na proxima sincronizacao');

-- 9: e a fatura paga nao gera comissao
select public.processar_evento_gateway('asaas', 'evt_28', 'pagamento_confirmado', jsonb_build_object(
  'assinatura', 'sub_28', 'fatura', 'pay_28', 'valor_centavos', 10000,
  'vencimento', (now() at time zone 'America/Sao_Paulo')::date, 'metodo', 'pix'));
select is((select count(*)::int from public.comissoes c join public.assinaturas a on a.id = c.assinatura_id, t3
            where a.tenant_id = t3.tid), 0,
          'Autoindicacao nao gera comissao');

select * from finish();
rollback;
