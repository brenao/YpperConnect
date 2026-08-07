import { createServerFn } from "@tanstack/react-start";

/**
 * Listas de apoio usadas pelos formulários.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o oracledb nunca entrar no bundle do navegador.
 */

export const listarEquipesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarEquipes } = await import("@/repositories/equipes.repo");
  return listarEquipes();
});

export const listarUsuariosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarUsuarios } = await import("@/repositories/usuarios.repo");
  return listarUsuarios();
});

/** Somente quem pode receber atribuição de chamado: usuários com equipe. */
export const listarAtendentesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarAtendentes } = await import("@/repositories/usuarios.repo");
  return listarAtendentes();
});

export const listarPerfisFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarPerfis } = await import("@/repositories/perfis.repo");
  return listarPerfis();
});

export const listarServicosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarServicos } = await import("@/repositories/catalogo.repo");
  return listarServicos();
});

export const listarSistemasFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarSistemas } = await import("@/repositories/catalogo.repo");
  return listarSistemas();
});

export const usuarioAtualFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
});
