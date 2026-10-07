import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Checkout público (sem login). */

export const planosPublicosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { planosPublicos } = await import("@/services/checkout.server");
  return planosPublicos();
});

export const criarCheckoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        empresa: z.string().trim().min(2, "Informe o nome da empresa"),
        slug: z.string().trim().toLowerCase(),
        nome: z.string().trim().min(2, "Informe seu nome"),
        email: z.string().trim().toLowerCase().email("E-mail inválido"),
        cpfCnpj: z.string().trim().min(11, "Informe CPF ou CNPJ"),
        plano: z.string(),
        ciclo: z.enum(["mensal", "anual"]),
        usuarios: z.number().int().min(3).max(500),
        addonIa: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { criarCheckout } = await import("@/services/checkout.server");
    return criarCheckout(data);
  });