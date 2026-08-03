import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  conversa: z.string().min(10).max(8000),
  servicos: z.array(z.string()).max(60),
});

const DraftSchema = z.object({
  titulo: z.string(),
  descricao: z.string(),
  tipo: z.enum(["incidente", "requisicao", "melhoria", "tarefa"]),
  servico: z.string(),
  sistema: z.string(),
  impacto: z.enum(["alto", "medio", "baixo"]),
  urgencia: z.enum(["alta", "media", "baixa"]),
  justificativa: z.string(),
  recomendaProblema: z.boolean(),
});

export type TicketDraft = z.infer<typeof DraftSchema>;

export const draftTicketFromConversation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<TicketDraft> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key, { structuredOutputs: true });

    const prompt = `Estruture um registro de atendimento de TI (ITIL) a partir da conversa abaixo.

Serviços disponíveis no catálogo (escolha exatamente um pelo nome):
${data.servicos.map((s) => `- ${s}`).join("\n")}

Regras:
- "tipo" nunca pode ser Problema: usuários finais não abrem Problemas. Se houver recorrência, marque recomendaProblema = true.
- Impacto: alto = operação essencial ou muitos usuários; medio = uma área/processo; baixo = poucos usuários.
- Urgência: alta = sem alternativa de continuidade; media = alternativa parcial; baixa = planejável.
- titulo com no máximo 90 caracteres, objetivo, sem prefixo de tipo.
- descricao com até 600 caracteres, em texto corrido, com sintoma, escopo e impacto observado.
- justificativa com até 200 caracteres explicando a classificação e a prioridade.
- "sistema": nome do sistema/aplicação afetado (ex.: ERP TOTVS, Portal RH, Active Directory). Obrigatório quando o tipo for incidente, melhoria ou tarefa; use "" se realmente não for possível identificar.
- Responda em português do Brasil.

Conversa:
${data.conversa}`;

    try {
      const { output } = await generateText({
        model: gateway("google/gemini-3.6-flash"),
        output: Output.object({ schema: DraftSchema }),
        prompt,
      });
      return {
        ...output,
        titulo: output.titulo.slice(0, 90),
        sistema: output.sistema.slice(0, 80),
        descricao: output.descricao.slice(0, 600),
        justificativa: output.justificativa.slice(0, 200),
        servico: data.servicos.includes(output.servico)
          ? output.servico
          : (data.servicos[0] ?? "Geral"),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new Error("A IA não conseguiu estruturar o chamado. Detalhe um pouco mais o caso.");
      }
      throw error;
    }
  });