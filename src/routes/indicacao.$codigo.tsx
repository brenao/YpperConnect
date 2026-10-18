import { createFileRoute } from "@tanstack/react-router";

/**
 * Link do afiliado: /indicacao/<codigo>. Grava o clique (atribuição de
 * 90 dias pelo último clique) e leva ao checkout com o cupom preenchido.
 * O cupom digitado na compra é o que vale; o link é só um atalho.
 */
export const Route = createFileRoute("/indicacao/$codigo")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { registrarIndicacao } = await import("@/services/checkout.server");
        try {
          await registrarIndicacao(params.codigo, request.headers.get("referer"));
        } catch (e) {
          console.error("Falha ao registrar indicação:", e);
        }
        const cupom = encodeURIComponent(params.codigo.trim().toUpperCase());
        return new Response(null, {
          status: 302,
          headers: { location: `/contratar?cupom=${cupom}` },
        });
      },
    },
  },
});