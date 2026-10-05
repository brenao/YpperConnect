-- Projetos (P1): estrutura por empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ea', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000000eb', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa14', '00000000-0000-0000-0000-0000000000ea') as alfa,
       app.provisionar_tenant('Beta', 'beta14', '00000000-0000-0000-0000-0000000000eb') as beta;
grant select on t to authenticated;

-- 1
select is((select valor from public.configuracoes c, t where c.tenant_id = t.alfa
            and c.chave = 'priorizacao_modelo'), 'simples',
          'Empresa nasce com o modelo de pontuacao do backlog');

-- 2
select throws_ok(
  format($$insert into public.projetos (tenant_id, nome, inicio, fim, gerente_id)
           values (%L, 'X', '2026-01-01', '2026-02-01', '00000000-0000-0000-0000-0000000000eb')$$,
         (select alfa from t)),
  '23503', null, 'Gerente precisa ser da mesma empresa');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ea","role":"authenticated"}', true);

create temp table p (id uuid);
grant all on p to authenticated;

with novo as (
  insert into public.projetos (tenant_id, nome, inicio, fim, gerente_id)
  select alfa, 'Migracao ERP', '2026-01-05', '2026-03-31', '00000000-0000-0000-0000-0000000000ea' from t
  returning id)
insert into p select id from novo;

-- 3
select is((select count(*) from public.projetos)::int, 1, 'Equipe cria projeto na propria empresa');

insert into public.projeto_tarefas (tenant_id, projeto_id, nome, inicio, fim)
select alfa, (select id from p), 'Levantamento', '2026-01-05', '2026-01-16' from t;
insert into public.projeto_tarefas (tenant_id, projeto_id, nome, inicio, fim)
select alfa, (select id from p), 'Implantacao', '2026-01-19', '2026-02-27' from t;

insert into public.tarefa_predecessoras (tenant_id, tarefa_id, predecessora_id, tipo, defasagem)
select alfa, (select id from public.projeto_tarefas where nome = 'Implantacao'),
       (select id from public.projeto_tarefas where nome = 'Levantamento'), 'TI', 2 from t;

-- 4
select is((select tipo || '+' || defasagem from public.tarefa_predecessoras), 'TI+2',
          'Dependencia com tipo e defasagem');

-- 5
select lives_ok($$delete from public.tarefa_predecessoras$$, 'Dependencia (vinculo) pode ser removida');

-- 6
select ok(exists(select 1 from public.auditoria where tabela = 'tarefa_predecessoras' and operacao = 'DELETE'),
          'Remocao de vinculo fica na auditoria');

-- 7
delete from public.projeto_tarefas;
select is((select count(*) from public.projeto_tarefas)::int, 2, 'Tarefa nao se apaga fisicamente');

select public.excluir_projeto((select id from p));

-- 8
select is_empty($$select 1 from public.projetos$$, 'Projeto excluido (logico) some da lista');

-- 9
insert into public.usuario_preferencias (usuario_id, chave, valor)
values ('00000000-0000-0000-0000-0000000000ea', 'gantt.colunas', '{"nome": 240}');
select is((select valor->>'nome' from public.usuario_preferencias), '240', 'Preferencia propria gravada');

-- Beto (outra empresa)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000eb","role":"authenticated"}', true);

-- 10
select is_empty($$select 1 from public.projeto_tarefas union all select 1 from public.usuario_preferencias$$,
                'Outra empresa nao ve tarefas nem preferencias alheias');

select * from finish();
rollback;