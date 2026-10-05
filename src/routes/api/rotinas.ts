import { createFileRoute } from "@tanstack/react-router";

/**
 * Gatilho das rotinas periódicas, para o cron do sistema ou o Jenkins.
 *
 * Protegido por segredo compartilhado em vez de sessão: quem chama é
 * uma máquina, não um usuário logado. Sem `CRON_TOKEN` configurado o
 * endpoint fica desligado — é preferível não rodar a rodar aberto.
 *
 * Uso: curl -X POST -H "x-cron-token: $CRON_TOKEN" https://.../beagleone/api/rotinas
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

        const { gerarLembretesTodasEmpresas } = await import("@/services/lembretes.server");
        const { processarFila } = await import("@/services/notificacoes.server");

        // Sem navegador: percorre as empresas, agindo em nome do admin de cada uma.
        const lembretes = await gerarLembretesTodasEmpresas();
        const fila = await processarFila();

        return Response.json({ lembretes, fila });
      },
    },
  },
});