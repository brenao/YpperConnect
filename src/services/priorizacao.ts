/**
 * Pontuação do backlog. Puro e sem banco: a tela recalcula enquanto a
 * pessoa mexe nos campos, e o servidor usa o mesmo código para ordenar.
 * Duas implementações da mesma fórmula divergiriam no primeiro ajuste.
 */

export type ModeloPriorizacao = "simples" | "rice";

export const MODELO_PADRAO: ModeloPriorizacao = "simples";

/**
 * Tamanho do projeto, por duração prevista.
 *
 * Quatro faixas, não três. "Grande · meses" abarcava desde três meses
 * até dois anos, e são coisas de natureza diferente: a segunda quase
 * nunca entrega como planejada. Separar o GG cria a conversa de quebrar
 * em fases, que é o principal ganho que uma régua de tamanho oferece a
 * quem está começando a organizar a governança.
 *
 * A escala é 1/3/9/20 e não 1/2/3/4 porque a diferença entre um projeto
 * de um mês e um de seis não é de quatro vezes: é de ordem de grandeza.
 * Numa escala linear, um projeto de nove meses com valor alto apareceria
 * colado num de um mês, e a matriz deixaria de separar o que se faz
 * agora do que precisa de decisão.
 *
 * DURAÇÃO NÃO É ESFORÇO, e vale ter isso claro: um projeto de quatro
 * meses com uma pessoa e outro com seis são ambos "M" por esta régua e
 * coisas muito diferentes na prática. A régua é de duração porque é o
 * que se sabe estimar no momento de priorizar — ninguém conhece o
 * esforço de algo que ainda não foi planejado. Como o cronograma calcula
 * o esforço real das tarefas, daqui a alguns meses dá para comparar a
 * faixa declarada com o que de fato aconteceu, e calibrar com dado
 * próprio em vez de benchmark.
 */
export const ESFORCOS = [
  { valor: 1, rotulo: "P", descricao: "Pequeno · 2 a 6 semanas" },
  { valor: 3, rotulo: "M", descricao: "Médio · 6 semanas a 4 meses" },
  { valor: 9, rotulo: "G", descricao: "Grande · 4 a 9 meses" },
  { valor: 20, rotulo: "GG", descricao: "Muito grande · mais de 9 meses" },
] as const;

/**
 * Abaixo de quanto tempo aquilo não é projeto.
 *
 * É a primeira peça de governança do portfólio, e a única fronteira que
 * se consegue defender sem processo de aprovação estabelecido: coisa de
 * menos de duas semanas é demanda operacional — requisição ou melhoria,
 * na linguagem do ITIL —, e deveria virar chamado.
 *
 * Misturar as duas coisas na carteira é o que faz qualquer indicador de
 * portfólio perder o sentido: a contagem de projetos cresce com o que a
 * operação resolveria sozinha, e a matriz de priorização passa a decidir
 * sobre o que não precisava de decisão.
 *
 * O aviso NÃO bloqueia. Bloquear no primeiro mês de governança só ensina
 * as pessoas a classificarem tudo como P para conseguir cadastrar — e aí
 * o dado fica pior do que estava.
 */
export const PISO_PROJETO = {
  rotulo: "Menos de 2 semanas",
  aviso:
    "Trabalho de menos de duas semanas costuma ser demanda operacional, não projeto. " +
    "Abrir como chamado de melhoria evita acompanhamento semanal, baseline e cronograma " +
    "para algo que a operação resolve direto.",
} as const;

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
  /** Divisor do score. Faixa de duração no simples, pessoa-dias no RICE. */
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

/** Rótulo do esforço na escala P/M/G/GG; no RICE, o número em dias. */
export function rotuloEsforco(modelo: ModeloPriorizacao, esforco: number | null): string {
  if (esforco === null) return "—";
  if (modelo === "rice") return `${esforco} d`;
  return ESFORCOS.find((e) => e.valor === esforco)?.rotulo ?? String(esforco);
}

/** Descrição da faixa, para o formulário e o detalhe. */
export function descricaoEsforco(esforco: number | null): string | null {
  if (esforco === null) return null;
  return ESFORCOS.find((e) => e.valor === esforco)?.descricao ?? null;
}

export function rotuloValor(valor: number | null): string {
  if (valor === null) return "—";
  return VALORES.find((v) => v.valor === valor)?.rotulo ?? String(valor);
}

/**
 * Projeto grande o bastante para pedir a conversa de quebrar em fases.
 *
 * Mais de nove meses é o ponto em que a estimativa deixa de ser
 * estimativa. Não impede nada — só põe a pergunta na frente de quem
 * cadastra, que é onde ela custa menos.
 */
export function pedeDivisao(esforco: number | null): boolean {
  return esforco !== null && esforco >= 20;
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
  // O corte fica acima de "M": P e M cabem no trimestre e são decisão
  // do dia a dia; G e GG atravessam trimestres e pedem patrocinador.
  const altoEsforco = d.esforco > 3;

  if (altoValor && !altoEsforco) return "ganho_rapido";
  if (altoValor && altoEsforco) return "aposta";
  if (!altoValor && !altoEsforco) return "preencher";
  return "descartar";
}
