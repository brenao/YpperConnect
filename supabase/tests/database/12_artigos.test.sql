-- Base de conhecimento por empresa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ca', 'ana@alfa.com'),
  ('00000000-0000-0000-0000-0000000000cb', 'caio@alfa.com'),
  ('00000000-0000-0000-0000-0000000000cc', 'beto@beta.com');

create temp table t as
select app.provisionar_tenant('Alfa', 'alfa12', '00000000-0000-0000-0000-0000000000ca') as alfa,
       app.provisionar_tenant('Beta', 'beta12', '00000000-0000-0000-0000-0000000000cc') as beta;
grant select on t to authenticated;
-- Caio: usuario final (sem equipe, sem admin)
insert into public.tenant_membros (tenant_id, usuario_id, tipo)
select alfa, '00000000-0000-0000-0000-0000000000cb', 'interno' from t;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}', true);

-- 1
select lives_ok(
  format($$insert into public.artigos (tenant_id, titulo, conteudo, autor_id, status)
           values (%L, 'Resetar senha', 'Passo a passo para resetar a senha do AD.',
                   '00000000-0000-0000-0000-0000000000ca', 'publicado')$$, (select alfa from t)),
  'TI publica artigo');

select public.registrar_visualizacao_artigo((select id from public.artigos limit 1));

-- 2
select is((select visualizacoes from public.artigos limit 1), 1, 'Visualizacao contada');

-- 3
select is(public.ind_resumo_artigos((select alfa from t)), '{"total": 1, "pendentes": 0}'::jsonb,
          'Resumo da Visao geral conta os artigos');

-- Caio (usuario final)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000cb","role":"authenticated"}', true);

-- 4
select is((select count(*) from public.artigos)::int, 1, 'Usuario final le os artigos da empresa');

-- 5
select throws_ok(
  format($$insert into public.artigos (tenant_id, titulo, conteudo, autor_id)
           values (%L, 'X', 'Conteudo qualquer com tamanho.', '00000000-0000-0000-0000-0000000000cb')$$,
         (select alfa from t)),
  '42501', null, 'Usuario final nao cria artigo');

select public.registrar_visualizacao_artigo((select id from public.artigos limit 1));

-- 6
select is((select visualizacoes from public.artigos limit 1), 2,
          'Usuario final tambem conta visualizacao');

-- Beto (outra empresa)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

-- 7
select is_empty($$select 1 from public.artigos$$, 'Outra empresa nao ve os artigos');

select * from finish();
rollback;