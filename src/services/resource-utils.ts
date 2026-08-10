import type { Recurso } from "@/repositories/recursos.repo";

/**
 * Capacidade de recurso. Calculo puro, sem banco.
 *
 * Mora aqui, e nao no repositorio, porque a tela de recursos precisa dele no
 * NAVEGADOR. Qualquer import de valor vindo de `recursos.repo` arrasta junto
 * `client.server.ts` — e com ele as credenciais do Oracle — para o bundle do
 * cliente. O build de producao barra isso (import-protection do TanStack
 * Start); o `vite dev` nao barra, entao o vazamento passa despercebido.
 *
 * O `import type` acima e apagado na compilacao, logo nao recria o vinculo.
 */

/** Horas/dia efetivamente disponiveis para projeto. */
export function capacidadeProjeto(
  r: Pick<Recurso, "horasDia" | "disponibilidadeProjetos">,
): number {
  return Math.round(((r.horasDia * r.disponibilidadeProjetos) / 100) * 100) / 100;
}
