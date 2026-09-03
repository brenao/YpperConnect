-- =====================================================================
-- Feriados nacionais
--
-- A tabela alimenta o cálculo de SLA e, agora, o cronograma em dias
-- úteis. Estava vazia — o que significa que 7 de setembro vinha sendo
-- tratado como dia normal. Num prazo de horas o erro passa
-- despercebido; num cronograma de semanas, acumula e fica visível.
--
-- FIXOS entram como recorrentes: o ano gravado é irrelevante, a busca
-- casa por mês e dia. MÓVEIS dependem da Páscoa e precisam de uma linha
-- por ano — estão aqui até 2028.
--
-- SÓ NACIONAIS. A coluna `tipo` aceita estadual e municipal, mas o
-- cálculo não distingue: o que estiver ativo vale para a empresa
-- inteira. Como há unidades em cidades diferentes, cadastrar um
-- municipal aqui pararia o cronograma de todas. Resolver isso exige
-- saber a que cidade cada projeto pertence — dado que não existe hoje.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/07-feriados.sql
-- =====================================================================

SET ROLE ypper;

-- Fixos. O ano 2000 é só marcador: `recorrente = 1` faz a busca usar
-- as colunas geradas `mes` e `dia`.
INSERT INTO feriados (id, data_feriado, descricao, tipo, recorrente, ativo) VALUES
  (gen_random_uuid(), DATE '2000-01-01', 'Confraternização Universal', 'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-04-21', 'Tiradentes',                 'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-05-01', 'Dia do Trabalho',            'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-09-07', 'Independência',              'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-10-12', 'Nossa Senhora Aparecida',    'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-11-02', 'Finados',                    'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-11-15', 'Proclamação da República',   'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-11-20', 'Consciência Negra',          'nacional', 1, 1),
  (gen_random_uuid(), DATE '2000-12-25', 'Natal',                      'nacional', 1, 1)
ON CONFLICT (data_feriado) DO NOTHING;

-- Móveis: uma linha por ano.
INSERT INTO feriados (id, data_feriado, descricao, tipo, recorrente, ativo) VALUES
  (gen_random_uuid(), DATE '2026-02-16', 'Carnaval',          'nacional', 0, 1),
  (gen_random_uuid(), DATE '2026-02-17', 'Carnaval',          'nacional', 0, 1),
  (gen_random_uuid(), DATE '2026-04-03', 'Sexta-feira Santa', 'nacional', 0, 1),
  (gen_random_uuid(), DATE '2026-06-04', 'Corpus Christi',    'nacional', 0, 1),

  (gen_random_uuid(), DATE '2027-02-08', 'Carnaval',          'nacional', 0, 1),
  (gen_random_uuid(), DATE '2027-02-09', 'Carnaval',          'nacional', 0, 1),
  (gen_random_uuid(), DATE '2027-03-26', 'Sexta-feira Santa', 'nacional', 0, 1),
  (gen_random_uuid(), DATE '2027-05-27', 'Corpus Christi',    'nacional', 0, 1),

  (gen_random_uuid(), DATE '2028-02-28', 'Carnaval',          'nacional', 0, 1),
  (gen_random_uuid(), DATE '2028-02-29', 'Carnaval',          'nacional', 0, 1),
  (gen_random_uuid(), DATE '2028-04-14', 'Sexta-feira Santa', 'nacional', 0, 1),
  (gen_random_uuid(), DATE '2028-06-15', 'Corpus Christi',    'nacional', 0, 1)
ON CONFLICT (data_feriado) DO NOTHING;

INSERT INTO db_migrations (arquivo) VALUES ('07-feriados.sql')
ON CONFLICT (arquivo) DO NOTHING;