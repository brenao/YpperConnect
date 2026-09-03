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
  IndentDecrease,
  IndentIncrease,
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
import {
  aninharTarefaFn,
  atualizarCampoTarefaFn,
  atualizarVinculosTarefaFn,
  excluirTarefaFn,
  inserirAbaixoFn,
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

export interface ProjectTasksProps {
  projeto: Projeto;
  wbs: { tarefa: TarefaCalculada; nivel: number }[];
  cpm: Record<string, DadosCpm>;
  predecessoras: Record<string, string[]>;
  responsaveis: Record<string, string[]>;
  recursos: { id: string; nome: string; papel: string | null }[];
  progressoEsperado: number;
  progressoReal: number;
  editavel: boolean;
  onDetalhe: (t: Tarefa) => void;
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
}: ProjectTasksProps) {
  const [unidade, setUnidade] = useState<Unidade>("horas");

  // Ids das tarefas mãe recolhidas. Guardado por id, não por índice: a
  // linha muda de número a cada inserção, o id não.
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());

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

  const opcoesRecurso: OpcaoSeletor[] = useMemo(
    () => recursos.map((r) => ({ id: r.id, rotulo: r.nome, detalhe: r.papel ?? undefined })),
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
  }, [wbs, recolhidas]);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Clique em qualquer campo para editar. Linhas com subtarefas mostram o consolidado.
          {criticas > 0 ? (
            <>
              {" "}
              <span className="text-destructive">{criticas} tarefa(s) no caminho crítico</span> —
              atraso nelas empurra a entrega.
            </>
          ) : null}
        </p>

        <div className="flex items-center gap-2">
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
              <th className="w-[4.75rem] px-2 py-2 font-medium">#</th>
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
                <span className="block truncate">{projeto.nome}</span>
                <span className="block truncate text-[11px] font-normal text-muted-foreground">
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
              />
            ))}

            {wbs.length === 0 ? (
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
}: {
  indice: number;
  tarefa: TarefaCalculada;
  nivel: number;
  recolhida: boolean;
  onAlternarRecolhida: () => void;
  cpm: DadosCpm | undefined;
  unidade: Unidade;
  predecessoras: string[];
  responsaveis: string[];
  indicePorId: Map<string, number>;
  idPorIndice: Map<number, string>;
  totalLinhas: number;
  opcoesRecurso: OpcaoSeletor[];
  editavel: boolean;
  onDetalhe: () => void;
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
  const [conflito, setConflito] = useState<{ dados: ConflitoData; envio: CampoTarefaInput } | null>(
    null,
  );

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

  // Mãe mostra a soma do esforço das filhas; folha mostra o que foi
  // digitado. O `esforcoHoras` já vem resolvido do servidor, sempre em
  // horas — daí a origem ser sempre "horas" para a mãe.
  const unidadeOrigem: Unidade = t.duracaoUnidade === "horas" ? "horas" : "dias";
  const duracaoBase = t.ehPai ? t.esforcoHoras : t.duracao !== null ? t.duracao : diasCalendario;
  const duracaoOrigem: Unidade = t.ehPai ? "horas" : t.duracao !== null ? unidadeOrigem : "dias";

  return (
    <tr
      className={cn(
        "group border-b border-border/60",
        // Mãe em fundo tênue e texto forte: numa WBS de trinta linhas,
        // a hierarquia precisa ser legível antes da leitura.
        t.ehPai ? "bg-secondary/25 font-semibold" : "",
      )}
    >
      {/* Calha: o número dá lugar aos botões quando o ponteiro entra na
          linha ou algum campo dela recebe foco. Fora do hover eles não
          ocupam pixel nem entram na ordem de tabulação. */}
      <td className="px-2 py-1 align-top">
        <span className="flex h-7 items-center gap-0.5">
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
          {critica ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-destructive"
              title="Caminho crítico — atraso aqui empurra a entrega"
              aria-label="Caminho crítico"
            />
          ) : null}

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
            salvarCampo.mutate({ id: t.id, duracao: valor, duracaoUnidade: unidade })
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
            valorIds={predecessoras}
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
          <SeletorMultiplo
            opcoes={opcoesRecurso}
            selecionados={responsaveis}
            vazio="Sem responsável"
            titulo="Responsáveis"
            editavel={editavel}
            onMudar={(ids) => salvarVinculos.mutate({ id: t.id, responsaveis: ids })}
          />
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
 * Predecessoras digitadas pelo número da linha: "3" ou "3, 7".
 *
 * Não é seletor de lista porque em cronograma de dezenas de tarefas
 * caçar o nome numa lista é mais lento do que digitar o número que já
 * está à vista na primeira coluna. Salva ao sair do campo.
 *
 * O número é posicional — ele muda quando alguém insere linha acima.
 * Por isso o que vai para o banco é sempre o id: a tela só traduz.
 */
function CampoPredecessoras({
  valorIds,
  indicePorId,
  idPorIndice,
  indiceProprio,
  totalLinhas,
  editavel,
  onSalvar,
}: {
  valorIds: string[];
  indicePorId: Map<string, number>;
  idPorIndice: Map<number, string>;
  indiceProprio: number;
  totalLinhas: number;
  editavel: boolean;
  onSalvar: (ids: string[]) => void;
}) {
  const texto = valorIds
    .map((id) => indicePorId.get(id))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b)
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
    // Aceita qualquer separador: vírgula, ponto e vírgula ou espaço.
    const numeros = [
      ...new Set(
        rascunho
          .split(/[^0-9]+/)
          .filter(Boolean)
          .map(Number),
      ),
    ];

    const invalido = numeros.find((n) => n < 1 || n > totalLinhas || !idPorIndice.has(n));
    if (invalido !== undefined) {
      toast.error(`Não existe tarefa número ${invalido}.`);
      setRascunho(texto);
      return;
    }
    if (numeros.includes(indiceProprio)) {
      toast.error("Uma tarefa não pode depender de si mesma.");
      setRascunho(texto);
      return;
    }

    const ids = numeros
      .map((n) => idPorIndice.get(n))
      .filter((id): id is string => id !== undefined);

    // Só grava se mudou de fato: sair do campo sem editar não deve
    // disparar requisição nem reescrever vínculos.
    const iguais = ids.length === valorIds.length && ids.every((id) => valorIds.includes(id));
    if (iguais) {
      setRascunho(texto);
      return;
    }
    onSalvar(ids);
  }

  return (
    <Input
      value={rascunho}
      placeholder="—"
      title="Números das tarefas das quais esta depende, separados por vírgula"
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(texto);
          e.currentTarget.blur();
        }
      }}
      className="h-7 border-transparent bg-transparent px-1 font-mono text-xs font-normal hover:border-border focus:border-primary"
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
      className="h-7 border-transparent bg-transparent px-1 font-mono text-xs font-normal hover:border-border focus:border-primary"
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
        className="h-7 w-14 border-transparent bg-transparent px-1 font-mono text-xs font-normal hover:border-border focus:border-primary"
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
      className="h-7 w-12 border-transparent bg-transparent px-1 font-mono text-xs font-normal hover:border-border focus:border-primary"
    />
  );
}

/**
 * Nome editável em linha, com ícone separado para abrir o detalhe —
 * clique no texto conflitaria com o foco do campo.
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
          "h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-primary",
          negrito ? "font-semibold" : "font-normal",
          riscado ? "line-through opacity-70" : "",
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title="Abrir detalhes"
        onClick={onDetalhe}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </span>
  );
}
