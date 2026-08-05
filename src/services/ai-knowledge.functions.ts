import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  tema: z.string().min(5).max(300),
  contexto: z.string().max(4000).optional(),
});

const ArticleSchema = z.object({
  titulo: z.string(),
  categoria: z.string(),
  resumo: z.string(),
  conteudo: z.string(),
});

export type GeneratedArticle = z.infer<typeof ArticleSchema>;

export const generateKnowledgeArticle = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<GeneratedArticle> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key, { structuredOutputs: true });

    const prompt = `Você é um analista de TI que escreve artigos de base de conhecimento (ITIL) padronizados.

Gere um artigo sobre: ${data.tema}
${data.contexto ? `\nContexto de incidentes recorrentes registrados:\n${data.contexto}` : ""}

Regras:
- "categoria": uma entre Infraestrutura, Aplicações, Acessos, Estações de trabalho, Redes, Processos.
- "resumo": até 160 caracteres.
- "conteudo": texto padronizado com as seções, em linhas separadas: "Sintoma:", "Causa provável:", "Solução passo a passo:" (passos numerados), "Quando escalar:". Máximo 1400 caracteres.
- Português do Brasil, objetivo, sem markdown.`;

    try {
      const { output } = await generateText({
        model: gateway("google/gemini-3.6-flash"),
        output: Output.object({ schema: ArticleSchema }),
        prompt,
      });
      return {
        titulo: output.titulo.slice(0, 120),
        categoria: output.categoria.slice(0, 40),
        resumo: output.resumo.slice(0, 160),
        conteudo: output.conteudo.slice(0, 1400),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new Error("A IA não conseguiu gerar o artigo. Detalhe melhor o tema.");
      }
      throw error;
    }
  });
