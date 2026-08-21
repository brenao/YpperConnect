# YpperConnect

Ferramenta de ITSM e gestão de projetos da TI do Grupo Rosset. TanStack Start
(SSR) + React 19 + PostgreSQL 18. Publicada sob `/ypper` no servidor de teste,
atrás do OpenResty do rosset16.

Repositório `gruporosset/Rosset.Ypper.Tool`, branch de trabalho `develop`. O
Jenkins publica no servidor de teste a cada commit, então `develop` precisa
ficar sempre em estado funcional.

## Comandos

```sh
npm run dev         # servidor local
npm run typecheck   # tsc --noEmit — rodar a cada mudança
npm run lint        # eslint
npm run check       # typecheck + lint
npm run build       # obrigatório antes de commitar (ver "vazamento do driver")
```

`node db/check-postgres.mjs` testa a conexão antes de subir o app.

## Armadilhas que já custaram caro

**O driver do banco não pode entrar no bundle do navegador.** Telas só importam
repositórios com `import type`. Um `import` normal arrasta o `pg` para o
bundle, as credenciais vazam e o build quebra — e **só o build de produção
acusa**, `npm run dev` passa liso. Daí `npm run build` antes de commitar.

**Aspas no `.env` quebram só dentro do container.** `node --env-file` remove as
aspas ao redor do valor; `docker --env-file` não remove. A mesma linha
`PG_PASSWORD="senha"` funciona na máquina do dev e falha no container com
"password authentication failed". O `client.server.ts` avisa quando detecta.

**Datas são `TIMESTAMP` sem fuso, e a sessão fixa `America/Sao_Paulo`.** O que
o banco grava em `LOCALTIMESTAMP` depende do fuso da sessão: se ela abrir em
UTC, todo prazo de SLA nasce 3 horas adiantado. Não trocar para `TIMESTAMPTZ`
sem revisar o cálculo de SLA.

**Booleano é `SMALLINT` 0/1, não `BOOLEAN`.** Herança do Oracle, mantida de
propósito: dezenas de consultas usam `WHERE ativo = 1`, e trocar agora somaria
dois riscos no mesmo passo. Use `deBool`/`paraBool` de `repositories/tipos.ts`.

**String vazia não é nulo.** No Oracle era; no Postgres `''` é valor. A camada
de acesso converte `''` para `NULL` antes do insert — sem isso, coluna
`NOT NULL` passaria a aceitar `''` sem erro nenhum.

**Genérico composto em chamada de função precisa de tipo nomeado.** O parser do
Rolldown lê `consultar<Omit<X, "y"> & { y: number }>(...)` como comparações e
falha com "Parenthesized expressions may not have a trailing comma". O `tsc`
aceita; só o `npm run build` acusa.

**Nada é excluído, só desativado.** Toda tabela tem `ativo`. Não escreva
`DELETE` — com a exceção conhecida de `excluirTarefa`, que ainda é exclusão
real e está na lista de correções.

**Radix não aceita `SelectItem` com `value=""`.** Use uma constante sentinela
(o padrão do projeto é `const SEM = "__nenhum__"`) e converta para `null` ao
salvar.

**O tsconfig é estrito além do normal:** `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, `noUncheckedIndexedAccess`. Na prática:
propriedade opcional precisa de `| undefined` explícito no tipo, acesso a
índice devolve `T | undefined`, e `obj.chave` vira `obj["chave"]` quando o
tipo é um index signature.

## Onde as coisas ficam

Ver `src/ARCHITECTURE.md` para as camadas, `src/routes/README.md` para as
convenções de roteamento e `deploy/README.md` para o deploy e o prefixo
`/ypper`.

## Estado atual

Migração para o PostgreSQL 18 concluída. Funcionando: chamados com código
(`INC-1000`), auditoria por campo, SLA (P1 em 24×7, demais em horário comercial
com feriados) e atribuição automática pelo cadastro do sistema; catálogo,
sistemas, perfis, administração, fila de e-mail, painel, governança, diretoria,
recursos, conhecimento; e projetos com WBS, rollup, CPM, baseline versionada,
Gantt, grade de tarefas editável e instrutor de IA do PMI.

Pendente:

- **Agendador dos lembretes de projeto.** `gerarLembretesProjeto` existe e o
  endpoint `/api/rotinas` também, mas nada os chama sozinho. Hoje só pelo botão
  da Administração.
- **Autenticação AD.** `src/services/current-user.server.ts` devolve um usuário
  fixo. O proxy já roda `check-token.lua` e repassa
  `Authorization: Bearer $http_x_authentication_token` — verificar o que esse
  token carrega antes de escrever qualquer coisa.
- **`excluirTarefa` faz `DELETE` real**, em cascata, contrariando a regra de
  desativação. Trocar por `ativo = 0` exige coluna nova em `projeto_tarefas`.
- **Visão de diretoria** com gráfico de projeção, filtros por gerente e
  totalizadores por responsável.
- **Migrations versionadas.** `db/postgres/` são scripts numerados aplicados à
  mão, sem tabela de controle.
- **Relay SMTP** em produção.
- **Testes de ponta a ponta:** não existem, e não há nenhuma dependência de
  teste no `package.json`.

## Convenções

- Código, comentários e identificadores em português. Tipos e componentes do
  domínio também (`Chamado`, `TarefaCalculada`, `LinhaCronograma`).
- Comentário explica **por quê**, não o quê. Se o código já diz o que faz, o
  comentário só entra quando houver uma decisão não óbvia a registrar.
- `src/routeTree.gen.ts` é gerado. Não editar.
- Arquivos com fim de linha LF. O `.gitattributes` força isso; no VS Code,
  ajuste `files.eol` para `\n`.
- Não reescrever histórico já publicado (`push --force`, rebase ou squash de
  commits que já foram para o remoto).