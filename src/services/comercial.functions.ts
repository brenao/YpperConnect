import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Server functions do painel comercial (operadores da plataforma). */

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

async function repo() {
  return import("@/repositories/comercial.repo");
}

export const painelComercialFn = createServerFn({ method: "GET" }).handler(async () => {
  const r = await repo();
  const c = await ctx();
  const [assinaturas, planos, afiliados, comissoes] = await Promise.all([
    r.painelAssinaturas(c),
    r.listarPlanos(c),
    r.listarAfiliados(c),
    r.listarComissoes(c),
  ]);
  return { assinaturas, planos, afiliados, comissoes };
});

export const atualizarAssinaturaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        tenantId: z.string(),
        plano: z.string(),
        ciclo: z.enum(["mensal", "anual"]),
        usuarios: z.number().int().min(3).max(9999),
        addonIa: z.boolean(),
        status: z.enum([
          "teste",
          "ativa",
          "inadimplente",
          "somente_leitura",
          "suspensa",
          "cancelada",
        ]),
        cortesia: z.boolean(),
        periodoFim: z.string().nullable(),
        afiliadoCodigo: z.string().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await (await repo()).atualizarAssinatura(await ctx(), data);
    return { ok: true };
  });

export const criarAfiliadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        codigo: z.string().min(3),
        nome: z.string().trim().min(2, "Informe o nome"),
        email: z.string().trim().email("E-mail inválido"),
        tipo: z.enum(["afiliado", "parceiro"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => (await repo()).criarAfiliado(await ctx(), data));

export const marcarComissaoPagaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await (await repo()).marcarComissaoPaga(await ctx(), data.id);
    return { ok: true };
  });