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

/**
 * Usuários que ainda não são recurso.
 *
 * Alimenta o cadastro em lote, que existe para acabar com a digitação
 * da mesma pessoa em dois lugares: nome, equipe e vínculo vêm do
 * usuário, e só a disponibilidade é decisão de quem cadastra.
 */
export const usuariosSemRecursoFn = createServerFn({ method: "GET" }).handler(async () => {
  const { usuariosSemRecurso } = await import("@/repositories/recursos.repo");
  return { usuarios: await usuariosSemRecurso() };
});

export const criarRecursosDeUsuariosFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        usuarioIds: z.array(z.string()).min(1).max(200),
        disponibilidadeProjetos: z.number().int().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { criarRecursosDeUsuarios, DISPONIBILIDADE_PADRAO } =
      await import("@/repositories/recursos.repo");
    const criados = await criarRecursosDeUsuarios(
      await ctx(),
      data.usuarioIds,
      data.disponibilidadeProjetos ?? DISPONIBILIDADE_PADRAO,
    );
    return { criados };
  });

/**
 * `horasDia` é opcional: a jornada padrão é 8h e saiu do formulário.
 * A coluna continua no banco para a exceção — estagiário de 6h, meio
 * período —, editável por quem precisar, sem ocupar a tela de todo dia.
 */
const RecursoSchema = z.object({
  nome: z.string().min(3).max(200),
  usuarioId: z.string().nullable().optional(),
  papel: z.string().max(120).nullable().optional(),
  equipeId: z.string().nullable().optional(),
  horasDia: z.number().positive().max(24).optional(),
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

/**
 * Altera só o percentual.
 *
 * É a edição do dia a dia: o resto do cadastro vem do usuário, e
 * reescrever a linha inteira para mexer num número sobrescreveria o que
 * o cadastro de usuários mantém atualizado.
 */
export const definirDisponibilidadeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ id: z.string(), disponibilidadeProjetos: z.number().int().min(0).max(100) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { definirDisponibilidade } = await import("@/repositories/recursos.repo");
    await definirDisponibilidade(await ctx(), data.id, data.disponibilidadeProjetos);
    return { ok: true };
  });

export const definirRecursoAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), ativo: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { definirRecursoAtivo } = await import("@/repositories/recursos.repo");
    await definirRecursoAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });
