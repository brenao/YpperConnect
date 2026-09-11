import { createServerFn } from "@tanstack/react-start";

/**
 * Server functions da integração com o GLPI.
 *
 * O módulo de integração é importado dinamicamente dentro do handler,
 * pela mesma razão dos repositórios: ele lê `GLPI_USUARIOS_SECRET` do
 * ambiente, e um import estático arrastaria o arquivo — e o segredo —
 * para a análise do bundle do cliente.
 */

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

/**
 * Dispara a sincronização à mão.
 *
 * Restrita a administradores: é uma chamada a um sistema de terceiro, e
 * um botão aberto na tela seria um jeito fácil de gerar carga no GLPI a
 * partir do navegador de qualquer pessoa.
 *
 * A rotina periódica não passa por aqui — ela chama a função do módulo
 * direto, sem contexto de usuário.
 */
export const sincronizarGlpiFn = createServerFn({ method: "POST" }).handler(async () => {
  const usuario = await ctx();
  if (!usuario.admin) {
    const { ErroDominio } = await import("@/repositories/tipos");
    throw new ErroDominio("Somente administradores podem sincronizar a lista do GLPI");
  }

  const { sincronizarUsuariosGlpi } = await import("@/integrations/glpi/usuarios.server");
  return sincronizarUsuariosGlpi();
});

/** Estado da integração, para a tela de administração. */
export const statusGlpiFn = createServerFn({ method: "GET" }).handler(async () => {
  const { statusGlpi } = await import("@/integrations/glpi/usuarios.server");
  return statusGlpi();
});
