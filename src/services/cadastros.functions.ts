import { createServerFn } from "@tanstack/react-start";

/** Listas de apoio usadas pelos formulários. */

export const listarEquipesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarEquipes } = await import("@/repositories/equipes.repo");
  return listarEquipes();
});

export const listarUsuariosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarUsuarios } = await import("@/repositories/usuarios.repo");
  return listarUsuarios();
});

export const listarPerfisFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarPerfis } = await import("@/repositories/perfis.repo");
  return listarPerfis();
});

export const usuarioAtualFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
});
