import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions das preferências de interface.
 *
 * Genéricas de propósito: a chave é texto e o valor é JSON, então a
 * próxima preferência de tela não precisa de rota nova. O que cada
 * chave significa é acordo entre a tela que grava e a que lê.
 */

/** Chave: letras, números, ponto, hífen. O ponto separa domínio de tela. */
const ChaveSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/, "Chave de preferência inválida");

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

/**
 * Devolve `{ valor: null }` quando o usuário nunca ajustou.
 *
 * Nulo é resposta legítima e significa "use o padrão": a tela precisa
 * distinguir isso de um ajuste que resultou em nada.
 */
export const lerPreferenciaFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ chave: ChaveSchema }).parse(d))
  .handler(async ({ data }) => {
    const { lerPreferencia } = await import("@/repositories/preferencias.repo");
    // Texto, e não objeto: a serialização das server functions exige
    // tipo conhecido, e um JSON livre é `unknown`. Quem conhece o
    // formato é a tela que gravou, e é lá que o texto vira objeto.
    return { valor: await lerPreferencia(await ctx(), data.chave) };
  });

export const gravarPreferenciaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ chave: ChaveSchema, valor: z.string().max(16_384) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { gravarPreferencia } = await import("@/repositories/preferencias.repo");
    await gravarPreferencia(await ctx(), data.chave, data.valor);
    return { ok: true };
  });

/** Apaga: é o "restaurar o padrão" das telas. */
export const removerPreferenciaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ chave: ChaveSchema }).parse(d))
  .handler(async ({ data }) => {
    const { removerPreferencia } = await import("@/repositories/preferencias.repo");
    await removerPreferencia(await ctx(), data.chave);
    return { ok: true };
  });
