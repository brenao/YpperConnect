-- Jornada padrao: seg-sex, 08:00-12:00 e 14:00-18:00 = 8h/dia.
-- Ajuste minuto_ini/minuto_fim se o intervalo de almoco for outro.
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-1-m', 1, 480, 720);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-1-t', 1, 840, 1080);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-2-m', 2, 480, 720);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-2-t', 2, 840, 1080);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-3-m', 3, 480, 720);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-3-t', 3, 840, 1080);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-4-m', 4, 480, 720);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-4-t', 4, 840, 1080);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-5-m', 5, 480, 720);
INSERT INTO expediente (id, dia_semana, minuto_ini, minuto_fim) VALUES ('exp-5-t', 5, 840, 1080);

-- Feriados nacionais de data fixa (recorrente = 1, valem todo ano)
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-0101', DATE '2026-01-01', 'Confraternizacao Universal', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-0421', DATE '2026-04-21', 'Tiradentes', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-0501', DATE '2026-05-01', 'Dia do Trabalho', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-0907', DATE '2026-09-07', 'Independencia do Brasil', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-1012', DATE '2026-10-12', 'Nossa Senhora Aparecida', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-1102', DATE '2026-11-02', 'Finados', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-1115', DATE '2026-11-15', 'Proclamacao da Republica', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-1120', DATE '2026-11-20', 'Consciencia Negra', 1);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-fix-1225', DATE '2026-12-25', 'Natal', 1);

-- Feriados moveis de 2026 (recorrente = 0, cadastrar ano a ano)
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-2026-carn-seg', DATE '2026-02-16', 'Carnaval', 0);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-2026-carn-ter', DATE '2026-02-17', 'Carnaval', 0);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-2026-paixao', DATE '2026-04-03', 'Sexta-feira Santa', 0);
INSERT INTO feriados (id, data_feriado, descricao, recorrente) VALUES
  ('fer-2026-corpus', DATE '2026-06-04', 'Corpus Christi', 0);

COMMIT;