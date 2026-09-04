import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { ProjectDialog } from "@/views/project-dialogs";
import { ProjectKanban } from "@/views/project-kanban";
import { TaskDialog } from "@/views/task-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import type { Tarefa, TarefaCalculada } from "@/repositories/projetos.repo";
import {
  detalheProjetoFn,
  buscarAtualizacoesFn,
  criarRiscoFn,
  atualizarRiscoFn,
  criarAtualizacaoFn,
  atualizarAtualizacaoFn,
  criarAtencaoFn,
  atualizarAtencaoFn,
  resolverAtencaoFn,
  reabrirAtencaoFn,
  type RiscoInput,
  type RiscoUpdateInput,
  type AtualizacaoInput,
  type AtualizacaoUpdateInput,
  type AtencaoInput,
  type AtencaoUpdateInput,
} from "@/services/projetos.functions";
import { listarRecursosFn } from "@/services/recursos.functions";
import { ProjectSchedule } from "@/views/project-schedule";
import { ProjectTasks } from "@/views/project-tasks";
import { ProjectBaseline } from "@/views/project-baseline";
import { ProjectCoach } from "@/views/project-coach";
import { PainelAtencoes, PainelAtualizacoes, PainelRiscos } from "@/views/project-registros";
import {
  compararComBaseline,
  diasSemAtualizar,
  progressoEsperado,
  progressoReal,
  resumoParaIa,
  semaforoAtualizacao,
  semaforoPrazo,
  SEMAFORO_CLASSE,
} from "@/services/projeto-metricas";
import { fmt, inicioDoDia } from "@/lib/datas";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projetos_/$projectId")({
  component: DetalheProjeto,
});

const statusStyle: Record<ProjectStatus, string> = {
  backlog: "bg-muted text-muted-foreground border-border",
  planejamento: "bg-info/12 text-info border-info/30",
  execucao: "bg-primary/12 text-primary border-primary/30",
  paralisado: "bg-warning/12 text-warning border-warning/30",
  cancelado: "bg-muted text-muted-foreground border-border",
  concluido: "bg-success/12 text-success border-success/30",
};

/** Teto do histórico quando a pessoa pede para ver tudo ou busca por texto. */
const LIMITE_HISTORICO = 200;

/** Ordena a WBS: filhas logo abaixo da mãe, com nível para indentar. */
function achatarWbs(tarefas: TarefaCalculada[]): { tarefa: TarefaCalculada; nivel: number }[] {
  const porPai = new Map<string | null, TarefaCalculada[]>();
  for (const t of tarefas) {
    const chave = t.paiId ?? null;
    porPai.set(chave, [...(porPai.get(chave) ?? []), t]);
  }

  const saida: { tarefa: TarefaCalculada; nivel: number }[] = [];
  // Guarda contra ciclo em pai_id, que o banco não impede além do self.
  const visitados = new Set<string>();

  function descer(paiId: string | null, nivel: number) {
    for (const t of porPai.get(paiId) ?? []) {
      if (visitados.has(t.id)) continue;
      visitados.add(t.id);
      saida.push({ tarefa: t, nivel });
      descer(t.id, nivel + 1);
    }
  }

  descer(null, 0);
  // Órfãs (pai excluído) entram no fim para não sumirem da tela.
  for (const t of tarefas) {
    if (!visitados.has(t.id)) saida.push({ tarefa: t, nivel: 0 });
  }
  return saida;
}

function DetalheProjeto() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["projeto", projectId],
    queryFn: () => detalheProjetoFn({ data: { id: projectId } }),
  });
  const recursosQuery = useQuery({ queryKey: ["recursos"], queryFn: () => listarRecursosFn() });

  const [editando, setEditando] = useState<Tarefa | undefined>(undefined);
  const [tarefaAberta, setTarefaAberta] = useState(false);

  /**
   * Busca no histórico de acompanhamento.
   *
   * O detalhe do projeto traz só a janela recente — em um ano são
   * cinquenta registros por projeto, e despejar tudo na abertura
   * transforma a aba num paredão. Esta consulta só dispara quando a
   * pessoa digita algo ou pede para ver tudo, e vai ao banco em vez de
   * filtrar em memória: filtrar no cliente exigiria carregar o
   * histórico inteiro, que é justamente o que se está evitando.
   */
  const [buscaTexto, setBuscaTexto] = useState("");
  const [verTodas, setVerTodas] = useState(false);

  const termo = buscaTexto.trim();
  const historicoAtivo = termo.length > 0 || verTodas;

  const historico = useQuery({
    queryKey: ["projeto-atualizacoes", projectId, termo, verTodas],
    queryFn: () =>
      buscarAtualizacoesFn({
        data: {
          projetoId: projectId,
          busca: termo.length > 0 ? termo : null,
          limite: LIMITE_HISTORICO,
        },
      }),
    enabled: historicoAtivo,
  });

  // A tela espelha a regra do repositório, mas não a recalcula: o
  // `editavel` do detalhe já vem decidido pelo servidor.
  const recursos = useMemo(() => recursosQuery.data?.recursos ?? [], [recursosQuery.data]);

  const nomeRecurso = (id: string) => recursos.find((r) => r.id === id)?.nome ?? "—";

  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });
  function invalidar() {
    qc.invalidateQueries({ queryKey: ["projeto", projectId] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
    // O histórico é consulta própria: sem isto, editar um acompanhamento
    // com a busca aberta deixaria o texto antigo na tela.
    qc.invalidateQueries({ queryKey: ["projeto-atualizacoes", projectId] });
  }

  const novoRisco = useMutation({
    mutationFn: (v: RiscoInput) => criarRiscoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Risco registrado");
    },
    onError: erro,
  });

  const editarRisco = useMutation({
    mutationFn: (v: RiscoUpdateInput) => atualizarRiscoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Risco atualizado");
    },
    onError: erro,
  });

  const novaAtualizacao = useMutation({
    mutationFn: (v: AtualizacaoInput) => criarAtualizacaoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Atualização registrada");
    },
    onError: erro,
  });

  const editarAtualizacao = useMutation({
    mutationFn: (v: AtualizacaoUpdateInput) => atualizarAtualizacaoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Acompanhamento atualizado");
    },
    onError: erro,
  });

  const novaAtencao = useMutation({
    mutationFn: (v: AtencaoInput) => criarAtencaoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Ponto de atenção registrado");
    },
    onError: erro,
  });

  const editarAtencao = useMutation({
    mutationFn: (v: AtencaoUpdateInput) => atualizarAtencaoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Ponto de atenção atualizado");
    },
    onError: erro,
  });

  const resolver = useMutation({
    mutationFn: (id: string) => resolverAtencaoFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Ponto de atenção resolvido");
    },
    onError: erro,
  });

  /**
   * Reabrir existe porque resolver era caminho de mão única: um clique
   * errado tirava o item da lista de pendências e a única saída era
   * cadastrar de novo, perdendo a data de abertura — que é justamente o
   * número que diz há quanto tempo a decisão está parada.
   */
  const reabrir = useMutation({
    mutationFn: (id: string) => reabrirAtencaoFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Ponto de atenção reaberto");
    },
    onError: erro,
  });

  if (q.isPending) {
    return (
      <AppShell title="Projeto" subtitle="Carregando...">
        <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando projeto...
        </p>
      </AppShell>
    );
  }

  if (q.error || !q.data) {
    return (
      <AppShell title="Projeto" subtitle="Não encontrado">
        <div className="panel p-6 text-sm">
          <p className="text-muted-foreground">
            {q.error ? String(q.error) : "Este projeto não existe ou foi removido."}
          </p>
          <Link to="/projetos" className="mt-3 inline-flex items-center gap-1 text-primary">
            <ArrowLeft className="size-4" /> Voltar ao portfólio
          </Link>
        </div>
      </AppShell>
    );
  }

  const {
    projeto,
    tarefas,
    cpm,
    vinculos,
    riscos,
    atualizacoes,
    totalAtualizacoes,
    atencoes,
    baselines,
    planejado,
    planejadoAtual,
    editavel,
  } = q.data;

  const wbs = achatarWbs(tarefas);
  const folhas = tarefas.filter((t) => !t.ehPai);
  const concluidas = folhas.filter((t) => t.quadro === "done").length;

  const hoje = inicioDoDia(new Date());
  const esperado = progressoEsperado(tarefas, planejado, hoje);
  const progresso = progressoReal(tarefas);
  const semPrazo = semaforoPrazo(esperado, progresso);

  // As métricas usam a janela recente, não o resultado da busca: elas
  // perguntam "quando foi a última atualização", e a mais recente está
  // sempre no topo da janela. Alimentá-las com o filtro faria o semáforo
  // mudar de cor conforme o que a pessoa digita no campo de busca.
  const semAcompanhamento = semaforoAtualizacao(atualizacoes, hoje);
  const semAtualizar = diasSemAtualizar(atualizacoes, hoje);
  const estadoBaseline = compararComBaseline(tarefas, planejadoAtual);

  // `editavel` vem do servidor: a regra inclui responsáveis por tarefa,
  // que a tela não tem como avaliar, e diretoria e portfólio enxergam o
  // projeto sem poder editá-lo. Repetir a regra aqui só criaria duas
  // versões dela para divergir.

  const atencoesAbertas = atencoes.filter((a) => a.status === "aberto");
  const riscosAbertos = riscos.filter((r) => r.status !== "mitigado");
  const atrasado = new Date(projeto.fim) < new Date() && projeto.status === "execucao";

  // Com busca ou "ver todas", a lista vem da consulta sob demanda;
  // caso contrário, da janela que veio no detalhe.
  const atualizacoesVisiveis = historicoAtivo ? (historico.data?.atualizacoes ?? []) : atualizacoes;

  return (
    <AppShell
      title={projeto.nome}
      subtitle={`${projeto.gerenteNome ?? "Sem gerente"} · ${fmt(projeto.inicio)} — ${fmt(projeto.fim)}`}
      actions={
        editavel ? (
          <ProjectDialog
            project={projeto}
            trigger={
              <Button variant="outline" size="sm">
                Editar projeto
              </Button>
            }
          />
        ) : undefined
      }
    >
      <div className="space-y-4">
        <Link
          to="/projetos"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Portfólio
        </Link>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Situação</p>
            <span
              className={cn(
                "mt-2 inline-block rounded-md border px-2 py-0.5 text-sm font-medium",
                statusStyle[projeto.status],
              )}
            >
              {PROJECT_STATUS_LABEL[projeto.status]}
            </span>
            {atrasado ? (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="size-3.5" /> Prazo vencido
              </p>
            ) : null}
            {!estadoBaseline.temBaseline ? (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-warning">
                <AlertTriangle className="size-3.5" /> Sem baseline
              </p>
            ) : null}
          </div>

          {/* Esperado x real: o número que diz se o projeto está em dia. */}
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Progresso</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold">{progresso}%</span>
              <span className="text-xs text-muted-foreground">de {esperado}% esperado</span>
            </p>
            <Progress value={progresso} className="mt-2" />
            <p className="mt-1 flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  "inline-block rounded-md border px-1.5 py-0.5 font-medium",
                  SEMAFORO_CLASSE[semPrazo],
                )}
              >
                {semPrazo === "verde"
                  ? "em dia"
                  : semPrazo === "amarelo"
                    ? "risco de atraso"
                    : "atrasado"}
              </span>
              <span className="text-muted-foreground">
                {concluidas} de {folhas.length} tarefa(s)
              </span>
            </p>
          </div>

          <div className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Riscos abertos</p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-semibold",
                riscosAbertos.length ? "text-warning" : "",
              )}
            >
              {riscosAbertos.length}
            </p>
            {atencoesAbertas.length > 0 ? (
              <p className="mt-1 text-xs text-destructive">
                {atencoesAbertas.length} decisão(ões) pendente(s)
              </p>
            ) : null}
          </div>

          <div className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Acompanhamento</p>
            <p className="mt-1 font-mono text-2xl font-semibold">
              {semAtualizar === null ? "—" : `${semAtualizar}d`}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  "inline-block rounded-md border px-1.5 py-0.5 font-medium",
                  SEMAFORO_CLASSE[semAcompanhamento],
                )}
              >
                {semAcompanhamento === "verde"
                  ? "em dia"
                  : semAcompanhamento === "amarelo"
                    ? "atrasado"
                    : "sem registro"}
              </span>
              <span className="text-muted-foreground">desde a última atualização</span>
            </p>
          </div>
        </section>

        {projeto.objetivo ? (
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Objetivo</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
              {projeto.objetivo}
            </p>
          </section>
        ) : null}

        <Tabs defaultValue="tarefas">
          <TabsList>
            <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
            <TabsTrigger value="gantt">Gantt</TabsTrigger>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
          </TabsList>

          {/* ----------------------------------------------------- tarefas */}
          <TabsContent value="tarefas" className="mt-4 space-y-4">
            <ProjectBaseline
              projetoId={projectId}
              baselines={baselines}
              estado={estadoBaseline}
              editavel={editavel}
              onSalvo={invalidar}
            />

            <ProjectTasks
              projeto={projeto}
              wbs={wbs}
              cpm={cpm}
              predecessoras={vinculos.predecessoras}
              responsaveis={vinculos.responsaveis}
              recursos={recursos}
              progressoEsperado={esperado}
              progressoReal={progresso}
              editavel={editavel}
              onDetalhe={(t) => {
                setEditando(t);
                setTarefaAberta(true);
              }}
              onNovaTarefa={() => {
                setEditando(undefined);
                setTarefaAberta(true);
              }}
            />

            <div className="grid gap-4 lg:grid-cols-3">
              <PainelRiscos
                projetoId={projectId}
                riscos={riscos}
                editavel={editavel}
                salvando={novoRisco.isPending}
                atualizando={editarRisco.isPending}
                onSalvar={(v) => novoRisco.mutate(v)}
                onEditar={(v) => editarRisco.mutate(v)}
              />
              <PainelAtencoes
                projetoId={projectId}
                atencoes={atencoes}
                editavel={editavel}
                salvando={novaAtencao.isPending}
                atualizando={editarAtencao.isPending}
                resolvendo={resolver.isPending}
                reabrindo={reabrir.isPending}
                onSalvar={(v) => novaAtencao.mutate(v)}
                onEditar={(v) => editarAtencao.mutate(v)}
                onResolver={(id) => resolver.mutate(id)}
                onReabrir={(id) => reabrir.mutate(id)}
              />
              <PainelAtualizacoes
                projetoId={projectId}
                atualizacoes={atualizacoesVisiveis}
                total={totalAtualizacoes}
                busca={buscaTexto}
                buscando={historico.isFetching}
                verTodas={verTodas}
                diasSemAtualizar={semAtualizar}
                editavel={editavel}
                salvando={novaAtualizacao.isPending}
                atualizando={editarAtualizacao.isPending}
                onBusca={setBuscaTexto}
                onVerTodas={() => setVerTodas(true)}
                onSalvar={(v) => novaAtualizacao.mutate(v)}
                onEditar={(v) => editarAtualizacao.mutate(v)}
              />
            </div>

            <ProjectCoach
              resumo={resumoParaIa({
                nome: projeto.nome,
                inicio: projeto.inicio,
                fim: projeto.fim,
                status: projeto.status,
                tarefas,
                cpm,
                predecessoras: vinculos.predecessoras,
                responsaveis: vinculos.responsaveis,
                riscosAbertos: riscosAbertos.length,
                atencoesAbertas: atencoesAbertas.length,
                diasSemAtualizar: semAtualizar,
                temBaseline: estadoBaseline.temBaseline,
                esperado,
                real: progresso,
              })}
            />
          </TabsContent>

          {/* -------------------------------------------------------- gantt */}
          <TabsContent value="gantt" className="mt-4">
            <ProjectSchedule
              projeto={projeto}
              wbs={wbs}
              cpm={cpm}
              predecessoras={vinculos.predecessoras}
              responsaveis={vinculos.responsaveis}
              planejado={planejado}
              progressoProjeto={progresso}
              editavel={editavel}
              nomeRecurso={nomeRecurso}
              onDetalhe={(t) => {
                setEditando(t);
                setTarefaAberta(true);
              }}
            />
          </TabsContent>

          {/* ------------------------------------------------------- kanban */}
          <TabsContent value="kanban" className="mt-4">
            {tarefas.length === 0 ? (
              <div className="panel p-8 text-center text-sm text-muted-foreground">
                Nenhuma tarefa cadastrada. Sem cronograma, o projeto não entra no cálculo de
                capacidade da equipe.
              </div>
            ) : (
              <ProjectKanban
                projetoId={projectId}
                tarefas={tarefas.filter((t) => !t.ehPai)}
                responsaveis={vinculos.responsaveis}
                nomeRecurso={nomeRecurso}
                editavel={editavel}
                onEditar={(t) => {
                  setEditando(t);
                  setTarefaAberta(true);
                }}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <TaskDialog
        projetoId={projectId}
        tarefa={editando}
        tarefas={tarefas}
        recursos={recursos}
        responsaveisAtuais={editando ? (vinculos.responsaveis[editando.id] ?? []) : []}
        predecessorasAtuais={editando ? (vinculos.predecessoras[editando.id] ?? []) : []}
        open={tarefaAberta}
        onOpenChange={setTarefaAberta}
      />
    </AppShell>
  );
}
