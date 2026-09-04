-- =====================================================================
-- Limpeza dos dados de teste: projetos, tarefas e chamados
--
-- Apaga o movimento e PRESERVA o cadastro: usuarios, perfis, equipes,
-- recursos, servicos, sistemas, categorias, artigos, expediente e
-- feriados continuam intactos.
--
-- NAO e uma migration. Nao entra em db_migrations, e pode ser rodado
-- quantas vezes for preciso.
--
-- ATENCAO: nao ha desfazer. Confirme que esta apontando para o banco de
-- TESTE antes de rodar. A primeira consulta imprime host e banco
-- justamente para isso.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/limpar-dados-teste.sql
-- =====================================================================

SET ROLE ypper;

-- Onde estamos. Se isto nao for o servidor de teste, interrompa aqui.
SELECT current_database() AS banco,
       inet_server_addr()  AS host,
       (SELECT COUNT(*) FROM projetos)::int AS projetos_antes,
       (SELECT COUNT(*) FROM chamados)::int AS chamados_antes;


-- ---------------------------------------------------------------------
-- 1. Notificacoes
--
-- Vem primeiro porque `referencia_id` aponta para chamado ou projeto
-- SEM chave estrangeira: o banco nao impede que sobrem apontando para
-- linhas que nao existem mais, e essas orfas atrapalhariam o controle
-- de "ja avisei hoje" do lembrete de projeto.
-- ---------------------------------------------------------------------
DELETE FROM notificacoes
 WHERE referencia_tipo IN ('chamado', 'projeto');


-- ---------------------------------------------------------------------
-- 2. Chamados
--
-- `problema_vinculado_id` e auto-referencia SEM cascade: um chamado
-- aponta para o problema que o originou. Zerar antes evita o erro de
-- violacao de chave ao apagar o problema que ainda tem filhos.
--
-- Interacoes e historico caem por ON DELETE CASCADE.
-- ---------------------------------------------------------------------
UPDATE chamados SET problema_vinculado_id = NULL;

DELETE FROM chamados;

-- O numero do chamado e IDENTITY e continuaria de onde parou. Numa base
-- de teste zerada, o proximo chamado deve ser o 1000 de novo — senao os
-- codigos comecam em CHM-1043 e ninguem entende por que.
ALTER TABLE chamados ALTER COLUMN numero RESTART WITH 1000;


-- ---------------------------------------------------------------------
-- 3. Projetos
--
-- `tarefa_predecessoras` tem DUAS chaves estrangeiras para
-- `projeto_tarefas`: a do lado da tarefa cai por cascade, a do lado da
-- predecessora NÃO. Apagar a tarefa que é predecessora de outra
-- esbarraria em `fk_tpred_pred`, e é por isso que os vínculos saem
-- primeiro, à mão.
--
-- O resto cai sozinho: tarefas, riscos, atenções, atualizações e
-- baselines têm ON DELETE CASCADE a partir de `projetos`.
-- ---------------------------------------------------------------------
DELETE FROM tarefa_predecessoras;
DELETE FROM tarefa_responsaveis;

DELETE FROM projetos;