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
  const [assinaturas, planos, afiliados, comissoes, parametros] = await Promise.all([
    r.painelAssinaturas(c),
    r.listarPlanos(c),
    r.listarAfiliados(c),
    r.listarComissoes(c),
    r.lerParametros(c),
  ]);
  return { assinaturas, planos, afiliados, comissoes, parametros };
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
        descontoPct: z.number().int().min(0).max(90),
      })
      .parse(d),
  )
  .handler(async ({ data }) => (await repo()).criarAfiliado(await ctx(), data));

export const sugerirCodigoAfiliadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ nome: z.string(), descontoPct: z.number().int().min(0).max(90) }).parse(d),
  )
  .handler(async ({ data }) => ({
    codigo: await (await repo()).sugerirCodigo(await ctx(), data.nome, data.descontoPct),
  }));

export const codigoAfiliadoEmUsoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ codigo: z.string() }).parse(d))
  .handler(async ({ data }) => ({
    emUso: (await (await repo()).codigosEmUso(await ctx(), [data.codigo])).length > 0,
  }));

export const marcarComissaoPagaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await (await repo()).marcarComissaoPaga(await ctx(), data.id);
    return { ok: true };
  });
/** Teste, dias grátis do anual e regras do cupom (o banco valida de novo). */
export const salvarParametrosFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        diasTeste: z.number().int().min(0, "Teste: 0 a 90 dias").max(90, "Teste: 0 a 90 dias"),
        diasGratisAnual: z
          .number()
          .int()
          .min(0, "Dias grátis do anual: 0 a 180")
          .max(180, "Dias grátis do anual: 0 a 180"),
        descontoCupomMax: z
          .number()
          .int()
          .min(0, "Desconto máximo: 0 a 90%")
          .max(90, "Desconto máximo: 0 a 90%"),
        mesesDescontoCupom: z
          .number()
          .int()
          .min(1, "Duração do cupom: 1 a 60 meses")
          .max(60, "Duração do cupom: 1 a 60 meses"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await (await repo()).salvarParametros(await ctx(), data);
    return { ok: true };
  });

export const atualizarAfiliadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string(),
        descontoPct: z.number().int().min(0).max(90),
        ativo: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await (await repo()).atualizarAfiliado(await ctx(), data);
    return { ok: true };
  });