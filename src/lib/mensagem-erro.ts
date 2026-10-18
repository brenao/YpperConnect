/**
 * Mensagem legivel de um erro vindo do servidor. A validacao (zod)
 * chega como JSON da lista de problemas; mostra so as mensagens.
 */
export function mensagemErro(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  if (texto.trimStart().startsWith("[")) {
    try {
      const itens = JSON.parse(texto) as { message?: string }[];
      const msgs = itens.map((i) => i.message).filter(Boolean);
      if (msgs.length > 0) return msgs.join(" · ");
    } catch {
      // nao era JSON: segue com o texto original
    }
  }
  return texto;
}