/** "3 chamados", "1 projeto" — só o que existe. */
export function descreverVinculos(v: { chamados?: number; projetos?: number } | undefined) {
  if (!v) return [];
  const itens: string[] = [];
  if (v.chamados) itens.push(`${v.chamados} ${v.chamados === 1 ? "chamado" : "chamados"}`);
  if (v.projetos) itens.push(`${v.projetos} ${v.projetos === 1 ? "projeto" : "projetos"}`);
  return itens;
}
