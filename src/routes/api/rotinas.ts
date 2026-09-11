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

        /**
         * Sincronização do GLPI.
         *
         * Isolada num try próprio de propósito: ela depende de um
         * servidor de terceiro, e o GLPI fora do ar não pode impedir o
         * envio dos lembretes — que já foram gerados acima e ficariam
         * na fila até a próxima rodada.
         *
         * O erro vai na resposta, não engolido: é assim que o log do
         * cron mostra que a integração está quebrada. Sem isso, uma
         * credencial trocada passaria semanas despercebida.
         *
         * Sem as variáveis configuradas a rotina é pulada em silêncio —
         * é o estado de quem ainda não recebeu o segredo, não uma falha.
         */
        let glpi: unknown = { pulado: "GLPI_USUARIOS_URL não configurada" };
        if (process.env["GLPI_USUARIOS_URL"] && process.env["GLPI_USUARIOS_SECRET"]) {
          try {
            const { sincronizarUsuariosGlpi } = await import("@/integrations/glpi/usuarios.server");
            glpi = await sincronizarUsuariosGlpi();
          } catch (erro) {
            glpi = { erro: erro instanceof Error ? erro.message : String(erro) };
            console.error("[rotinas] sincronização do GLPI falhou:", erro);
          }
        }

        return Response.json({ lembretes, fila, glpi });
      },
    },
  },
});
