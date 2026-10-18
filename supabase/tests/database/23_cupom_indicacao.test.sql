-- Cupom de indicacao digitado na compra.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000023a1', 'cliente1@empresa.com'),
  ('00000000-0000-0000-0000-0000000023a2', 'cliente2@empresa.com'),
  ('00000000-0000-0000-0000-0000000023a3', 'luciana@parceira.com');

insert into public.afiliados (codigo, nome, email, desconto_pct) values
  ('LUCIANA20', 'Luciana Westin', 'luciana@parceira.com', 20),
  ('MARCOS10', 'Marcos Lima', 'marcos@parceiro.com', 10);

-- 1 a 3: validacao
select is(public.validar_cupom('luciana20') - 'codigo',
          '{"valido": true, "afiliado": "Luciana", "desconto_pct": 20.00}'::jsonb,
          'Cupom valido, sem diferenciar maiusculas, com o desconto');
select is((public.validar_cupom('NAOEXISTE')->>'valido')::boolean, false, 'Cupom inexistente e recusado');
select is((public.validar_cupom('LUCIANA20', 'Luciana@Parceira.com')->>'valido')::boolean, false,
          'Afiliado nao usa o proprio cupom');

-- Clique antigo no link de outro afiliado
select public.registrar_indicacao('MARCOS10', 'visitante-23', null);

create temp table t as
select public.checkout_criar_empresa('Cliente Um', 'cliente-um-23', '00000000-0000-0000-0000-0000000023a1',
                                     'itsm_pro', 'mensal', 5, false, 'visitante-23', 'luciana20') as tid;

-- 4: o cupom digitado vence o clique
select is((select f.codigo from public.assinaturas a join public.afiliados f on f.id = a.afiliado_id, t
            where a.tenant_id = t.tid),
          'LUCIANA20', 'Cupom digitado vence o clique antigo em link');

-- 5: desconto e cupom gravados
select is((select cupom || '|' || desconto_pct from public.assinaturas a, t where a.tenant_id = t.tid),
          'LUCIANA20|20.00', 'Assinatura guarda o cupom e o desconto');

-- 6: valor mensal com desconto (5 x preco mensal do itsm_pro, menos 20%)
select is((select public.valor_mensal_assinatura(a.id) from public.assinaturas a, t where a.tenant_id = t.tid),
          (select round(5 * preco_mensal_centavos * 0.8)::int from public.planos where codigo = 'itsm_pro'),
          'Valor mensal ja sai com o desconto do cupom');

-- 7: sem cupom, vale o clique, sem desconto
create temp table t2 as
select public.checkout_criar_empresa('Cliente Dois', 'cliente-dois-23', '00000000-0000-0000-0000-0000000023a2',
                                     'itsm_pro', 'mensal', 3, false, 'visitante-23') as tid;
select is((select f.codigo || '|' || a.desconto_pct
             from public.assinaturas a join public.afiliados f on f.id = a.afiliado_id, t2
            where a.tenant_id = t2.tid),
          'MARCOS10|0.00', 'Sem cupom: atribui pelo clique e nao da desconto');

-- 8 e 9: cupom invalido ou proprio interrompem a compra
select throws_ok($$select public.checkout_criar_empresa('X', 'x-cupom-23', '00000000-0000-0000-0000-0000000023a2',
                                                       'itsm_pro', 'mensal', 3, false, null, 'NAOEXISTE')$$,
                 '22023', null, 'Cupom invalido interrompe a compra');
select throws_ok($$select public.checkout_criar_empresa('Y', 'y-cupom-23', '00000000-0000-0000-0000-0000000023a3',
                                                       'itsm_pro', 'mensal', 3, false, null, 'LUCIANA20')$$,
                 '22023', null, 'Afiliado nao compra com o proprio cupom');

-- 10: a comissao sai do valor pago (com desconto)
select public.vincular_gateway((select tid from t), 'asaas', 'cus_23', 'sub_23');
select public.processar_evento_gateway('asaas', 'evt_23a', 'pagamento_confirmado', jsonb_build_object(
  'assinatura', 'sub_23', 'fatura', 'pay_23', 'valor_centavos', 40000,
  'vencimento', (now() at time zone 'America/Sao_Paulo')::date, 'metodo', 'pix', 'link', 'x'));
select is((select valor_centavos from public.comissoes c join public.afiliados f on f.id = c.afiliado_id
            where f.codigo = 'LUCIANA20'),
          8000, 'Comissao de 20% sobre o valor pago com desconto');

-- 11: desconto acima de 50% e recusado no cadastro
select throws_ok($$insert into public.afiliados (codigo, nome, email, desconto_pct)
                   values ('ABUSO60', 'Abuso', 'a@b.com', 60)$$,
                 '23514', null, 'Desconto do afiliado limitado a 50%');

select * from finish();
rollback;