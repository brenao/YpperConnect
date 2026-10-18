-- Parametros comerciais, cupom por prazo (nao cumulativo) e split.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

create temp table hoje as select (now() at time zone 'America/Sao_Paulo')::date as d;
grant select on hoje to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000024a1', 'operador@beagle.com'),
  ('00000000-0000-0000-0000-0000000024a2', 'cliente1@x.com'),
  ('00000000-0000-0000-0000-0000000024a3', 'cliente2@x.com'),
  ('00000000-0000-0000-0000-0000000024a4', 'ana@parceira.com');
insert into public.plataforma_admins (usuario_id) values ('00000000-0000-0000-0000-0000000024a1');

insert into public.afiliados (codigo, nome, email, tipo, comissao_pct, desconto_pct, usuario_id) values
  ('ANA30', 'Ana Souza', 'ana@parceira.com', 'parceiro', 30, 30, '00000000-0000-0000-0000-0000000024a4'),
  ('BETO10', 'Beto Lima', 'beto@parceiro.com', 'afiliado', 20, 10, null);

-- 1: preco anual vem dos dias gratis (60 por padrao)
select is((select preco_anual_centavos from public.planos where codigo = 'itsm_pro'), 9900,
          'Anual do ITSM Pro com 60 dias gratis: R$ 99');

-- 2: operador altera os parametros e o preco anual acompanha
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000024a1","role":"authenticated"}', true);
select public.salvar_parametros_comerciais(30, 90, 50, 12);
select is((select preco_anual_centavos from public.planos where codigo = 'itsm_pro'),
          (round(11900 * 275 / 365.0 / 100) * 100)::int, 'Com 90 dias gratis o anual e recalculado');

-- 3: dias de teste pelo parametro
create temp table t1 as
select public.checkout_criar_empresa('Um', 'um-24', '00000000-0000-0000-0000-0000000024a2',
                                     'itsm_pro', 'anual', 5, false, null, 'BETO10') as tid;
select is((select teste_ate from public.assinaturas a, t1 where a.tenant_id = t1.tid),
          (select d + 30 from hoje), 'Teste da empresa nova pelo parametro (30 dias)');

-- 4: prazo do desconto = fim do teste + 12 meses
select is((select desconto_ate from public.assinaturas a, t1 where a.tenant_id = t1.tid),
          (select (d + 30 + interval '12 months')::date from hoje), 'Cupom vale 12 meses depois do teste');

-- 5: nao cumulativo, cupom menor que o anual: vale o anual
select is((select public.valor_mensal_assinatura(a.id) from public.assinaturas a, t1 where a.tenant_id = t1.tid),
          (select 5 * preco_anual_centavos from public.planos where codigo = 'itsm_pro'),
          'Anual com cupom de 10%: vale o desconto do anual (maior)');

-- 6: nao cumulativo, cupom maior que o anual: vale o cupom
create temp table t2 as
select public.checkout_criar_empresa('Dois', 'dois-24', '00000000-0000-0000-0000-0000000024a3',
                                     'itsm_pro', 'anual', 5, false, null, 'ANA30') as tid;
select is((select public.valor_mensal_assinatura(a.id) from public.assinaturas a, t2 where a.tenant_id = t2.tid),
          (round(5 * 11900 * 0.70))::int, 'Anual com cupom de 30%: vale o cupom, sem somar ao anual');

-- 7: cupom vencido deixa de valer
update public.assinaturas a set desconto_ate = (select d from hoje) from t2 where a.tenant_id = t2.tid;
select is((select public.valor_mensal_assinatura(a.id) from public.assinaturas a, t2 where a.tenant_id = t2.tid),
          (select 5 * preco_anual_centavos from public.planos where codigo = 'itsm_pro'),
          'Depois do prazo, volta o desconto do anual');
update public.assinaturas a set desconto_ate = (select d + 365 from hoje) from t2 where a.tenant_id = t2.tid;

-- 8 e 9: carteira do afiliado (pelo proprio afiliado)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000024a4","role":"authenticated"}', true);
select throws_ok($$select public.salvar_carteira_afiliado('nao-e-carteira')$$, '22023', null,
                 'Carteira com formato invalido e recusada');
select lives_ok($$select public.salvar_carteira_afiliado('0E1F2A3B-4C5D-6E7F-8091-a2b3c4d5e6f7')$$,
                'Afiliado informa a carteira do Asaas');

-- 10 e 11: estado desejado no gateway com split
select public.vincular_gateway((select tid from t2), 'asaas', 'cus_24', 'sub_24');
select is((select split_carteira || '|' || split_pct || '|' || mudou
             from public.estado_gateway_desejado((select a.id from public.assinaturas a, t2 where a.tenant_id = t2.tid))),
          '0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7|30.00|true', 'Assinatura do parceiro deve ter split de 30%');
select public.registrar_estado_gateway(e.assinatura_id, e.valor_ciclo_centavos, e.split_carteira, e.split_pct)
  from public.estado_gateway_desejado((select a.id from public.assinaturas a, t2 where a.tenant_id = t2.tid)) e;
select is((select mudou from public.estado_gateway_desejado((select a.id from public.assinaturas a, t2 where a.tenant_id = t2.tid))),
          false, 'Depois de sincronizar, nada a fazer');

-- 12: comissao paga pelo split nasce paga
select public.processar_evento_gateway('asaas', 'evt_24', 'pagamento_confirmado', jsonb_build_object(
  'assinatura', 'sub_24', 'fatura', 'pay_24', 'valor_centavos', 100000,
  'vencimento', (select d from hoje), 'metodo', 'pix', 'link', 'x'));
select is((select status || '|' || via_split || '|' || valor_centavos from public.comissoes c
             join public.afiliados f on f.id = c.afiliado_id where f.codigo = 'ANA30'),
          'paga|true|30000', 'Com split, a comissao ja nasce paga');

-- 13: fim da recorrencia tira o split
update public.assinaturas a set atribuido_em = now() - interval '13 months' from t2 where a.tenant_id = t2.tid;
select ok((select split_carteira is null and mudou
             from public.estado_gateway_desejado((select a.id from public.assinaturas a, t2 where a.tenant_id = t2.tid))),
          'Passados os meses de comissao, o split deve sair');

-- 14: desconto acima do maximo e recusado
select throws_ok($$update public.afiliados set desconto_pct = 60 where codigo = 'BETO10'$$, '23514', null,
                 'Desconto do cupom limitado pelo parametro');

-- 15: operador nao baixa o maximo abaixo de afiliado ativo
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000024a1","role":"authenticated"}', true);
select throws_ok($$select public.salvar_parametros_comerciais(14, 60, 20, 12)$$, 'P0001', null,
                 'Maximo menor que o desconto de afiliado ativo e recusado');

-- 16: desempenho por afiliado
select is((select ativas::text || '|' || em_teste::text || '|' || tem_carteira::text
             from public.desempenho_afiliados() d join public.afiliados f on f.id = d.afiliado_id
            where f.codigo = 'ANA30'),
          '1|0|true', 'Painel do operador mostra as vendas do afiliado');

-- 17: portal do afiliado mostra vendas e carteira
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000024a4","role":"authenticated"}', true);
select is((select (j->'vendas'->>'ativas') || '|' || (j->>'carteira') from (select public.meu_portal_afiliado() as j) x),
          '1|0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7', 'Portal mostra vendas ativas e a carteira');

select * from finish();
rollback;