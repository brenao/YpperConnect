import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Server functions do cadastro de empresas (operadores da plataforma). */

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

async function repo() {
  return import("@/repositories/empresas.repo");
}

export const listarEmpresasFn = createServerFn({ method: "GET" }).handler(async () =>
  (await repo()).listarEmpresas(await ctx()),
);

export const criarEmpresaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        nome: z.string().trim().min(2, "Informe o nome da empresa"),
        slug: z.string().trim().toLowerCase(),
        adminNome: z.string().trim().min(2, "Informe o nome do administrador"),
        adminEmail: z.string().trim().toLowerCase().email("E-mail do administrador inválido"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => (await repo()).criarEmpresa(await ctx(), data));

export const resumoEmpresaFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => (await repo()).resumoEmpresa(await ctx(), data.id));

export const excluirEmpresaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), confirmacao: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await (await repo()).excluirEmpresa(await ctx(), data.id, data.confirmacao);
    return { ok: true };
  });
