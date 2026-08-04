import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  contexto: z.string().min(10).max(3000),
  existentes: z.array(z.string()).max(80),
});

const CatalogSchema = z.object({
  servicos: z.array(
    z.object({
      nome: z.string(),
      categoria: z.string(),
      descricao: z.string(),
      tipoPadrao: z.enum(["incidente", "requisicao", "melhoria", "tarefa"]),
      slaHoras: z.number(),
      equipe: z.string(),
    }),
  ),
});

export type GeneratedCatalog = z.infer<typeof CatalogSchema>;

export const suggestCatalogServices = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<GeneratedCatalog> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key, { structuredOutputs: true });

    const prompt = `Você estrutura catálogos de serviços de TI segundo ITIL.

Serviços prestados pela área (descrição livre do gestor):
${data.contexto}

Serviços que já existem no catálogo (não repita):
${data.existentes.map((s) => `- ${s}`).join("\n") || "- (nenhum)"}

Regras:
- Devolva de 3 a 6 serviços novos.
- "categoria": agrupamento curto (ex.: Acessos, Infraestrutura, Aplicações, Estações de trabalho, Redes).
- "descricao": até 160 caracteres, orientada ao usuário final.
- "tipoPadrao": classificação predominante do serviço.
- "slaHoras": prazo de solução realista em horas (4, 8, 24, 48 ou 72).
- "equipe": time responsável (ex.: Service Desk, Infraestrutura, Aplicações, Segurança).
- Português do Brasil.`;

    try {
      const { output } = await generateText({
        model: gateway("google/gemini-3.6-flash"),
        output: Output.object({ schema: CatalogSchema }),
        prompt,
      });
      return { servicos: output.servicos.slice(0, 6) };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new Error("A IA não conseguiu sugerir serviços. Detalhe melhor o contexto.");
      }
      throw error;
    }
  });
