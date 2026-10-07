import { createFileRoute } from "@tanstack/react-router";

/** Webhook do Asaas. Autenticado pelo token (cabeçalho asaas-access-token). */
export const Route = createFileRoute("/api/webhooks/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let corpo: unknown;
        try {
          corpo = await request.json();
        } catch {
          return new Response("corpo inválido", { status: 400 });
        }
        const { receberWebhook } = await import("@/services/checkout.server");
        const status = await receberWebhook(request.headers, corpo);
        return new Response(status === 200 ? "ok" : "erro", { status });
      },
    },
  },
});