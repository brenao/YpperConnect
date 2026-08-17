import { createFileRoute } from "@tanstack/react-router";

/**
 * Gatilho das rotinas periódicas, para o cron do sistema ou o Jenkins.
 *
 * Protegido por segredo compartilhado em vez de sessão: quem chama é
 * uma máquina, não um usuário logado. Sem `CRON_TOKEN` configurado o
 * endpoint fica desligado — é preferível não rodar a rodar aberto.
 *
 * Uso: curl -X POST -H "x-cron-token: $CRON_TOKEN" https://.../ypper/api/rotinas
 */
export const Route = createFileRoute("/api/rotinas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const esperado = process.env["CRON_TOKEN"];
        if (!esperado) {
          return Response.json({ erro: "CRON_TOKEN não configurado" }, { status: 503 });
        }
        if (request.headers.get("x-cron-token") !== esperado) {
          return Response.json({ erro: "não autorizado" }, { status: 401 });
        }

        const { gerarLembretesProjeto } = await import("@/services/lembretes.server");
        const { processarFila } = await import("@/services/notificacoes.server");

        const lembretes = await gerarLembretesProjeto();
        const fila = await processarFila();
        return Response.json({ lembretes, fila });
      },
    },
  },
});
