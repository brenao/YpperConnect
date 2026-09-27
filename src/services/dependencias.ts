/**
 * Dependências entre tarefas: tipos, defasagem e notação.
 *
 * Puro e sem banco de propósito. O reagendamento usa isto no servidor,
 * a grade usa para ler e escrever a notação no navegador, e o CPM usa
 * para calcular folga — três lugares que precisam concordar sobre o que
 * "3II+2" significa. Duas implementações divergiriam no primeiro
 * ajuste, e o sintoma seria uma tarefa posicionada num lugar que a tela
 * não explica.
 */

/**
 * Os quatro tipos, na nomenclatura do MS Project traduzida.
 *
 * É a mesma do Primavera e do Smartsheet, e é a que quem monta
 * cronograma já conhece. Na prática TI responde pela grande maioria dos
 * vínculos e II por quase todo o resto.
 */
export type TipoDependencia = "TI" | "II" | "TT" | "IT";

export const TIPO_PADRAO: TipoDependencia = "TI";

/**
 * O rótulo traz a sigla entre parênteses.
 *
 * A grade aceita a notação curta — "7II" —, e sem a sigla aqui as duas
 * telas pareceriam falar de coisas diferentes. Com ela, o formulário
 * ensina a notação: quem escolhe "Início → Início (II)" três vezes
 * aprende a digitar "II" na grade sem precisar de manual.
 */
export const TIPOS_DEPENDENCIA: {
  valor: TipoDependencia;
  rotulo: string;
  ajuda: string;
}[] = [
  {
    valor: "TI",
    rotulo: "Término → Início (TI)",
    ajuda: "Esta começa depois que a anterior terminar. É o caso comum.",
  },
  {
    valor: "II",
    rotulo: "Início → Início (II)",
    ajuda: "As duas começam juntas.",
  },
  {
    valor: "TT",
    rotulo: "Término → Término (TT)",
    ajuda: "As duas terminam juntas.",
  },
  {
    valor: "IT",
    rotulo: "Início → Término (IT)",
    ajuda: "Esta termina depois que a anterior começar. Raro.",
  },
];

export interface Dependencia {
  /** Tarefa da qual se depende. */
  predecessoraId: string;
  tipo: TipoDependencia;
  /**
   * Dias somados à restrição, positivos ou negativos.
   *
   * A unidade segue o regime do projeto — dias úteis ou corridos —,
   * porque uma unidade própria criaria dois calendários no mesmo
   * cronograma.
   */
  defasagem: number;
}

/**
 * De qual data da predecessora a restrição parte, e o que ela restringe
 * na sucessora.
 *
 * `de` diz qual ponta da anterior importa; `restringe` diz qual ponta
 * desta é empurrada. Os quatro tipos são as quatro combinações, e ter a
 * tabela explícita evita um `switch` de quatro braços em cada um dos
 * três lugares que precisam disso.
 */
export const ANCORA: Record<
  TipoDependencia,
  { de: "inicio" | "fim"; restringe: "inicio" | "fim" }
> = {
  TI: { de: "fim", restringe: "inicio" },
  II: { de: "inicio", restringe: "inicio" },
  TT: { de: "fim", restringe: "fim" },
  IT: { de: "inicio", restringe: "fim" },
};

/**
 * Quantos dias somar à data de origem para chegar à restrição.
 *
 * TI e IT olham para o fim da anterior e pedem o dia SEGUINTE: somar 1
 * dia útil. II e TT se alinham à mesma data, então somam zero. A
 * defasagem entra por cima dos dois.
 *
 * O número devolvido é contado na régua do projeto pelo chamador — em
 * dias úteis ele pula fim de semana e feriado; em dias corridos, não.
 */
export function deslocamentoDe(d: Pick<Dependencia, "tipo" | "defasagem">): number {
  const emenda = d.tipo === "TI" || d.tipo === "IT" ? 1 : 0;
  return emenda + d.defasagem;
}

// ------------------------------------------------------------ notação

/**
 * Notação curta, como no MS Project: `3`, `3II`, `3TI+2`, `3TT-1`.
 *
 * TI sem defasagem é escrito só com o número, que é o caso comum e o
 * que já estava lá antes dos tipos existirem — quem nunca precisou de
 * outro tipo continua digitando o que sempre digitou.
 */
export function formatarDependencia(
  numeroDaLinha: number,
  tipo: TipoDependencia,
  defasagem: number,
): string {
  const sufixoTipo = tipo === TIPO_PADRAO ? "" : tipo;
  const sufixoDefasagem =
    defasagem === 0 ? "" : defasagem > 0 ? `+${defasagem}` : String(defasagem);

  // Defasagem sem tipo precisa do tipo explícito: "3+2" seria lido como
  // aritmética, não como vínculo.
  if (sufixoTipo === "" && sufixoDefasagem !== "") return `${numeroDaLinha}TI${sufixoDefasagem}`;
  return `${numeroDaLinha}${sufixoTipo}${sufixoDefasagem}`;
}

export interface DependenciaLida {
  numeroDaLinha: number;
  tipo: TipoDependencia;
  defasagem: number;
}

/**
 * Lê uma expressão como "7", "7ii", "7 TI +2", "7tt-1".
 *
 * Tolerante de propósito: aceita minúsculas e espaços, porque é campo
 * de digitação rápida no meio de uma grade e não um formulário. O que
 * não se aceita é ambiguidade — número sem tipo é TI, e qualquer coisa
 * que não case com o formato é recusada em vez de interpretada pela
 * metade.
 *
 * Devolve `null` quando não entende. Quem chama decide o que dizer: a
 * grade mostra qual pedaço estava errado, o que é mais útil do que
 * ignorar em silêncio.
 */
export function lerDependencia(texto: string): DependenciaLida | null {
  const limpo = texto.replace(/\s+/g, "").toUpperCase();
  if (limpo === "") return null;

  const m = /^(\d+)(TI|II|TT|IT)?([+-]\d+)?$/.exec(limpo);
  if (!m) return null;

  const numero = Number(m[1]);
  if (!Number.isFinite(numero) || numero < 1) return null;

  const defasagem = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(defasagem) || Math.abs(defasagem) > 365) return null;

  return {
    numeroDaLinha: numero,
    tipo: (m[2] as TipoDependencia | undefined) ?? TIPO_PADRAO,
    defasagem,
  };
}

/**
 * Lê a lista inteira de um campo: "3, 7II, 12TI+2".
 *
 * Separador livre — vírgula, ponto e vírgula ou espaço —, como o campo
 * já aceitava quando só havia números.
 *
 * Devolve também o que não entendeu, em vez de descartar: a grade
 * precisa dizer "não reconheci '7xx'" para a pessoa corrigir, e um
 * vínculo que some sem aviso é pior do que um erro na tela.
 */
export function lerDependencias(texto: string): {
  lidas: DependenciaLida[];
  invalidos: string[];
} {
  const partes = texto
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const lidas: DependenciaLida[] = [];
  const invalidos: string[] = [];

  for (const p of partes) {
    const lida = lerDependencia(p);
    if (lida) lidas.push(lida);
    else invalidos.push(p);
  }

  return { lidas, invalidos };
}

/** Descrição por extenso, para o título do campo e o diálogo de tarefa. */
export function descreverDependencia(
  nomeDaPredecessora: string,
  tipo: TipoDependencia,
  defasagem: number,
): string {
  const base =
    tipo === "TI"
      ? `começa depois que "${nomeDaPredecessora}" terminar`
      : tipo === "II"
        ? `começa junto com "${nomeDaPredecessora}"`
        : tipo === "TT"
          ? `termina junto com "${nomeDaPredecessora}"`
          : `termina depois que "${nomeDaPredecessora}" começar`;

  if (defasagem === 0) return base;
  const dias = Math.abs(defasagem);
  return defasagem > 0
    ? `${base}, mais ${dias} dia(s)`
    : `${base}, ${dias} dia(s) antes (sobreposição)`;
}
