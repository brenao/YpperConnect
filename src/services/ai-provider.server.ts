import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Provedor de IA neutro, configurado por variável de ambiente.
 * Funciona com qualquer endpoint compatível com a API da OpenAI:
 * OpenAI, Azure OpenAI, OpenRouter, ou um modelo local (Ollama, vLLM).
 *
 * Somente servidor. Nunca importar de componente cliente.
 */
export const AI_MODEL = process.env["AI_MODEL"] ?? "gpt-4o-mini";

export function createAiProvider(options?: { structuredOutputs?: boolean }) {
  const baseURL = process.env["AI_BASE_URL"];
  const apiKey = process.env["AI_API_KEY"];

  if (!baseURL) throw new Error("AI_BASE_URL não configurada");
  if (!apiKey) throw new Error("AI_API_KEY não configurada");

  return createOpenAICompatible({
    name: "ypper-ai",
    baseURL,
    apiKey,
    supportsStructuredOutputs: options?.structuredOutputs ?? false,
  });
}
