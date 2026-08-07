import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Server functions de recursos e capacidade. */

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

export const listarRecursosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarRecursos, cargaPorRecurso } = await import("@/repositories/recursos.repo");
  const [recursos, cargas] = await Promise.all([listarRecursos(false), cargaPorRecurso()]);
  return { recursos, cargas };
});

const RecursoSchema = z.object({
  nome: z.string().min(3).max(200),
  usuarioId: z.string().nullable().optional(),
  papel: z.string().max(120).nullable().optional(),
  equipeId: z.string().nullable().optional(),
  horasDia: z.number().positive().max(24),
  disponibilidadeProjetos: z.number().int().min(0).max(100),
});

export type RecursoInput = z.infer<typeof RecursoSchema>;

export const criarRecursoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RecursoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarRecurso } = await import("@/repositories/recursos.repo");
    return { id: await criarRecurso(await ctx(), data) };
  });

const RecursoUpdateSchema = RecursoSchema.extend({ id: z.string() });
export type RecursoUpdateInput = z.infer<typeof RecursoUpdateSchema>;

export const atualizarRecursoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RecursoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarRecurso } = await import("@/repositories/recursos.repo");
    const { id, ...dados } = data;
    await atualizarRecurso(await ctx(), id, dados);
    return { ok: true };
  });

export const definirRecursoAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), ativo: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { definirRecursoAtivo } = await import("@/repositories/recursos.repo");
    await definirRecursoAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });
