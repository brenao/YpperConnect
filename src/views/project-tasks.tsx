/**
 * Aba Tarefas: a grade de trabalho do cronograma.
 *
 * Diferente do Gantt, aqui não há linha do tempo — o espaço todo é das
 * colunas editáveis. Responsável fica por último de propósito: é o
 * campo mais largo e o que menos se lê ao conferir prazo.
 *
 * Tarefa mãe não mostra responsável nem predecessora: seus números vêm
 * do rollup das filhas, e atribuir gente a um agrupador esconde quem de
 * fato executa.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  GripVertical,
  Lock,
  IndentDecrease,
  IndentIncrease,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { diasEntre, paraInput } from "@/lib/datas";
import { cn } from "@/lib/utils";
import type {
  ConflitoData,
  DadosCpm,
  Projeto,
  ResultadoCampo,
  Tarefa,
  TarefaCalculada,
} from "@/repositories/projetos.repo";
import { formatarDependencia, lerDependencias, type Dependencia } from "@/services/dependencias";
import {
  aninharTarefaFn,
  atualizarCampoTarefaFn,
  atualizarVinculosTarefaFn,
  excluirTarefaFn,
  inserirAbaixoFn,
  moverOrdemTarefaFn,
  type CampoTarefaInput,
  type VinculosTarefaInput,
} from "@/services/projetos.functions";
import { SeletorMultiplo, type OpcaoSeletor } from "@/views/seletor-multiplo";

/** Jornada usada na conversão horas ↔ dias. Igual à do repositório. */
const HORAS_POR_DIA = 8;

type Unidade = "horas" | "dias";

/** dd/mm — formato pedido para a grade, mais curto que dd/mm/aaaa. */
function curta(v: Date | string): string {
  const d = new Date(v);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * dd/mm/aaaa, para o diálogo de conflito.
 *
 * Ali o ano importa: o caso mais comum de data recusada é justamente
 * quem digitou o ano errado, e esconder o ano deixaria a pessoa sem ver
 * o próprio erro.
 */
function longa(v: Date | string): string {
  return new Date(v).toLocaleDateString("pt-BR");
}

/**
 * Converte a duração guardada para a unidade escolhida na barra.
 *
 * O valor de origem é o que o usuário digitou, não os dias de calendário
 * que a tarefa ocupa: uma tarefa de 4h ocupa um dia no cronograma, mas
 * continua sendo meio dia de trabalho. Ler do calendário arredondaria 4h
 * para 1 d e devolveria 8h ao voltar para horas.
 */
function converterDuracao(valor: number, de: Unidade, para: Unidade): number {
  if (de === para) return valor;
  return para === "horas" ? valor * HORAS_POR_DIA : valor / HORAS_POR_DIA;
}

/** Sem casas decimais desnecessárias: 8, 0,5 e 1,25 — nunca 8,00. */
function numeroCurto(v: number): string {
  return Number(v.toFixed(2)).toLocaleString("pt-BR");
}

function duracaoExibida(valor: number, unidade: Unidade): string {
  return `${numeroCurto(valor)}${unidade === "horas" ? "h" : "d"}`;
}

/**
 * Onde a linha arrastada vai cair.
 *
 * Guardado no componente de cima porque a faixa de destino é desenhada
 * na linha do alvo, e só ela sabe se o ponteiro está na metade de cima
 * ou de baixo.
 */
interface Arraste {
  id: string;
  alvoId: string;
  posicao: "antes" | "depois";
}

export interface ProjectTasksProps {
  projeto: Projeto;
  wbs: { tarefa: TarefaCalculada; nivel: number }[];
  cpm: Record<string, DadosCpm>;
  /** Arestas completas: a grade é quem edita tipo e defasagem. */
  predecessoras: Record<string, Dependencia[]>;
  responsaveis: Record<string, string[]>;
  recursos: { id: string; nome: string; papel: string | null }[];
  progressoEsperado: number;
  progressoReal: number;
  editavel: boolean;
  onDetalhe: (t: Tarefa) => void;
  /** Abre o diálogo de tarefa nova. Fica junto da grade, não no topo. */
  onNovaTarefa?: (() => void) | undefined;
}

export function ProjectTasks({
  projeto,
  wbs,
  cpm,
  predecessoras,
  responsaveis,
  recursos,
  progressoEsperado,
  progressoReal,
  editavel,
  onDetalhe,
  onNovaTarefa,
}: ProjectTasksProps) {
  const qc = useQueryClient();
  const [unidade, setUnidade] = useState<Unidade>("horas");

  // Ids das tarefas mãe recolhidas. Guardado por id, não por índice: a
  // linha muda de número a cada inserção, o id não.
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());

  /**
   * Projeto recolhido: esconde o cronograma inteiro.
   *
   * A linha do projeto é a raiz da árvore e faltava o único controle
   * que todas as outras linhas de agrupamento já tinham. Em cronograma
   * de trezentas tarefas, recolher tudo é o jeito mais rápido de voltar
   * ao topo — e de conferir o cabeçalho sem a lista competindo pela
   * atenção.
   */
  const [projetoRecolhido, setProjetoRecolhido] = useState(false);

  /** Linha sendo arrastada e onde ela cairia se soltasse agora. */
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<Arraste | null>(null);

  const mover = useMutation({
    mutationFn: (v: Arraste) =>
      moverOrdemTarefaFn({
        data: { id: v.id, alvoId: v.alvoId, posicao: v.posicao },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto", projeto.id] }),
    onError: (e: Error) => toast.error("Não foi possível mover", { description: e.message }),
  });

  function alternarRecolhida(id: string) {
    setRecolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  const indicePorId = useMemo(() => {
    const m = new Map<string, number>();
    wbs.forEach(({ tarefa }, i) => m.set(tarefa.id, i + 1));
    return m;
  }, [wbs]);

  // Predecessora é digitada pelo número da linha, então a grade precisa
  // do caminho de volta: número -> id da tarefa.
  const idPorIndice = useMemo(() => {
    const m = new Map<number, string>();
    wbs.forEach(({ tarefa }, i) => m.set(i + 1, tarefa.id));
    return m;
  }, [wbs]);

  /** Pai de cada tarefa: o arrasto só vale entre irmãos. */
  const paiPorId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const { tarefa } of wbs) m.set(tarefa.id, tarefa.paiId);
    return m;
  }, [wbs]);

  const opcoesRecurso: OpcaoSeletor[] = useMemo(
    () =>
      recursos.map((r) => ({
        id: r.id,
        rotulo: r.nome,
        detalhe: r.papel ?? undefined,
      })),
    [recursos],
  );

  /**
   * Esconde a descendência das mães recolhidas.
   *
   * A numeração continua sendo a da WBS inteira: recolher um grupo não
   * pode renumerar as linhas de baixo, senão a predecessora digitada
   * como "7" passaria a apontar para outra tarefa.
   */
  const visiveis = useMemo(() => {
    if (projetoRecolhido) return [];
    if (recolhidas.size === 0) return wbs.map((w, i) => ({ ...w, indice: i + 1 }));

    const escondidas = new Set<string>();
    const saida: { tarefa: TarefaCalculada; nivel: number; indice: number }[] = [];

    wbs.forEach(({ tarefa, nivel }, i) => {
      const paiEscondido = tarefa.paiId !== null && escondidas.has(tarefa.paiId);
      if (paiEscondido || (tarefa.paiId !== null && recolhidas.has(tarefa.paiId))) {
        escondidas.add(tarefa.id);
        return;
      }
      saida.push({ tarefa, nivel, indice: i + 1 });
    });
    return saida;
  }, [wbs, recolhidas, projetoRecolhido]);

  const criticas = Object.values(cpm).filter((c) => c.critica).length;
  const atrasoPontos = progressoEsperado - progressoReal;

  /**
   * Esforço total do projeto, em horas.
   *
   * Soma só as raízes porque `esforcoHoras` já vem consolidado do
   * rollup: incluir os níveis de baixo contaria o mesmo trabalho duas
   * vezes.
   *
   * Antes esta célula mostrava o intervalo de calendário do projeto, e
   * era isso que produzia um cabeçalho com "8h" sobre filhas somando
   * 24h — dois números certos medindo coisas diferentes, na mesma
   * coluna. O período continua legível nas colunas de início e fim.
   */
  const esforcoProjeto = useMemo(
    () => wbs.filter((w) => w.nivel === 0).reduce((s, w) => s + w.tarefa.esforcoHoras, 0),
    [wbs],
  );

  const duracaoProjeto = diasEntre(projeto.inicio, projeto.fim);

  /**
   * Fim do arrasto: grava se caiu em lugar válido.
   *
   * A validação de mesmo nível é repetida no servidor — esta aqui só
   * evita a ida ao banco para um gesto que já se sabe recusado, e
   * permite explicar o motivo na hora.
   */
  function soltar() {
    const destino = alvo;
    setArrastando(null);
    setAlvo(null);
    if (!destino || destino.id === destino.alvoId) return;

    if (paiPorId.get(destino.id) !== paiPorId.get(destino.alvoId)) {
      toast.error("Só dá para reordenar entre tarefas do mesmo nível.", {
        description: "Para mudar o nível, use os botões de endentar da linha.",
      });
      return;
    }
    mover.mutate(destino);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Clique em qualquer campo para editar. Linhas com subtarefas mostram o consolidado.
          {editavel ? " Arraste pela alça à esquerda para reordenar." : ""}
          {criticas > 0 ? (
            <>
              {" "}
              <span className="text-destructive">{criticas} tarefa(s) no caminho crítico</span> —
              atraso nelas empurra a entrega.
            </>
          ) : null}
        </p>

        <div className="flex items-center gap-2">
          {/* Criar tarefa é ação da grade, e por isso mora nela. No
              cabeçalho da página ficava longe do que altera, e distante
              até de estar visível quando outra aba está aberta. */}
          {editavel && onNovaTarefa ? (
            <Button size="sm" className="mr-1 gap-2" onClick={onNovaTarefa}>
              <Plus className="size-4" /> Nova tarefa
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">Duração em</span>
          <div className="flex items-center rounded-md border border-border p-0.5">
            {(["horas", "dias"] as Unidade[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnidade(u)}
                aria-pressed={unidade === u}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  unidade === u
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {u === "horas" ? "Horas" : "Dias"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-[5.5rem] px-2 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Tarefa</th>
              <th className="w-24 px-3 py-2 font-medium">Duração</th>
              <th className="w-20 px-3 py-2 font-medium">Início</th>
              <th className="w-20 px-3 py-2 font-medium">Fim</th>
              <th className="w-28 px-3 py-2 font-medium">% concl.</th>
              <th className="w-28 px-3 py-2 font-medium">Predecessora</th>
              <th className="w-64 px-3 py-2 font-medium">Responsável</th>
            </tr>
          </thead>

          <tbody>
            {/* Linha do projeto: fundo próprio e borda mais forte, para
                não se confundir com uma tarefa mãe. */}
            <tr className="border-b-2 border-primary/30 bg-primary/10 font-semibold">
              <td className="px-2 py-2 font-mono text-xs text-muted-foreground">0</td>
              <td className="px-3 py-2">
                {/* O mesmo controle das tarefas mãe, na mesma posição:
                    a linha do projeto é a raiz da árvore, e era a única
                    sem ele. */}
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setProjetoRecolhido((v) => !v)}
                    title={projetoRecolhido ? "Expandir o cronograma" : "Recolher o cronograma"}
                    aria-expanded={!projetoRecolhido}
                    className="shrink-0 rounded text-muted-foreground hover:text-foreground"
                  >
                    {projetoRecolhido ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                  <span className="truncate">{projeto.nome}</span>
                </span>
                <span className="block truncate pl-5 text-[11px] font-normal text-muted-foreground">
                  {projeto.gerenteNome ?? "Sem gerente"} · {wbs.length} tarefa(s) · {duracaoProjeto}{" "}
                  d de calendário
                  {progressoEsperado > 0 ? (
                    <>
                      {" · esperado "}
                      {progressoEsperado}%
                      {atrasoPontos > 0 ? (
                        <span className="text-warning"> ({atrasoPontos} pts atrás)</span>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </td>
              <td
                className="px-3 py-2 font-mono text-xs text-muted-foreground"
                title="Esforço somado de todas as tarefas"
              >
                {duracaoExibida(converterDuracao(esforcoProjeto, "horas", unidade), unidade)}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{curta(projeto.inicio)}</td>
              <td className="px-3 py-2 font-mono text-xs">{curta(projeto.fim)}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs">{progressoReal}%</span>
                  <Progress value={progressoReal} className="h-1 w-10" />
                </span>
              </td>
              <td />
              <td />
            </tr>

            {visiveis.map(({ tarefa: t, nivel, indice }) => (
              <LinhaTarefa
                key={t.id}
                indice={indice}
                tarefa={t}
                nivel={nivel}
                recolhida={recolhidas.has(t.id)}
                onAlternarRecolhida={() => alternarRecolhida(t.id)}
                cpm={cpm[t.id]}
                unidade={unidade}
                predecessoras={predecessoras[t.id] ?? []}
                responsaveis={responsaveis[t.id] ?? []}
                indicePorId={indicePorId}
                idPorIndice={idPorIndice}
                totalLinhas={wbs.length}
                opcoesRecurso={opcoesRecurso}
                editavel={editavel}
                onDetalhe={() => onDetalhe(t)}
                arrastando={arrastando === t.id}
                marcaDeSolta={alvo?.alvoId === t.id ? alvo.posicao : null}
                onComecarArraste={() => setArrastando(t.id)}
                onPassarPor={(posicao) => {
                  if (!arrastando || arrastando === t.id) return;
                  setAlvo({ id: arrastando, alvoId: t.id, posicao });
                }}
                onSoltar={soltar}
                onCancelarArraste={() => {
                  setArrastando(null);
                  setAlvo(null);
                }}
              />
            ))}

            {projetoRecolhido && wbs.length > 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-3 text-center text-xs text-muted-foreground">
                  {wbs.length} tarefa(s) recolhida(s).{" "}
                  <button
                    type="button"
                    onClick={() => setProjetoRecolhido(false)}
                    className="text-primary hover:underline"
                  >
                    Expandir
                  </button>
                </td>
              </tr>
            ) : null}

            {!projetoRecolhido && wbs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhuma tarefa. Use <strong>Nova tarefa</strong> para começar o cronograma.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinhaTarefa({
  indice,
  tarefa: t,
  nivel,
  recolhida,
  onAlternarRecolhida,
  cpm,
  unidade,
  predecessoras,
  responsaveis,
  indicePorId,
  idPorIndice,
  totalLinhas,
  opcoesRecurso,
  editavel,
  onDetalhe,
  arrastando,
  marcaDeSolta,
  onComecarArraste,
  onPassarPor,
  onSoltar,
  onCancelarArraste,
}: {
  indice: number;
  tarefa: TarefaCalculada;
  nivel: number;
  recolhida: boolean;
  onAlternarRecolhida: () => void;
  cpm: DadosCpm | undefined;
  unidade: Unidade;
  predecessoras: Dependencia[];
  responsaveis: string[];
  indicePorId: Map<string, number>;
  idPorIndice: Map<number, string>;
  totalLinhas: number;
  opcoesRecurso: OpcaoSeletor[];
  editavel: boolean;
  onDetalhe: () => void;
  arrastando: boolean;
  marcaDeSolta: "antes" | "depois" | null;
  onComecarArraste: () => void;
  onPassarPor: (posicao: "antes" | "depois") => void;
  onSoltar: () => void;
  onCancelarArraste: () => void;
}) {
  const qc = useQueryClient();

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["projeto", t.projetoId] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  /**
   * Conflito de data pendente de decisão.
   *
   * Guarda junto o payload que o provocou: as duas saídas do diálogo são
   * o mesmo envio de novo, uma com a data corrigida e outra com
   * `forcarData`. Remontar o payload a partir do estado da linha daria
   * margem a divergir do que a pessoa realmente digitou.
   */
  const [conflito, setConflito] = useState<{
    dados: ConflitoData;
    envio: CampoTarefaInput;
  } | null>(null);

  const salvarCampo = useMutation({
    mutationFn: (v: CampoTarefaInput) => atualizarCampoTarefaFn({ data: v }),
    onSuccess: (res: ResultadoCampo, envio) => {
      if (!res.ok && res.conflito) {
        setConflito({ dados: res.conflito, envio });
        return;
      }

      setConflito(null);

      // Superalocação não impede a gravação, mas some da tela se não for
      // dita agora: a grade não tem coluna de capacidade. O teto vai
      // junto porque "120%" só significa algo ao lado do limite da
      // pessoa — quem está metade do dia em sustentação estoura em 50%.
      for (const a of res.avisos ?? []) {
        toast.warning(`${a.recursoNome}: ${a.percentualTotal}% de ${a.tetoPct}% disponíveis`, {
          description: `Concorre com ${a.tarefasConcorrentes} outra(s) tarefa(s) no mesmo período.`,
        });
      }

      invalidar();
    },
    onError: erro,
  });

  const salvarVinculos = useMutation({
    mutationFn: (v: VinculosTarefaInput) => atualizarVinculosTarefaFn({ data: v }),
    onSuccess: invalidar,
    onError: erro,
  });

  const inserir = useMutation({
    mutationFn: (v: { referenciaId: string; comoFilha: boolean }) => inserirAbaixoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto", t.projetoId] }),
    onError: (e: Error) => toast.error("Não foi possível inserir", { description: e.message }),
  });

  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const excluir = useMutation({
    mutationFn: () => excluirTarefaFn({ data: { id: t.id } }),
    onSuccess: () => {
      setConfirmandoExclusao(false);
      invalidar();
      toast.success("Tarefa excluída");
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const aninhar = useMutation({
    mutationFn: (direcao: "dentro" | "fora") => aninharTarefaFn({ data: { id: t.id, direcao } }),
    onSuccess: invalidar,
    onError: (e: Error) =>
      toast.error("Não foi possível mudar o nível", { description: e.message }),
  });

  // Pai não é editável: seus valores vêm do rollup das filhas.
  const podeEditar = editavel && !t.ehPai;
  const critica = cpm?.critica ?? false;
  const diasCalendario = cpm?.duracaoDias ?? diasEntre(t.inicioEfetivo, t.fimEfetivo);

  /**
   * Folha sem responsável é um buraco silencioso no cronograma.
   *
   * Ela não conta na capacidade da equipe, não aparece na alocação de
   * ninguém e — desde o calendário por recurso — ignora férias e
   * feriado de localidade, porque não há de quem herdar. A data dela é
   * a única do projeto calculada no vácuo, e nada na tela dizia isso.
   */
  const semResponsavel = !t.ehPai && responsaveis.length === 0;

  // Mãe mostra a soma do esforço das filhas; folha mostra o que foi
  // digitado. O `esforcoHoras` já vem resolvido do servidor, sempre em
  // horas — daí a origem ser sempre "horas" para a mãe.
  const unidadeOrigem: Unidade = t.duracaoUnidade === "horas" ? "horas" : "dias";
  const duracaoBase = t.ehPai ? t.esforcoHoras : t.duracao !== null ? t.duracao : diasCalendario;
  const duracaoOrigem: Unidade = t.ehPai ? "horas" : t.duracao !== null ? unidadeOrigem : "dias";

  return (
    <tr
      // Solta em cima da linha: o alvo é a linha inteira, e a metade em
      // que o ponteiro está decide se entra antes ou depois dela.
      onDragOver={(e) => {
        if (!editavel) return;
        e.preventDefault();
        const caixa = e.currentTarget.getBoundingClientRect();
        onPassarPor(e.clientY < caixa.top + caixa.height / 2 ? "antes" : "depois");
      }}
      onDrop={(e) => {
        if (!editavel) return;
        e.preventDefault();
        onSoltar();
      }}
      className={cn(
        "group border-b border-border/60",
        // Mãe em fundo tênue e texto forte: numa WBS de trinta linhas,
        // a hierarquia precisa ser legível antes da leitura.
        t.ehPai ? "bg-secondary/25 font-semibold" : "",
        arrastando ? "opacity-40" : "",
        // A marca de destino é uma borda na aresta em que a linha vai
        // entrar: mais preciso do que destacar a linha inteira, que não
        // diria se é acima ou abaixo.
        marcaDeSolta === "antes" ? "border-t-2 border-t-primary" : "",
        marcaDeSolta === "depois" ? "border-b-2 border-b-primary" : "",
      )}
    >
      {/* Calha: o número dá lugar aos botões quando o ponteiro entra na
          linha ou algum campo dela recebe foco. Fora do hover eles não
          ocupam pixel nem entram na ordem de tabulação. */}
      <td className="px-2 py-1 align-top">
        <span className="flex h-7 items-center gap-0.5">
          {/* A alça é o único ponto que inicia o arrasto. A linha inteira
              arrastável atrapalharia a seleção de texto dos campos. */}
          {editavel ? (
            <span
              draggable
              onDragStart={onComecarArraste}
              onDragEnd={onCancelarArraste}
              title="Arraste para reordenar"
              className="cursor-grab text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <GripVertical className="size-3.5" />
            </span>
          ) : null}

          <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{indice}</span>

          {editavel ? (
            <span className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                title="Inserir tarefa abaixo (Enter)"
                disabled={inserir.isPending}
                onClick={() => inserir.mutate({ referenciaId: t.id, comoFilha: false })}
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                title="Inserir subtarefa"
                disabled={inserir.isPending}
                onClick={() => inserir.mutate({ referenciaId: t.id, comoFilha: true })}
              >
                <CornerDownRight className="size-3.5" />
              </Button>
              {/* Indentar e desindentar: o atalho de teclado existe, mas
                  só quem já sabe descobre. O botão é o caminho visível
                  para associar uma tarefa a outra depois de criada. */}
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                title="Tornar subtarefa da linha acima (Alt+Shift+→)"
                disabled={aninhar.isPending}
                onClick={() => aninhar.mutate("dentro")}
              >
                <IndentIncrease className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                title="Subir um nível (Alt+Shift+←)"
                disabled={aninhar.isPending || t.paiId === null}
                onClick={() => aninhar.mutate("fora")}
              >
                <IndentDecrease className="size-3.5" />
              </Button>
              {/* Separado dos dois de inserir e só vermelho no hover: é o
                  único destrutivo do trio e não pode ser clicado por
                  reflexo. */}
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="ml-1 size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Excluir tarefa"
                disabled={excluir.isPending}
                onClick={() => setConfirmandoExclusao(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          ) : null}
        </span>

        <AlertDialog open={confirmandoExclusao} onOpenChange={setConfirmandoExclusao}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir “{t.nome}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {t.ehPai ? `As ${t.totalFolhas} subtarefas serão excluídas junto. ` : ""}A tarefa
                sai do cronograma e para de contar no progresso, mas continua guardada no banco — o
                histórico de baselines permanece íntegro.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  excluir.mutate();
                }}
              >
                {excluir.isPending ? "Excluindo..." : "Excluir"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DialogoConflito
          conflito={conflito}
          nomeTarefa={t.nome}
          salvando={salvarCampo.isPending}
          onFechar={() => setConflito(null)}
          onReenviar={(v) => {
            setConflito(null);
            salvarCampo.mutate(v);
          }}
        />
      </td>

      <td className="px-3 py-1">
        <span className="flex items-center gap-1.5" style={{ paddingLeft: `${nivel * 14}px` }}>
          {t.ehPai ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={onAlternarRecolhida}
              title={recolhida ? "Expandir subtarefas" : "Recolher subtarefas"}
              className="shrink-0 rounded text-muted-foreground hover:text-foreground"
            >
              {recolhida ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          ) : (
            // Espaço reservado: sem ele, folha e mãe desalinham.
            <span className="size-3.5 shrink-0" />
          )}
          {editavel ? (
            <NomeInline
              valor={t.nome}
              negrito={t.ehPai}
              riscado={t.quadro === "done"}
              onSalvar={(v) => salvarCampo.mutate({ id: t.id, nome: v })}
              onDetalhe={onDetalhe}
              onNovaLinha={() => inserir.mutate({ referenciaId: t.id, comoFilha: false })}
              onAninhar={(direcao) => aninhar.mutate(direcao)}
            />
          ) : (
            <span
              className={cn(
                "truncate",
                t.ehPai ? "font-semibold" : "",
                t.quadro === "done" ? "line-through opacity-70" : "",
              )}
            >
              {t.nome}
            </span>
          )}

          {/* Marcadores vêm DEPOIS do nome. A calha à esquerda pertence
              à hierarquia, e só a ela: um ponto ali fazia a linha
              parecer endentada, como se fosse filha de alguém. */}
          {critica ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-destructive"
              title="Caminho crítico — atraso aqui empurra a entrega"
              aria-label="Caminho crítico"
            />
          ) : null}
          {t.restricaoInicio ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={!editavel}
              onClick={() => salvarCampo.mutate({ id: t.id, limparRestricao: true })}
              title="Data fixada à mão. Clique para soltar e deixar o cronograma recalcular."
              className="shrink-0 text-warning hover:text-foreground disabled:pointer-events-none"
            >
              <Lock className="size-3" />
            </button>
          ) : null}
          {t.marco ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              marco
            </Badge>
          ) : null}
          {t.ehPai ? (
            <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
              ({t.totalFolhas} subtarefa{t.totalFolhas > 1 ? "s" : ""})
            </span>
          ) : null}
        </span>

        {/* Segunda linha: só o que nenhuma coluna diz.
            "Sem responsável" saiu daqui — a coluna Responsável já mostra
            isso, e repetido em cinco linhas seguidas virava ruído na
            parte mais densa da tela. O aviso continua existindo, como
            destaque na própria coluna. */}
        {t.atividade || critica || (cpm && cpm.folgaDias > 0 && !t.ehPai) ? (
          <span
            className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground"
            style={{ paddingLeft: `${nivel * 14 + 14}px` }}
          >
            {t.atividade ? <span>{t.atividade}</span> : null}
            {critica ? (
              <span className="text-destructive">{t.atividade ? " · " : ""}caminho crítico</span>
            ) : cpm && !t.ehPai && cpm.folgaDias > 0 ? (
              <span>
                {t.atividade ? " · " : ""}folga de {cpm.folgaDias} d
              </span>
            ) : null}
          </span>
        ) : null}
      </td>

      <td className="px-3 py-1 align-top">
        <CampoDuracao
          valor={converterDuracao(duracaoBase, duracaoOrigem, unidade)}
          unidade={unidade}
          editavel={podeEditar}
          onSalvar={(valor) =>
            salvarCampo.mutate({
              id: t.id,
              duracao: valor,
              duracaoUnidade: unidade,
            })
          }
        />
      </td>

      <td className="px-3 py-1 align-top">
        <CampoData
          valor={t.inicioEfetivo}
          editavel={podeEditar}
          onSalvar={(v) => salvarCampo.mutate({ id: t.id, inicio: new Date(`${v}T12:00:00`) })}
        />
      </td>

      <td className="px-3 py-1 align-top">
        <CampoData
          valor={t.fimEfetivo}
          editavel={podeEditar}
          onSalvar={(v) => salvarCampo.mutate({ id: t.id, fim: new Date(`${v}T12:00:00`) })}
        />
      </td>

      <td className="px-3 py-1 align-top">
        <span className="flex items-center gap-2">
          <CampoNumero
            valor={t.progressoEfetivo}
            editavel={podeEditar}
            onSalvar={(v) => salvarCampo.mutate({ id: t.id, progresso: v })}
          />
          <Progress value={t.progressoEfetivo} className="h-1 w-8" />
        </span>
      </td>

      {/* Pai não recebe vínculo próprio: quem depende e quem executa são
          as folhas. */}
      <td className="px-3 py-1 align-top">
        {t.ehPai ? (
          <span className="text-xs font-normal text-muted-foreground">—</span>
        ) : (
          <CampoPredecessoras
            valor={predecessoras}
            indicePorId={indicePorId}
            idPorIndice={idPorIndice}
            indiceProprio={indice}
            totalLinhas={totalLinhas}
            editavel={editavel}
            onSalvar={(ids) => salvarVinculos.mutate({ id: t.id, predecessoras: ids })}
          />
        )}
      </td>

      <td className="px-3 py-1 align-top">
        {t.ehPai ? (
          <span className="text-xs font-normal text-muted-foreground">—</span>
        ) : (
          <span
            className={cn("block", semResponsavel ? "text-warning" : "")}
            title={
              semResponsavel
                ? "Sem responsável: esta tarefa não entra na capacidade da equipe e ignora férias e feriados de localidade"
                : undefined
            }
          >
            <SeletorMultiplo
              opcoes={opcoesRecurso}
              selecionados={responsaveis}
              vazio="Sem responsável"
              titulo="Responsáveis"
              editavel={editavel}
              onMudar={(ids) => salvarVinculos.mutate({ id: t.id, responsaveis: ids })}
            />
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Diálogo de data anterior ao que a dependência permite.
 *
 * Nada foi gravado quando ele aparece — o servidor recusa antes de
 * escrever. As duas saídas são deliberadamente simétricas: ou a data
 * cede à dependência, ou a dependência cede à data. Oferecer só a
 * primeira transformaria o vínculo num obstáculo intransponível; aplicar
 * a segunda em silêncio faria a pessoa perder o vínculo sem saber.
 *
 * "Manter a data" corta apenas os vínculos que bloqueiam. Os demais
 * continuam, porque não têm nada a ver com o impedimento.
 */
function DialogoConflito({
  conflito,
  nomeTarefa,
  salvando,
  onFechar,
  onReenviar,
}: {
  conflito: { dados: ConflitoData; envio: CampoTarefaInput } | null;
  nomeTarefa: string;
  salvando: boolean;
  onFechar: () => void;
  onReenviar: (v: CampoTarefaInput) => void;
}) {
  if (!conflito) return null;

  const { dados, envio } = conflito;
  const bloqueantes = dados.predecessoras.filter((p) => p.bloqueia);
  const minimo = new Date(dados.minimoPermitido);

  return (
    <AlertDialog open onOpenChange={(aberto) => (aberto ? undefined : onFechar())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>A data depende de outra tarefa</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                “{nomeTarefa}” não pode começar em{" "}
                <strong className="font-mono">{longa(dados.propostoEm)}</strong>: antes disso
                {bloqueantes.length > 1 ? " as tarefas" : " a tarefa"}{" "}
                {bloqueantes.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 ? (i === bloqueantes.length - 1 ? " e " : ", ") : ""}
                    <strong>{p.nome}</strong> (termina em {longa(p.fim)})
                  </span>
                ))}{" "}
                ainda {bloqueantes.length > 1 ? "estão" : "está"} em andamento.
              </p>
              <p>
                A primeira data possível é <strong className="font-mono">{longa(minimo)}</strong>.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>

          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Destrutiva à esquerda e sem destaque: das duas saídas, é a
                que apaga informação. */}
            <Button
              variant="outline"
              disabled={salvando}
              onClick={() => onReenviar({ ...envio, forcarData: true })}
            >
              Manter a data e remover{" "}
              {bloqueantes.length > 1 ? `os ${bloqueantes.length} vínculos` : "o vínculo"}
            </Button>
            <AlertDialogAction
              disabled={salvando}
              onClick={(e) => {
                e.preventDefault();
                onReenviar({ ...envio, inicio: minimo, forcarData: false });
              }}
            >
              Ajustar para {curta(minimo)}
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Predecessoras na notação curta do MS Project: `3`, `3II`, `3TI+2`,
 * `3TT-1`.
 *
 * Não é seletor de lista porque em cronograma de dezenas de tarefas
 * caçar o nome numa lista é mais lento do que digitar o número que já
 * está à vista na primeira coluna. E não é um seletor de tipo ao lado
 * porque a notação é o que essas pessoas já usam: quem monta
 * cronograma há dez anos digita "7II" sem pensar.
 *
 * O número é posicional — ele muda quando alguém insere linha acima.
 * Por isso o que vai para o banco é sempre o id: a tela só traduz.
 *
 * TI sem defasagem continua sendo só o número, que é a esmagadora
 * maioria dos vínculos. Quem nunca precisou de outro tipo digita o que
 * sempre digitou.
 */
function CampoPredecessoras({
  valor,
  indicePorId,
  idPorIndice,
  indiceProprio,
  totalLinhas,
  editavel,
  onSalvar,
}: {
  valor: Dependencia[];
  indicePorId: Map<string, number>;
  idPorIndice: Map<number, string>;
  indiceProprio: number;
  totalLinhas: number;
  editavel: boolean;
  onSalvar: (deps: Dependencia[]) => void;
}) {
  const texto = valor
    .map((d) => {
      const numero = indicePorId.get(d.predecessoraId);
      return numero === undefined ? null : { numero, d };
    })
    .filter((x): x is { numero: number; d: Dependencia } => x !== null)
    .sort((a, b) => a.numero - b.numero)
    .map((x) => formatarDependencia(x.numero, x.d.tipo, x.d.defasagem))
    .join(", ");

  const [rascunho, setRascunho] = useState(texto);
  useEffect(() => setRascunho(texto), [texto]);

  if (!editavel) {
    return (
      <span className={cn("font-mono text-xs", texto ? "" : "text-muted-foreground")}>
        {texto || "—"}
      </span>
    );
  }

  function confirmar() {
    const { lidas, invalidos } = lerDependencias(rascunho);

    // Erro de digitação volta para a tela em vez de sumir: um vínculo
    // que desaparece em silêncio é pior do que um campo recusado.
    if (invalidos.length > 0) {
      toast.error(`Não entendi “${invalidos[0]}”.`, {
        description:
          "Use o número da linha, opcionalmente com TI, II, TT ou IT e ±dias. Ex.: 7II+2",
      });
      setRascunho(texto);
      return;
    }

    const invalido = lidas.find(
      (l) =>
        l.numeroDaLinha < 1 || l.numeroDaLinha > totalLinhas || !idPorIndice.has(l.numeroDaLinha),
    );
    if (invalido) {
      toast.error(`Não existe tarefa número ${invalido.numeroDaLinha}.`);
      setRascunho(texto);
      return;
    }
    if (lidas.some((l) => l.numeroDaLinha === indiceProprio)) {
      toast.error("Uma tarefa não pode depender de si mesma.");
      setRascunho(texto);
      return;
    }

    // A chave é (tarefa, predecessora): dois tipos para o mesmo par não
    // cabem no banco, e o último digitado vence — mesma regra do
    // Project.
    const porId = new Map<string, Dependencia>();
    for (const l of lidas) {
      const id = idPorIndice.get(l.numeroDaLinha);
      if (!id) continue;
      porId.set(id, {
        predecessoraId: id,
        tipo: l.tipo,
        defasagem: l.defasagem,
      });
    }
    const deps = [...porId.values()];

    // Só grava se mudou de fato: sair do campo sem editar não deve
    // disparar requisição nem reescrever vínculos.
    const iguais =
      deps.length === valor.length &&
      deps.every((d) =>
        valor.some(
          (v) =>
            v.predecessoraId === d.predecessoraId &&
            v.tipo === d.tipo &&
            v.defasagem === d.defasagem,
        ),
      );
    if (iguais) {
      setRascunho(texto);
      return;
    }
    onSalvar(deps);
  }

  return (
    <Input
      value={rascunho}
      placeholder="—"
      title="Número da tarefa, com tipo e defasagem opcionais. Ex.: 3, 7II, 12TI+2"
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(texto);
          e.currentTarget.blur();
        }
      }}
      className="h-7 border-transparent bg-transparent px-1 font-mono text-xs font-normal shadow-none hover:border-border focus:border-primary"
    />
  );
}

/**
 * Data em dd/mm que vira campo de calendário ao receber foco.
 *
 * `<input type="date">` sempre mostra o formato do sistema operacional
 * e não aceita máscara — daí exibir texto e só trocar para o campo
 * nativo enquanto edita.
 */
function CampoData({
  valor,
  editavel,
  onSalvar,
}: {
  valor: Date;
  editavel: boolean;
  onSalvar: (iso: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(paraInput(valor));

  useEffect(() => setRascunho(paraInput(valor)), [valor]);

  if (!editavel) {
    return <span className="font-mono text-xs text-muted-foreground">{curta(valor)}</span>;
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="h-7 w-full rounded-md border border-transparent px-1 text-left font-mono text-xs font-normal hover:border-border focus:border-primary focus:outline-none"
      >
        {curta(valor)}
      </button>
    );
  }

  return (
    <Input
      type="date"
      autoFocus
      value={rascunho}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        setEditando(false);
        if (rascunho && rascunho !== paraInput(valor)) onSalvar(rascunho);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(paraInput(valor));
          setEditando(false);
        }
      }}
      className="h-7 border-transparent bg-transparent px-1 font-mono text-xs font-normal shadow-none hover:border-border focus:border-primary"
    />
  );
}

/** Duração na unidade escolhida na barra. Salvar recalcula o término. */
function CampoDuracao({
  valor,
  unidade,
  editavel,
  onSalvar,
}: {
  valor: number;
  unidade: Unidade;
  editavel: boolean;
  onSalvar: (valor: number) => void;
}) {
  const [rascunho, setRascunho] = useState(numeroCurto(valor));

  useEffect(() => setRascunho(numeroCurto(valor)), [valor]);

  if (!editavel) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {duracaoExibida(valor, unidade)}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Input
        type="text"
        inputMode="decimal"
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          // Aceita vírgula: é como se digita decimal em pt-BR.
          const n = Number(rascunho.replace(",", "."));
          if (Number.isFinite(n) && n > 0 && n !== valor) onSalvar(n);
          else setRascunho(numeroCurto(valor));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setRascunho(numeroCurto(valor));
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-14 border-transparent bg-transparent px-1 font-mono text-xs font-normal shadow-none hover:border-border focus:border-primary"
      />
      <span className="text-[10px] font-normal text-muted-foreground">
        {unidade === "horas" ? "h" : "d"}
      </span>
    </span>
  );
}

function CampoNumero({
  valor,
  editavel,
  onSalvar,
}: {
  valor: number;
  editavel: boolean;
  onSalvar: (v: number) => void;
}) {
  const [rascunho, setRascunho] = useState(String(valor));
  useEffect(() => setRascunho(String(valor)), [valor]);

  if (!editavel) {
    return <span className="font-mono text-xs text-muted-foreground">{valor}%</span>;
  }

  return (
    <Input
      type="number"
      min={0}
      max={100}
      value={rascunho}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        const n = Math.round(Number(rascunho));
        if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== valor) onSalvar(n);
        else setRascunho(String(valor));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(String(valor));
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-12 border-transparent bg-transparent px-1 font-mono text-xs font-normal shadow-none hover:border-border focus:border-primary"
    />
  );
}

/**
 * Nome editável em linha, com ícone separado para abrir o detalhe —
 * clique no texto conflitaria com o foco do campo.
 *
 * O ícone é um lápis, e não a seta que estava aqui antes: a seta dizia
 * "vá para a direita", o que numa grade sugere navegação entre colunas.
 * Lápis é o símbolo de editar em toda a aplicação, e é o que a pessoa
 * procura quando quer abrir a tarefa inteira.
 *
 * Atalhos: Enter cria a linha seguinte, Alt+Shift+→ endenta e
 * Alt+Shift+← desendenta. É a convenção do MS Project, que é onde essas
 * pessoas aprenderam a montar cronograma. Tab continua sendo navegação:
 * sequestrá-lo para endentar quebraria o teclado de quem não usa mouse.
 */
function NomeInline({
  valor,
  negrito,
  riscado,
  onSalvar,
  onDetalhe,
  onNovaLinha,
  onAninhar,
}: {
  valor: string;
  negrito: boolean;
  riscado: boolean;
  onSalvar: (v: string) => void;
  onDetalhe: () => void;
  onNovaLinha: () => void;
  onAninhar: (direcao: "dentro" | "fora") => void;
}) {
  const [rascunho, setRascunho] = useState(valor);
  useEffect(() => setRascunho(valor), [valor]);

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        value={rascunho}
        maxLength={300}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          const v = rascunho.trim();
          if (v && v !== valor) onSalvar(v);
          else if (!v) setRascunho(valor);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
            onNovaLinha();
            return;
          }
          if (e.altKey && e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
            e.preventDefault();
            const v = rascunho.trim();
            if (v && v !== valor) onSalvar(v);
            onAninhar(e.key === "ArrowRight" ? "dentro" : "fora");
            return;
          }
          if (e.key === "Escape") {
            setRascunho(valor);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm shadow-none hover:border-border focus:border-primary",
          negrito ? "font-semibold" : "font-normal",
          riscado ? "line-through opacity-70" : "",
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title="Abrir detalhes da tarefa"
        onClick={onDetalhe}
      >
        <Pencil className="size-3.5" />
      </Button>
    </span>
  );
}
