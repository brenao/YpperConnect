import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const STATUS = ["publicado", "revisar", "rascunho"] as const;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

export const listarArtigosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarArtigos } = await import("@/repositories/artigos.repo");
  return listarArtigos();
});

const ArtigoSchema = z.object({
  titulo: z.string().min(5).max(300),
  categoriaId: z.string().nullable().optional(),
  resumo: z.string().max(1000).nullable().optional(),
  conteudo: z.string().min(20),
  status: z.enum(STATUS).optional(),
  geradoPorIa: z.boolean().optional(),
});

export type ArtigoInput = z.infer<typeof ArtigoSchema>;

export const criarArtigoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ArtigoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarArtigo } = await import("@/repositories/artigos.repo");
    return { id: await criarArtigo(await ctx(), data) };
  });

const ArtigoUpdateSchema = z.object({
  id: z.string(),
  titulo: z.string().min(5).max(300).optional(),
  categoriaId: z.string().nullable().optional(),
  resumo: z.string().max(1000).nullable().optional(),
  conteudo: z.string().min(20).optional(),
  status: z.enum(STATUS).optional(),
});

export type ArtigoUpdateInput = z.infer<typeof ArtigoUpdateSchema>;

export const atualizarArtigoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ArtigoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarArtigo } = await import("@/repositories/artigos.repo");
    const { id, ...dados } = data;
    await atualizarArtigo(await ctx(), id, dados);
    return { ok: true };
  });

export const registrarVisualizacaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { registrarVisualizacao } = await import("@/repositories/artigos.repo");
    await registrarVisualizacao(data.id);
    return { ok: true };
  });
