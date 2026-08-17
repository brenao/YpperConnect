# YpperConnect

Ferramenta de ITSM e gestão de projetos da TI do Grupo Rosset. TanStack Start
(SSR) + React 19 + Oracle 19c, schema `ITIL`. Publicada sob `/ypper` no servidor
de teste, atrás do OpenResty do rosset16.

Repositório `gruporosset/Rosset.Ypper.Tool`, branch de trabalho `develop`. O
Jenkins publica no servidor de teste a cada commit, então `develop` precisa
ficar sempre em estado funcional.

## Comandos

```sh
npm run dev         # servidor local
npm run typecheck   # tsc --noEmit — rodar a cada mudança
npm run lint        # eslint
npm run check       # typecheck + lint
npm run build       # obrigatório antes de commitar (ver "vazamento do Oracle")
```

`npm ci` falha hoje: o `package-lock.json` está fora de sincronia com o
`package.json`. Até isso ser corrigido, use `npm install`.

## Armadilhas que já custaram caro

**Datas são `TIMESTAMP` puro no Oracle.** Nunca use `TIMESTAMP WITH LOCAL TIME
ZONE`: o modo thin do `node-oracledb` ignora o fuso da sessão ao ler esse tipo,
rotula o valor como UTC e desloca todo prazo de SLA em 3 horas. Com `TIMESTAMP`
puro a ida e volta é exata. O container roda com `TZ=America/Sao_Paulo`.

**O cliente Oracle não pode entrar no bundle do navegador.** Telas só importam
repositórios com `import type`. Um `import` normal arrasta o `oracledb` para o
bundle, as credenciais vazam e o build quebra — e **só o build de produção
acusa**, `npm run dev` passa liso. Daí `npm run build` antes de commitar.

**Nada é excluído, só desativado.** Toda tabela tem `ativo`. Não escreva
`DELETE`.

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

Migração do `localStorage` para o Oracle concluída. Funcionando: chamados com
código (`INC-1000`), auditoria por campo e SLA (P1 em 24×7, demais em horário
comercial com feriados), catálogo, sistemas, perfis, administração, fila de
e-mail, painel, governança, diretoria, recursos, conhecimento e projetos com
WBS, rollup, CPM, baseline versionada e Gantt.

Pendente:

- **Autenticação AD.** `src/services/current-user.server.ts` devolve um usuário
  fixo (`LOGIN_PROVISORIO`). O proxy já roda `check-token.lua` e repassa
  `Authorization: Bearer $http_x_authentication_token` — verificar o que esse
  token carrega antes de escrever qualquer coisa.
- **Migrations versionadas.** Hoje `db/oracle/` são scripts numerados aplicados
  à mão, sem tabela de controle.
- **Relay SMTP e agendador da fila de e-mail.**
- **Conta de IA** e a decisão sobre dado de chamado sair da rede.
- **Semáforos de governança:** falta definir cadência de atualização e
  tolerância de atraso.
- **Testes de ponta a ponta:** não existem, e não há nenhuma dependência de
  teste no `package.json`.

## Convenções

- Código, comentários e identificadores em português. Tipos e componentes do
  domínio também (`Chamado`, `TarefaCalculada`, `LinhaCronograma`).
- Comentário explica **por quê**, não o quê. Se o código já diz o que faz, o
  comentário só entra quando houver uma decisão não óbvia a registrar.
- `src/routeTree.gen.ts` é gerado. Não editar.
- Não reescrever histórico já publicado (`push --force`, rebase ou squash de
  commits que já foram para o remoto).