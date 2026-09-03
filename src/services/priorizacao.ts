/**
 * Pontuação do backlog. Puro e sem banco: a tela recalcula enquanto a
 * pessoa mexe nos campos, e o servidor usa o mesmo código para ordenar.
 * Duas implementações da mesma fórmula divergiriam no primeiro ajuste.
 */

export type ModeloPriorizacao = "simples" | "rice";

export const MODELO_PADRAO: ModeloPriorizacao = "simples";

/**
 * Esforço no modelo simples.
 *
 * Três tamanhos, não uma estimativa em dias: na hora de priorizar
 * ninguém sabe quanto vai levar, e pedir precisão que não existe faz a
 * pessoa inventar um número — que depois é lido como compromisso.
 *
 * A escala é 1/3/9 e não 1/2/3 porque a diferença entre um projeto
 * pequeno e um grande raramente é de três vezes: é de uma ordem de
 * grandeza, e o score precisa refletir isso.
 */
export const ESFORCOS = [
  { valor: 1, rotulo: "P", descricao: "Pequeno · dias" },
  { valor: 3, rotulo: "M", descricao: "Médio · semanas" },
  { valor: 9, rotulo: "G", descricao: "Grande · meses" },
] as const;

/** Valor para o negócio, comum aos dois modelos. */
export const VALORES = [
  { valor: 1, rotulo: "Muito baixo" },
  { valor: 2, rotulo: "Baixo" },
  { valor: 3, rotulo: "Médio" },
  { valor: 4, rotulo: "Alto" },
  { valor: 5, rotulo: "Crítico" },
] as const;

export interface DadosPriorizacao {
  /** 1–5. No RICE é o "impacto": as duas perguntas são a mesma. */
  valor: number | null;
  /** Divisor do score. P/M/G no simples, pessoa-dias no RICE. */
  esforco: number | null;
  /** Só RICE: quantas pessoas ou processos são afetados. */
  alcance: number | null;
  /** Só RICE: 0–100. O desconto por incerteza. */
  confianca: number | null;
}

/**
 * Score, ou `null` quando falta dado.
 *
 * Devolver zero para o incompleto o mandaria para o fim da lista como
 * se tivesse sido avaliado e reprovado. Sem pontuação é sem pontuação,
 * e a tela mostra isso em vez de um número inventado.
 *
 * Simples: valor ÷ esforço. RICE: alcance × impacto × confiança ÷
 * esforço, a fórmula que o Intercom publicou e virou padrão de mercado.
 */
export function calcularScore(modelo: ModeloPriorizacao, d: DadosPriorizacao): number | null {
  if (d.valor === null || d.esforco === null || d.esforco <= 0) return null;

  if (modelo === "rice") {
    if (d.alcance === null || d.confianca === null) return null;
    const bruto = (d.alcance * d.valor * (d.confianca / 100)) / d.esforco;
    return Math.round(bruto * 10) / 10;
  }

  return Math.round((d.valor / d.esforco) * 100) / 100;
}

/** Rótulo do esforço na escala P/M/G; fora dela, o número em dias. */
export function rotuloEsforco(modelo: ModeloPriorizacao, esforco: number | null): string {
  if (esforco === null) return "—";
  if (modelo === "rice") return `${esforco} d`;
  return ESFORCOS.find((e) => e.valor === esforco)?.rotulo ?? String(esforco);
}

export function rotuloValor(valor: number | null): string {
  if (valor === null) return "—";
  return VALORES.find((v) => v.valor === valor)?.rotulo ?? String(valor);
}

/**
 * Quadrante na matriz valor × esforço.
 *
 * É o artefato que funciona numa reunião de priorização: "ganho rápido"
 * é o que se faz agora, "aposta" é o que precisa de decisão de
 * diretoria, e "descartar" é a conversa que ninguém puxa sozinho.
 */
export type Quadrante = "ganho_rapido" | "aposta" | "preencher" | "descartar";

export const QUADRANTE_LABEL: Record<Quadrante, string> = {
  ganho_rapido: "Ganho rápido",
  aposta: "Aposta",
  preencher: "Preencher lacuna",
  descartar: "Questionar",
};

export function quadranteDe(d: DadosPriorizacao): Quadrante | null {
  if (d.valor === null || d.esforco === null) return null;
  const altoValor = d.valor >= 4;
  // O corte fica acima de "M": pequeno e médio cabem no trimestre,
  // grande não.
  const altoEsforco = d.esforco > 3;

  if (altoValor && !altoEsforco) return "ganho_rapido";
  if (altoValor && altoEsforco) return "aposta";
  if (!altoValor && !altoEsforco) return "preencher";
  return "descartar";
}
