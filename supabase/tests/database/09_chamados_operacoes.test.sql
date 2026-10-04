-- Chamados C2: operacoes atomicas e visoes de leitura.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000009a', 'ana@alfa.com', '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000009b', 'beto@beta.com', '{}');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa9', '00000000-0000-0000-0000-00000000009a') as alfa,
       app.provisionar_tenant('Beta', 'beta9', '00000000-0000-0000-0000-00000000009b') as beta;
grant select on t to authenticated;
create temp table r (id uuid);
grant all on r to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000009a","role":"authenticated"}', true);

insert into r
select (public.abrir_chamado(jsonb_build_object(
  'tenant_id', (select alfa from t), 'prefixo', 'INC', 'titulo', 'ERP fora',
  'descricao', 'Nao abre', 'tipo', 'incidente', 'impacto', 'alto', 'urgencia', 'alta',
  'prioridade', 'P1', 'solicitante_id', '00000000-0000-0000-0000-00000000009a',
  'responsavel_id', '00000000-0000-0000-0000-00000000009a',
  'prazo_sla', now() + interval '4 hours', 'resumo_criacao', 'incidente · P1'))->>'id')::uuid;

-- 1
select is((select codigo from public.chamados_v where id = (select id from r)), 'INC-1000',
          'Abre chamado com codigo da empresa');

-- 2
select is((select solicitante_nome from public.chamados_v where id = (select id from r)), 'Ana',
          'Visao traz o nome do solicitante');

-- 3
select is((select count(*) from public.chamado_historico_v where chamado_id = (select id from r))::int, 2,
          'Historico de criacao e de atribuicao gravados juntos');

select public.alterar_chamado((select id from r), '{"status":"em_andamento"}',
  '[{"campo":"status","de":"novo","para":"em_andamento"}]');

-- 4
select is((select status from public.chamados where id = (select id from r)), 'em_andamento',
          'Alteracao aplica o campo enviado');

-- 5
select is((select count(*) from public.chamado_historico where chamado_id = (select id from r))::int, 3,
          'Alteracao gera evento de historico');

select public.registrar_interacao((select id from r), 'comentario', 'Verificando');

-- 6
select ok((select respondido_em is not null from public.chamados where id = (select id from r)),
          'Primeiro comentario marca a resposta');

-- Beto nao altera chamado da Alfa
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000009b","role":"authenticated"}', true);

-- 7
select throws_ok($$select public.alterar_chamado((select id from r), '{"status":"fechado"}', '[]')$$,
                 'P0002', null, 'Outra empresa nao altera o chamado');

select * from finish();
rollback;