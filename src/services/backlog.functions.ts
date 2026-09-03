import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Server functions do backlog de demandas. */

const MODELOS = ["simples", "rice"] as const;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

/**
 * Lista e modelo na mesma ida: o score depende do modelo, e buscá-lo
 * numa segunda chamada faria a tela renderizar uma vez com a fórmula
 * errada antes de se corrigir.
 */
export const listarBacklogFn = createServerFn({ method: "GET" }).handler(async () => {
  const r = await import("@/repositories/backlog.repo");
  const usuario = await ctx();
  const [demandas, modelo] = await Promise.all([r.listarBacklog(usuario), r.modeloPriorizacao()]);
  return {
    demandas,
    modelo,
    /** Reordenar e promover são atos de gestão de portfólio. */
    podeGerir: usuario.admin || usuario.visaoDiretoriaProjetos || usuario.gestorPortfolio,
  };
});

/** A lista inteira na ordem nova: posição é relativa, não absoluta. */
export const reordenarBacklogFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ ids: z.array(z.string()).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const { reordenarBacklog } = await import("@/repositories/backlog.repo");
    await reordenarBacklog(await ctx(), data.ids);
    return { ok: true };
  });

export const promoverDemandaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { promoverDemanda } = await import("@/repositories/backlog.repo");
    await promoverDemanda(await ctx(), data.id);
    return { ok: true };
  });

export const devolverAoBacklogFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { devolverAoBacklog } = await import("@/repositories/backlog.repo");
    await devolverAoBacklog(await ctx(), data.id);
    return { ok: true };
  });

export const descartarDemandaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { descartarDemanda } = await import("@/repositories/backlog.repo");
    await descartarDemanda(await ctx(), data.id);
    return { ok: true };
  });

export const definirModeloPriorizacaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ modelo: z.enum(MODELOS) }).parse(d))
  .handler(async ({ data }) => {
    const { definirModeloPriorizacao } = await import("@/repositories/backlog.repo");
    await definirModeloPriorizacao(await ctx(), data.modelo);
    return { ok: true };
  });
