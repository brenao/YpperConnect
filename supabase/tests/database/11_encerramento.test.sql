-- Encerramento pelo solicitante, fechamento automatico e tipo de sistema.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ba', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000000bb', 'caio@alfa.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa11', '00000000-0000-0000-0000-0000000000ba') as alfa;
grant select on t to authenticated;
insert into public.tenant_membros (tenant_id, usuario_id, tipo)
select alfa, '00000000-0000-0000-0000-0000000000bb', 'interno' from t;

-- Tres chamados resolvidos, abertos pelo Caio: um agora, um ha 10 dias, um para reabrir.
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade,
       solicitante_id, origem, prazo_sla, status, resolvido_em)
select alfa, 'REQ', 'agora', 'x', 'requisicao', 'baixo', 'baixa', 'P4',
       '00000000-0000-0000-0000-0000000000bb', 'portal', now() + interval '1 day', 'resolvido', now() from t;
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade,
       solicitante_id, origem, prazo_sla, status, resolvido_em)
select alfa, 'REQ', 'antigo', 'x', 'requisicao', 'baixo', 'baixa', 'P4',
       '00000000-0000-0000-0000-0000000000bb', 'portal', now(), 'resolvido', now() - interval '10 days' from t;
insert into public.chamados (tenant_id, prefixo, titulo, descricao, tipo, impacto, urgencia, prioridade,
       solicitante_id, origem, prazo_sla, status, resolvido_em)
select alfa, 'REQ', 'reabrir', 'x', 'requisicao', 'baixo', 'baixa', 'P4',
       '00000000-0000-0000-0000-0000000000bb', 'portal', now() + interval '1 day', 'resolvido', now() from t;

create temp table ids as
select (select id from public.chamados where titulo = 'agora') as agora,
       (select id from public.chamados where titulo = 'antigo') as antigo,
       (select id from public.chamados where titulo = 'reabrir') as reabrir;
grant select on ids to authenticated;

-- 1
select is(app.dias_uteis_entre((select alfa from t), '2026-10-02', '2026-10-05'), 1,
          'Sexta para segunda: um dia util (fim de semana nao conta)');

-- 2
select is(app.dias_uteis_entre((select alfa from t), '2026-11-19', '2026-11-23'), 1,
          'Feriado nacional (20/11) nao conta como dia util');

-- 3
select is(public.fechar_chamados_resolvidos(), 1, 'Fecha so o resolvido ha mais de 3 dias uteis');

-- 4
select is((select status from public.chamados where id = (select agora from ids)), 'resolvido',
          'Resolvido agora continua aguardando confirmacao');

set local role authenticated;

-- Ana (admin, mas nao e a solicitante)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ba","role":"authenticated"}', true);

-- 5
select throws_ok($$select public.confirmar_solucao((select agora from ids), true, null)$$,
                 '42501', null, 'So o solicitante confirma a solucao');

-- Caio (solicitante)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

select public.confirmar_solucao((select agora from ids), true, null);

-- 6
select is((select status from public.chamados where id = (select agora from ids)), 'fechado',
          'Solicitante confirma e fecha');

-- 7
select throws_ok($$select public.confirmar_solucao((select reabrir from ids), false, '  ')$$,
                 'P0001', null, 'Reabrir exige motivo');

select public.confirmar_solucao((select reabrir from ids), false, 'Continua sem acesso');

-- 8
select is((select status from public.chamados where id = (select reabrir from ids)), 'em_andamento',
          'Solicitante reabre com motivo');

reset role;

-- 9
select is((select tipo from public.sistemas s, t where s.tenant_id = t.alfa and s.nome = 'Rede e Wi-Fi'),
          'infraestrutura', 'Sistema de infraestrutura nasce com o tipo certo');

select * from finish();
rollback;