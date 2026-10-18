import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { documentoValido, somenteDigitos } from "@/lib/documento";

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
        cpfCnpj: z
          .string()
          .transform(somenteDigitos)
          .refine(documentoValido, "CPF ou CNPJ inválido"),
        plano: z.string(),
        ciclo: z.enum(["mensal", "anual"]),
        usuarios: z.number().int().min(3).max(500),
        addonIa: z.boolean(),
        cupom: z.string().trim().toUpperCase().max(30).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { criarCheckout } = await import("@/services/checkout.server");
    return criarCheckout(data);
  });
/** Confere o cupom de indicação enquanto a pessoa digita. */
export const validarCupomFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ codigo: z.string().trim().max(30), email: z.string().trim().max(320).optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { validarCupom } = await import("@/services/checkout.server");
    return validarCupom(data.codigo, data.email);
  });