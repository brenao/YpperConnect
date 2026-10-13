-- Término combinado: a data manda, o esforço se ajusta.
--
-- O início já tinha `restricao_inicio` para registrar "esta data foi
-- decidida por alguém". O término não tinha equivalente, e sem isso
-- não há como saber se a data final é uma combinação a respeitar ou o
-- resultado de um cálculo que pode ser refeito.
--
-- A diferença importa quando o responsável muda. Quem rende 4h/dia
-- leva o dobro do tempo de quem rende 8h. Com o término livre, a data
-- anda e o esforço se mantém — foi estimado por alguém. Com o término
-- fixado, a data fica e o esforço é que se recalcula: é o que cabe
-- naquele intervalo para aquela pessoa.
--
-- Sem a coluna, recalcular o esforço ao trocar o responsável apagaria
-- estimativas humanas em silêncio — 40h viram 20h sem ninguém pedir.
--
-- O padrão é 0: tarefa que já existe teve o término calculado ou foi
-- criada antes desta distinção, e assumir "combinado" para todas elas
-- congelaria datas que hoje andam com as dependências.

ALTER TABLE projeto_tarefas
  ADD COLUMN IF NOT EXISTS fim_fixado SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN projeto_tarefas.fim_fixado IS
  'A data de término foi digitada, não calculada. O esforço passa a ser derivado do intervalo e da capacidade de quem executa.';