import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `Você é o assistente de atendimento de TI da plataforma YpperConnect, baseada em práticas ITIL.

Seu papel:
1. Coletar as informações necessárias para abrir um chamado (o que aconteceu, desde quando, quantas pessoas afetadas, se há alternativa de continuidade, serviço/sistema envolvido).
2. Sugerir a classificação correta: Incidente, Requisição de serviço, Demanda de melhoria ou Tarefa.
3. Sugerir a prioridade usando a matriz impacto × urgência:
   - Impacto alto + urgência alta = P1 (crítica)
   - Impacto alto + urgência média, ou impacto médio + urgência alta = P2 (alta)
   - A maioria das combinações intermediárias = P3 (média)
   - Impacto baixo + urgência baixa = P4 (baixa)
4. Orientar o solicitante com soluções conhecidas da base de conhecimento quando for algo recorrente.
5. Indicar a equipe responsável (Service Desk, Infraestrutura, Sustentação de Sistemas ou Segurança).

Regra obrigatória: usuários finais NÃO podem criar registros do tipo "Problema". Se a conversa indicar recorrência, informe que a IA registrará a recomendação para que a equipe de TI avalie a abertura de um Problema, mas nunca abra um Problema para o usuário.

Responda sempre em português do Brasil, de forma objetiva, em markdown curto. Ao final, quando tiver informações suficientes, apresente um resumo do chamado sugerido com: título, classificação, serviço, impacto, urgência, prioridade e equipe responsável.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(messages)) {
          return new Response("Mensagens são obrigatórias", { status: 400 });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const gateway = createLovableAiGatewayProvider(key);

        const result = streamText({
          model: gateway("google/gemini-3.6-flash"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});