import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  id: z.string(),
  assunto: z.string(),
  corpo: z.string(),
  destinatarios: z.array(z.string().email()).min(1),
});

/** Envia uma notificação do Beagle One para cada destinatário. */
export const enviarNotificacaoEmail = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const resultados: Array<{ para: string; enviado: boolean; motivo?: string }> = [];

    for (const para of [...new Set(data.destinatarios)]) {
      try {
        const r = await sendTemplateEmail("notificacao-itsm", para, {
          templateData: { assunto: data.assunto, corpo: data.corpo },
          idempotencyKey: `notificacao-itsm-${data.id}-${para}`,
        });
        resultados.push({ para, enviado: r.sent, ...(r.sent ? {} : { motivo: r.reason }) });
      } catch (error) {
        console.error("Falha ao enviar notificação", { para, error });
        resultados.push({
          para,
          enviado: false,
          motivo: error instanceof Error ? error.message : "erro_desconhecido",
        });
      }
    }

    return { resultados };
  });
