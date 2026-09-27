-- Chamados: numeracao por empresa, isolamento, imutabilidade e vinculos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000007a', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-00000000007b', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa7', '00000000-0000-0000-0000-00000000007a') as alfa,
       app.provisionar_tenant('Beta', 'beta7', '00000000-0000-0000-0000-00000000007b') as beta;
grant select on t to authenticated;

create temp table erp as
select s.id from public.sistemas s, t where s.tenant_id = t.alfa and s.nome = 'ERP';
grant select on erp to authenticated;

-- Um chamado em cada empresa (como postgres)
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia,
                             prioridade, solicitante_id, origem, prazo_sla, sistema_id)
select alfa, 'INC', 'ERP fora', 'Nao abre', 'incidente', 'alto', 'alta', 'P1',
       '00000000-0000-0000-0000-00000000007a', 'portal', now() + interval '4 hours',
       (select id from erp) from t;
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia,
                             prioridade, solicitante_id, origem, prazo_sla)
select beta, 'REQ', 'Acesso', 'Pedido', 'requisicao', 'baixo', 'baixa', 'P4',
       '00000000-0000-0000-0000-00000000007b', 'portal', now() + interval '1 day' from t;

-- 1
select is((select codigo from public.chamados c, t where c.tenant_id = t.beta),
          'REQ-1000', 'Cada empresa comeca a numeracao em 1000');

insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia,
                             prioridade, solicitante_id, origem, prazo_sla)
select alfa, 'REQ', 'Mouse', 'Trocar', 'requisicao', 'baixo', 'baixa', 'P4',
       '00000000-0000-0000-0000-00000000007a', 'portal', now() + interval '1 day' from t;

-- 2
select is((select max(numero) from public.chamados c, t where c.tenant_id = t.alfa)::int,
          1001, 'Numeracao segue dentro da empresa');

-- 3
select throws_ok(
  format($$insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto,
           urgencia, prioridade, solicitante_id, origem, prazo_sla)
           values (%L, 'INC', 'x', 'x', 'incidente', 'alto', 'alta', 'P1',
                   '00000000-0000-0000-0000-00000000007a', 'portal', now())$$, (select beta from t)),
  '23503', null, 'Solicitante precisa ser da mesma empresa');

-- 4
select throws_ok($$delete from public.chamados where sistema_id = (select id from erp)$$,
                 '42501', null, 'Chamado nunca e apagado');

insert into public.chamado_interacoes (tenant_id, chamado_id, autor_id, tipo, corpo)
select c.tenant_id, c.id, '00000000-0000-0000-0000-00000000007a', 'comentario', 'Verificando'
  from public.chamados c where c.sistema_id = (select id from erp);

-- 5
select throws_ok($$update public.chamado_interacoes set corpo = 'editado'$$,
                 '42501', null, 'Interacao e imutavel');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000007a","role":"authenticated"}', true);

-- 6
select is((select count(*) from public.chamados)::int, 2, 'Ana ve so os chamados da Alfa');

-- 7
select is(public.vinculos_sistema((select id from erp)),
          '{"chamados": 1, "projetos": 0}'::jsonb, 'Exclusao de sistema passa a contar chamados reais');

-- 8
select throws_ok(
  format($$insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto,
           urgencia, prioridade, solicitante_id, origem, prazo_sla)
           values (%L, 'INC', 'x', 'x', 'incidente', 'alto', 'alta', 'P1',
                   '00000000-0000-0000-0000-00000000007b', 'portal', now())$$, (select beta from t)),
  '42501', null, 'Nao abre chamado em outra empresa');

-- 9
select throws_ok(
  $$insert into public.chamado_interacoes (tenant_id, chamado_id, autor_id, tipo, corpo)
    select c.tenant_id, c.id, '00000000-0000-0000-0000-00000000007b', 'comentario', 'x'
      from public.chamados c limit 1$$,
  '42501', null, 'Interacao so em nome de quem esta logado');

select * from finish();
rollback;
