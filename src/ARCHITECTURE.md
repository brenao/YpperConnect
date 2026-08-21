# Arquitetura

Cinco camadas. A regra que sustenta todas: **o driver do banco nunca pode
chegar ao navegador**.

| Camada          | Pasta                        | Responsabilidade                                                                                       |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Infra de dados  | `src/integrations/postgres/` | Pool de conexão, `consultar`/`executar`/`emTransacao` e cálculo de prazo de SLA sobre o calendário.     |
| Modelo          | `src/models/`                | Tipos de domínio, matriz de prioridade, matriz de SLA, catálogo de módulos e permissões. Sem React.     |
| Repositório     | `src/repositories/*.repo.ts` | Todo o SQL. Uma unidade por assunto. Recebe `ContextoUsuario` para gravar autoria.                      |
| Server function | `src/services/*.functions.ts`| Ponte cliente↔servidor: valida entrada com Zod e chama o repositório. Sem regra de negócio.             |
| Serviço         | `src/services/*.ts`          | Cálculo puro reaproveitável entre telas (`gantt-utils`, `projeto-metricas`, `resource-utils`).          |
| Tela            | `src/routes/`, `src/views/`  | `routes/` são as páginas (roteamento por arquivo); `views/` são os componentes de domínio.              |
| UI genérica     | `src/components/ui/`, `src/hooks/`, `src/lib/` | Design system (shadcn), hooks e utilitários sem domínio (`utils`, `datas`, `theme`).  |

`*.server.ts` é código que só existe no servidor e não é server function:
`current-user.server.ts`, `notificacoes.server.ts`, `lembretes.server.ts`,
`ai-provider.server.ts`.

## O caminho de uma requisição