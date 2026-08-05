import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createAiProvider, AI_MODEL } from "@/services/ai-provider.server";

const Input = z.object({
  resumo: z.string().min(20).max(12000),
});

const CoachSchema = z.object({
  nota: z.number(),
  veredito: z.enum(["bom", "regular", "ruim"]),
  resumo: z.string(),
  pontosFortes: z.array(z.string()),
  problemas: z.array(
    z.object({
      titulo: z.string(),
      severidade: z.enum(["alta", "media", "baixa"]),
      recomendacao: z.string(),
    }),
  ),
});

export type CoachResult = z.infer<typeof CoachSchema>;

export const evaluateProjectPlan = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<CoachResult> => {
    const gateway = createAiProvider({ structuredOutputs: true });

    const prompt = `Você é um instrutor de gerenciamento de projetos baseado nas boas práticas do PMI (PMBOK) e em técnicas de cronograma (WBS, CPM, marcos, estimativas).

Avalie a qualidade do detalhamento do projeto abaixo e aponte problemas objetivos, por exemplo:
- detalhamento insuficiente de tarefas (poucas tarefas para a duração do projeto);
- tarefas com duração muito longa (pacotes de trabalho acima de ~2 semanas devem ser decompostos);
- ausência de marcos, de predecessoras ou de responsáveis atribuídos;
- ausência de riscos cadastrados ou de atualizações de status recentes;
- caminho crítico frágil (quase todas as tarefas críticas) ou cronograma sem sequenciamento;
- progresso incoerente com o tempo decorrido.

Regras de resposta:
- "nota" de 0 a 100 sobre a qualidade do planejamento.
- "veredito": bom (>=75), regular (50-74), ruim (<50).
- "resumo" com até 300 caracteres.
- até 4 pontos fortes e até 6 problemas, cada um com recomendação prática e acionável.
- Escreva em português do Brasil, direto e sem rodeios.

Dados do projeto:
${data.resumo}`;

    try {
      const { output } = await generateText({
        model: gateway(AI_MODEL),
        output: Output.object({ schema: CoachSchema }),
        prompt,
      });
      return {
        ...output,
        nota: Math.max(0, Math.min(100, Math.round(output.nota))),
        resumo: output.resumo.slice(0, 300),
        pontosFortes: output.pontosFortes.slice(0, 4),
        problemas: output.problemas.slice(0, 6),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new Error("A IA não conseguiu avaliar o projeto. Tente novamente em instantes.");
      }
      throw error;
    }
  });
