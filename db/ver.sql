SELECT t.id, t.nome, t.pai_id, t.ordem
  FROM projeto_tarefas t
  JOIN projetos p ON p.id = t.projeto_id
 WHERE t.ativo = 1
 ORDER BY p.nome, t.ordem, t.inicio;