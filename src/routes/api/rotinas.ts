import { createFileRoute } from "@tanstack/react-router";

/**
 * Gatilho das rotinas periódicas.
 *
 * - GET: Vercel Cron (vercel.json), que envia `Authorization: Bearer
 *   $CRON_SECRET`.
 * - POST: chamada manual ou outro agendador, com `x-cron-token:
 *   $CRON_TOKEN` (ou o mesmo CRON_SECRET).
 *
 * Protegido por segredo compartilhado em vez de sessão: quem chama é
 * uma máquina. Sem segredo configurado o endpoint fica desligado — é
 * preferível não rodar a rodar aberto.
 */

function autorizado(request: Request): Response | null {
  const segredos = [process.env["CRON_SECRET"], process.env["CRON_TOKEN"]].filter(
    (s): s is string => !!s,
  );
  if (segredos.length === 0) {
    return Response.json({ erro: "CRON_SECRET não configurado" }, { status: 503 });
  }
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const token = request.headers.get("x-cron-token") ?? "";
  const ok = segredos.some((s) => s === bearer || s === token);
  return ok ? null : Response.json({ erro: "não autorizado" }, { status: 401 });
}

async function executar(): Promise<Response> {
  const { gerarLembretesTodasEmpresas } = await import("@/services/lembretes.server");
  const { processarFila } = await import("@/services/notificacoes.server");
  const { sincronizarGateway } = await import("@/services/gateway-sync.server");

  // Sem navegador: percorre as empresas, agindo em nome do admin de cada uma.
  const lembretes = await gerarLembretesTodasEmpresas();
  const fila = await processarFila();
  // Fim do desconto do cupom, fim do split e carteiras novas de afiliado.
  const gateway = await sincronizarGateway();

  return Response.json({ lembretes, fila, gateway });
}

export const Route = createFileRoute("/api/rotinas")({
  server: {
    handlers: {
      GET: async ({ request }) => autorizado(request) ?? executar(),
      POST: async ({ request }) => autorizado(request) ?? executar(),
    },
  },
});