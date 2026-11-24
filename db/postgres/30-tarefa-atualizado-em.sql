-- Quando alguém mexeu na tarefa pela última vez.
--
-- O indicador "sem acompanhamento" olhava só projeto_atualizacoes, a
-- tabela do texto semanal. O efeito era um gerente lançando progresso a
-- semana inteira e vendo o projeto marcado como abandonado — o alerta
-- dizia "ninguém escreveu", mas quem lê entende "ninguém entrou aqui".
--
-- Para o indicador passar a significar o que as pessoas leem nele,
-- falta saber quando a tarefa mudou. `concluido_em` não serve: marca o
-- fechamento, não a edição.
--
-- O default retroage para a criação do projeto, e não para agora: dar
-- LOCALTIMESTAMP a todas zeraria o relógio de toda a carteira de uma
-- vez, e projeto de fato abandonado apareceria em dia na manhã
-- seguinte.
ALTER TABLE projeto_tarefas
  ADD COLUMN atualizado_em TIMESTAMP;

UPDATE projeto_tarefas t
   SET atualizado_em = COALESCE(
         t.concluido_em,
         (SELECT p.criado_em FROM projetos p WHERE p.id = t.projeto_id)
       );

ALTER TABLE projeto_tarefas
  ALTER COLUMN atualizado_em SET DEFAULT LOCALTIMESTAMP;

-- O índice serve ao MAX(atualizado_em) por projeto, que passa a rodar
-- em toda listagem de carteira.
CREATE INDEX IF NOT EXISTS ix_tarefas_projeto_atualizado
  ON projeto_tarefas (projeto_id, atualizado_em DESC);