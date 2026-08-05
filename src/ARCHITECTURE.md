# Arquitetura (MVC)

O código está organizado em camadas MVC adaptadas ao TanStack Start.

| Camada         | Pasta                                          | Responsabilidade                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**      | `src/models/`                                  | Tipos de domínio, enums, regras de classificação (matriz de prioridade, SLA) e dados iniciais (`itsm-seed.ts`). Sem React.                                                                                           |
| **Service**    | `src/services/`                                | Regras de negócio e cálculos: cronograma/CPM (`project-utils`), capacidade de recursos (`resource-utils`), notificações (`notifications`) e funções de servidor de IA (`ai-*.functions.ts`, `ai-gateway.server.ts`). |
| **Controller** | `src/controllers/`                             | Orquestração de estado e casos de uso expostos à UI (`itsm-store.tsx`). Ponte entre models/services e as views.                                                                                                      |
| **View**       | `src/views/` e `src/routes/`                   | `src/routes/` são as páginas (roteamento por arquivo, obrigatório do framework); `src/views/` contém os componentes de tela do domínio.                                                                              |
| Infra/UI       | `src/components/ui/`, `src/hooks/`, `src/lib/` | Design system (shadcn), hooks genéricos e utilitários sem domínio (`utils`, `theme`, tratamento de erro).                                                                                                            |

## Regras

- Views nunca importam `src/models` diretamente para lógica — apenas tipos; a lógica vem de services/controllers.
- Services não importam React nem componentes.
- `src/routes/` deve permanecer fino: monta a view e liga ao controller.
- `src/routeTree.gen.ts` é gerado — não editar.
