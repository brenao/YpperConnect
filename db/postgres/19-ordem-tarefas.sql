-- =====================================================================
-- 19 - Ordem das tarefas de projeto
--
-- `projeto_tarefas.ordem` nasceu com valor 0 em tudo o que foi criado
-- pelo formulario: `criarTarefa` gravava `d.ordem ?? 0`, e a tela nunca
-- informava o campo. Duas consequencias:
--
--   1. O `inserirAbaixo` (o Enter da grade) faz
--      `UPDATE ... WHERE ordem > :ordem` para abrir espaco. Com tudo em
--      zero, esse UPDATE nao empurra ninguem, e a tarefa nova aparece
--      no fim da lista em vez de logo abaixo da linha de origem.
--
--   2. Qualquer reordenacao — arrastar e soltar, mover para cima —
--      depende dessa coluna e nao teria como funcionar.
--
-- O QUE ESTA MIGRATION FAZ
--   Numera as tarefas de cada projeto de 1 em diante, na MESMA ordem em
--   que a tela ja as mostra hoje. O cronograma continua identico depois
--   de aplicada: ninguem ve uma tarefa mudar de lugar.
--
-- A ORDEM ESCOLHIDA
--   Pela arvore da WBS: cada tarefa mae vem seguida das proprias filhas,
--   e so entao a proxima raiz. E como a grade desenha a hierarquia, e e
--   o que faz a numeracao sequencial significar alguma coisa — filha
--   separada da mae por causa de uma data seria um numero no meio do
--   nada.
--
--   Dentro de cada nivel, o desempate e `ordem` e depois `inicio`. O
--   `ordem` vem primeiro de proposito: se alguma tarefa em producao ja
--   tiver valor diferente de zero — a criada pelo Enter tem —, a
--   posicao relativa dela e preservada. Quem esta em zero cai no
--   desempate por data, que e exatamente o criterio que a tela usa
--   hoje.
--
--   A numeracao e GLOBAL no projeto, nao por nivel. A predecessora e
--   digitada pelo numero da linha, e renumerar por nivel faria quem
--   digitou "7" passar a apontar para outra tarefa.
--
-- Tarefas inativas entram na numeracao. Elas somem da grade, mas
-- continuam no banco por causa das baselines, e deixa-las fora abriria
-- buracos se alguem reativar uma.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/19-ordem-tarefas.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- Numeracao pela arvore
--
-- A recursiva monta um caminho ordenavel: cada nivel acrescenta a
-- posicao da tarefa dentro dos irmaos dela, com zeros a esquerda para
-- ordenar como texto. Assim "001" < "001.002" < "002", que e a leitura
-- em profundidade que a WBS precisa.
--
-- O teto de 10 niveis e guarda contra ciclo em `pai_id`: o banco so
-- impede a auto-referencia, e dado antigo pode ter uma volta que
-- deixaria a recursiva sem fim.
-- ---------------------------------------------------------------------

WITH RECURSIVE irmaos AS (
    SELECT t.id,
           t.projeto_id,
           t.pai_id,
           ROW_NUMBER() OVER (
               PARTITION BY t.projeto_id, t.pai_id
               ORDER BY t.ordem, t.inicio, t.id
           ) AS posicao
      FROM projeto_tarefas t
),
arvore AS (
    SELECT i.id,
           i.projeto_id,
           LPAD(i.posicao::text, 4, '0') AS caminho,
           1 AS nivel
      FROM irmaos i
     WHERE i.pai_id IS NULL

    UNION ALL

    SELECT f.id,
           f.projeto_id,
           a.caminho || '.' || LPAD(f.posicao::text, 4, '0'),
           a.nivel + 1
      FROM irmaos f
      JOIN arvore a ON f.pai_id = a.id
     WHERE a.nivel < 10
),
numerada AS (
    SELECT a.id,
           ROW_NUMBER() OVER (
               PARTITION BY a.projeto_id ORDER BY a.caminho
           ) AS nova_ordem
      FROM arvore a
)
UPDATE projeto_tarefas t
   SET ordem = n.nova_ordem
  FROM numerada n
 WHERE t.id = n.id
   AND t.ordem IS DISTINCT FROM n.nova_ordem;

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('19-ordem-tarefas.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;

-- ---------------------------------------------------------------------
-- Conferencia depois de aplicar
--
-- Nenhum projeto deve ter numero repetido nem buraco:
--
--   SELECT p.nome,
--          COUNT(*)                AS tarefas,
--          COUNT(DISTINCT t.ordem) AS ordens_distintas,
--          MIN(t.ordem)            AS menor,
--          MAX(t.ordem)            AS maior
--     FROM projeto_tarefas t
--     JOIN projetos p ON p.id = t.projeto_id
--    GROUP BY p.nome
--    ORDER BY p.nome;
--
-- `tarefas` = `ordens_distintas`, `menor` = 1 e `maior` = `tarefas`.
-- ---------------------------------------------------------------------