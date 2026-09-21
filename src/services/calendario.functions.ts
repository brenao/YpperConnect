import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions do calendário: localidades e feriados.
 *
 * São configuração de instalação — mudam as datas de todo cronograma da
 * empresa —, e por isso o repositório exige administrador em cada
 * escrita. A leitura fica aberta a quem estiver autenticado: saber que
 * o dia 20 é feriado em Caxias não é informação restrita, e o seletor
 * de localidade do cadastro de recursos precisa da lista.
 */

const TIPOS_FERIADO = ["nacional", "estadual", "municipal"] as const;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

// -------------------------------------------------------- localidades

export const listarLocalidadesAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarLocalidades } = await import("@/repositories/calendario.repo");
  return { localidades: await listarLocalidades(false) };
});

const LocalidadeSchema = z.object({
  nome: z.string().min(2).max(160),
  pais: z.string().length(2).optional(),
  regiao: z.string().max(80).nullable().optional(),
  cidade: z.string().max(120).nullable().optional(),
});

export type LocalidadeInput = z.infer<typeof LocalidadeSchema>;

export const criarLocalidadeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => LocalidadeSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarLocalidade } = await import("@/repositories/calendario.repo");
    return { id: await criarLocalidade(await ctx(), data) };
  });

const LocalidadeUpdateSchema = LocalidadeSchema.extend({ id: z.string() });
export type LocalidadeUpdateInput = z.infer<typeof LocalidadeUpdateSchema>;

export const atualizarLocalidadeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => LocalidadeUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarLocalidade } = await import("@/repositories/calendario.repo");
    const { id, ...dados } = data;
    await atualizarLocalidade(await ctx(), id, dados);
    return { ok: true };
  });

/**
 * Eleger a padrão é operação à parte porque muda o calendário de todo
 * mundo que não tem localidade própria — que, numa empresa de uma
 * cidade só, é a empresa inteira.
 */
export const definirLocalidadePadraoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { definirLocalidadePadrao } = await import("@/repositories/calendario.repo");
    await definirLocalidadePadrao(await ctx(), data.id);
    return { ok: true };
  });

export const definirLocalidadeAtivaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), ativo: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { definirLocalidadeAtiva } = await import("@/repositories/calendario.repo");
    await definirLocalidadeAtiva(await ctx(), data.id, data.ativo);
    return { ok: true };
  });

// ------------------------------------------------------------ feriados

/**
 * Feriados de um ano.
 *
 * O ano é do filtro da tela; os recorrentes vêm sempre, porque valem
 * para qualquer ano.
 */
export const listarFeriadosFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        ano: z.number().int().min(2000).max(2100).nullable().optional(),
        localidadeId: z.string().nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { listarFeriados } = await import("@/repositories/calendario.repo");
    return { feriados: await listarFeriados(data) };
  });

const FeriadoSchema = z.object({
  data: z.coerce.date(),
  descricao: z.string().min(3).max(200),
  tipo: z.enum(TIPOS_FERIADO),
  recorrente: z.boolean().optional(),
  localidadeId: z.string().nullable().optional(),
});

export type FeriadoInput = z.infer<typeof FeriadoSchema>;

export const criarFeriadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => FeriadoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarFeriado } = await import("@/repositories/calendario.repo");
    return { id: await criarFeriado(await ctx(), data) };
  });

const FeriadoUpdateSchema = FeriadoSchema.extend({ id: z.string() });
export type FeriadoUpdateInput = z.infer<typeof FeriadoUpdateSchema>;

export const atualizarFeriadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => FeriadoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarFeriado } = await import("@/repositories/calendario.repo");
    const { id, ...dados } = data;
    await atualizarFeriado(await ctx(), id, dados);
    return { ok: true };
  });

export const definirFeriadoAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), ativo: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { definirFeriadoAtivo } = await import("@/repositories/calendario.repo");
    await definirFeriadoAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });

export const excluirFeriadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { excluirFeriado } = await import("@/repositories/calendario.repo");
    await excluirFeriado(await ctx(), data.id);
    return { ok: true };
  });
