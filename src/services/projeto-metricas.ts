/**
 * Métricas derivadas do projeto. Sem React e sem acesso a dados —
 * recebe o que a tela já carregou e devolve número pronto.
 *
 * O "esperado" sai da baseline, não das datas atuais. Medir o previsto
 * contra o cronograma replanejado seria medir contra si mesmo: bastaria
 * empurrar as datas para o projeto voltar a parecer em dia.
 */

import { deslocamentoEmDias, diasEntre, inicioDoDia } from "@/lib/datas";
import type { Atualizacao, BaselineTarefa, TarefaCalculada } from "@/repositories/projetos.repo";

export type Semaforo = "verde" | "amarelo" | "vermelho";

export const SEMAFORO_CLASSE: Record<Semaforo, string> = {
  verde: "bg-success/12 text-success border-success/30",
  amarelo: "bg-warning/12 text-warning border-warning/30",
  vermelho: "bg-destructive/12 text-destructive border-destructive/30",
};

/** Atraso a partir do qual o projeto passa de amarelo para vermelho. */
const TOLERANCIA_ATRASO = 15;

// ------------------------------------------------------------ progresso

/**
 * Percentual que o projeto deveria ter hoje.
 *
 * Cada folha contribui com o quanto do seu intervalo já passou,
 * ponderado pela duração — tarefa de 20 dias pesa mais que uma de 2,
 * igual ao rollup. Tarefa mãe fica de fora para não contar duas vezes.
 */
export function progressoEsperado(
  tarefas: TarefaCalculada[],
  planejado: BaselineTarefa[],
  hoje: Date,
): number {
  const folhas = tarefas.filter((t) => !t.ehPai);
  if (folhas.length === 0) return 0;

  const porTarefa = new Map(planejado.map((p) => [p.tarefaId, p]));
  const dia = inicioDoDia(hoje).getTime();

  let peso = 0;
  let acumulado = 0;

  for (const t of folhas) {
    const plano = porTarefa.get(t.id);
    const inicio = inicioDoDia(plano?.inicio ?? t.inicioEfetivo);
    const fim = inicioDoDia(plano?.fim ?? t.fimEfetivo);
    const dias = diasEntre(inicio, fim);

    const decorrido = (dia - inicio.getTime()) / 86_400_000 + 1;
    const fracao = Math.max(0, Math.min(1, decorrido / dias));

    peso += dias;
    acumulado += fracao * 100 * dias;
  }

  return peso ? Math.round(acumulado / peso) : 0;
}

/** Percentual efetivamente alcançado, na mesma ponderação do esperado. */
export function progressoReal(tarefas: TarefaCalculada[]): number {
  const folhas = tarefas.filter((t) => !t.ehPai);
  if (folhas.length === 0) return 0;

  let peso = 0;
  let acumulado = 0;
  for (const t of folhas) {
    const dias = diasEntre(t.inicioEfetivo, t.fimEfetivo);
    peso += dias;
    acumulado += t.progressoEfetivo * dias;
  }
  return peso ? Math.round(acumulado / peso) : 0;
}

/**
 * Verde em dia, amarelo atrasado até 15 pontos, vermelho acima disso.
 * Adiantado nunca é alerta.
 */
export function semaforoPrazo(esperado: number, real: number): Semaforo {
  const atraso = esperado - real;
  if (atraso <= 0) return "verde";
  if (atraso <= TOLERANCIA_ATRASO) return "amarelo";
  return "vermelho";
}

/** Uma semana sem atualizar é amarelo; duas, vermelho. */
export function semaforoAtualizacao(atualizacoes: Atualizacao[], hoje: Date): Semaforo {
  const ultima = atualizacoes[0]?.dataRef;
  if (!ultima) return "vermelho";

  const dias = deslocamentoEmDias(ultima, hoje);
  if (dias <= 7) return "verde";
  if (dias <= 14) return "amarelo";
  return "vermelho";
}

/** Dias desde a última atualização de status. `null` quando nunca houve. */
export function diasSemAtualizar(atualizacoes: Atualizacao[], hoje: Date): number | null {
  const ultima = atualizacoes[0]?.dataRef;
  return ultima ? Math.max(0, deslocamentoEmDias(ultima, hoje)) : null;
}

// ------------------------------------------------------------- baseline

export interface EstadoBaseline {
  temBaseline: boolean;
  /** Quantas tarefas mudaram de data desde a última foto. */
  alteradas: number;
  /** Tarefas criadas depois da última baseline. */
  novas: number;
  /** Tarefas que existiam na baseline e sumiram do cronograma. */
  removidas: number;
  precisaNovaBaseline: boolean;
}

/**
 * Compara o cronograma com a baseline mais recente.
 *
 * Serve para o botão "salvar nova baseline" só aparecer quando há de
 * fato o que congelar — pedir justificativa para uma foto idêntica à
 * anterior só ensina o usuário a escrever qualquer coisa.
 */
export function compararComBaseline(
  tarefas: TarefaCalculada[],
  planejadoAtual: BaselineTarefa[],
): EstadoBaseline {
  if (planejadoAtual.length === 0) {
    return {
      temBaseline: false,
      alteradas: 0,
      novas: tarefas.length,
      removidas: 0,
      precisaNovaBaseline: tarefas.length > 0,
    };
  }

  const plano = new Map(planejadoAtual.map((p) => [p.tarefaId, p]));
  const atuais = new Set(tarefas.map((t) => t.id));

  let alteradas = 0;
  let novas = 0;

  for (const t of tarefas) {
    const p = plano.get(t.id);
    if (!p) {
      novas += 1;
      continue;
    }
    const mudouInicio = deslocamentoEmDias(p.inicio, t.inicioEfetivo) !== 0;
    const mudouFim = deslocamentoEmDias(p.fim, t.fimEfetivo) !== 0;
    if (mudouInicio || mudouFim) alteradas += 1;
  }

  const removidas = planejadoAtual.filter((p) => !atuais.has(p.tarefaId)).length;

  return {
    temBaseline: true,
    alteradas,
    novas,
    removidas,
    precisaNovaBaseline: alteradas + novas + removidas > 0,
  };
}

// ------------------------------------------------------ resumo para a IA

/**
 * Texto que vai ao instrutor de IA. Sem nome de pessoa e sem descrição
 * livre: o que importa para avaliar o planejamento é a forma do
 * cronograma, e mandar menos dado para fora da rede é sempre melhor.
 */
export function resumoParaIa(dados: {
  nome: string;
  inicio: Date | string;
  fim: Date | string;
  status: string;
  tarefas: TarefaCalculada[];
  cpm: Record<string, { duracaoDias: number; folgaDias: number; critica: boolean }>;
  predecessoras: Record<string, string[]>;
  responsaveis: Record<string, string[]>;
  riscosAbertos: number;
  atencoesAbertas: number;
  diasSemAtualizar: number | null;
  temBaseline: boolean;
  esperado: number;
  real: number;
}): string {
  const folhas = dados.tarefas.filter((t) => !t.ehPai);
  const pais = dados.tarefas.filter((t) => t.ehPai);
  const criticas = Object.values(dados.cpm).filter((c) => c.critica).length;
  const comResponsavel = folhas.filter((t) => (dados.responsaveis[t.id] ?? []).length > 0).length;
  const comPredecessora = folhas.filter((t) => (dados.predecessoras[t.id] ?? []).length > 0).length;
  const marcos = dados.tarefas.filter((t) => t.marco).length;
  const duracaoProjeto = diasEntre(dados.inicio, dados.fim);

  const duracoes = folhas.map((t) => diasEntre(t.inicioEfetivo, t.fimEfetivo));
  const maiores = duracoes.filter((d) => d > 14).length;
  const media = duracoes.length
    ? Math.round(duracoes.reduce((s, d) => s + d, 0) / duracoes.length)
    : 0;

  return [
    `Projeto: ${dados.nome}`,
    `Status: ${dados.status}`,
    `Duração total: ${duracaoProjeto} dias corridos`,
    `Tarefas: ${dados.tarefas.length} (${folhas.length} folhas, ${pais.length} agrupadoras)`,
    `Duração média das folhas: ${media} dias; ${maiores} folha(s) acima de 14 dias`,
    `Marcos definidos: ${marcos}`,
    `Folhas com responsável: ${comResponsavel} de ${folhas.length}`,
    `Folhas com predecessora: ${comPredecessora} de ${folhas.length}`,
    `Tarefas no caminho crítico: ${criticas}`,
    `Riscos abertos: ${dados.riscosAbertos}`,
    `Pontos de atenção abertos: ${dados.atencoesAbertas}`,
    `Baseline registrada: ${dados.temBaseline ? "sim" : "não"}`,
    dados.diasSemAtualizar === null
      ? `Atualizações de status: nenhuma registrada`
      : `Dias desde a última atualização de status: ${dados.diasSemAtualizar}`,
    `Progresso esperado hoje: ${dados.esperado}%`,
    `Progresso real: ${dados.real}%`,
  ].join("\n");
}
