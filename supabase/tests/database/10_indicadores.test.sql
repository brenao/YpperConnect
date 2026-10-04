-- Indicadores de chamados por empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000000ab', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa10', '00000000-0000-0000-0000-0000000000aa') as alfa,
       app.provisionar_tenant('Beta', 'beta10', '00000000-0000-0000-0000-0000000000ab') as beta;
grant select on t to authenticated;

-- Alfa: 2 abertos (1 P1 vencido) e 1 resolvido. Beta: 1 aberto.
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade, solicitante_id, origem, prazo_sla, status, resolvido_em)
select alfa, 'INC', 'x', 'x', 'incidente', 'alto', 'alta', 'P1',
       '00000000-0000-0000-0000-0000000000aa', 'portal', now() - interval '1 hour', 'novo', null from t;
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade, solicitante_id, origem, prazo_sla, status, resolvido_em)
select alfa, 'REQ', 'x', 'x', 'requisicao', 'alto', 'alta', 'P4',
       '00000000-0000-0000-0000-0000000000aa', 'portal', now() + interval '1 day', 'novo', null from t;
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade, solicitante_id, origem, prazo_sla, status, resolvido_em)
select alfa, 'REQ', 'x', 'x', 'requisicao', 'alto', 'alta', 'P4',
       '00000000-0000-0000-0000-0000000000aa', 'portal', now() + interval '1 day', 'resolvido', now() from t;
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade, solicitante_id, origem, prazo_sla, status, resolvido_em)
select beta, 'INC', 'x', 'x', 'incidente', 'alto', 'alta', 'P1',
       '00000000-0000-0000-0000-0000000000ab', 'portal', now(), 'novo', null from t;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- 1
select is(public.ind_resumo_chamados((select alfa from t)),
          '{"total": 3, "abertos": 2, "criticos": 1, "vencidos": 1, "com_problema": 0}'::jsonb,
          'Resumo conta so a propria empresa');

-- 2
select is((select count(*) from public.ind_volume_7_dias((select alfa from t)))::int, 7,
          'Volume traz os 7 dias, inclusive os vazios');

-- 3
select is((select sum(requisicoes) from public.ind_volume_7_dias((select alfa from t)))::int, 2,
          'Volume conta os chamados de hoje');

-- 4
select is((select criados from public.ind_serie_criados_atendidos(
            (select alfa from t), (now() at time zone 'America/Sao_Paulo')::date, 1))::int, 3,
          'Serie conta criados sem multiplicar pelos atendidos');

-- 5
select is((public.ind_metricas_chamados((select alfa from t), null, null)->>'dentro_sla')::int, 1,
          'Metricas: resolvido dentro do prazo');

-- 6
select is(public.ind_resumo_chamados((select beta from t))->>'total', '0',
          'Nao enxerga os chamados de outra empresa');

select * from finish();
rollback;