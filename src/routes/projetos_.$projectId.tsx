import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/itsm/app-shell";
import {
  AttentionDialog,
  RiskDialog,
  TaskDialog,
  WeeklyUpdateDialog,
} from "@/components/itsm/project-forms";
import { ProjectKanban } from "@/components/itsm/project-kanban";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHydrated } from "@/hooks/use-hydrated";
import { evaluateProjectPlan, type CoachResult } from "@/lib/ai-project-coach.functions";
import { useItsm } from "@/lib/itsm-store";
import { PROJECT_STATUS_LABEL, type Project, type ProjectStatus } from "@/lib/itsm-types";
import {
  HEALTH_CLASS,
  HEALTH_DOT,
  HEALTH_LABEL,
  criticalPath,
  expectedProgress,
  fmtDate,
  fmtDateFull,
  parseDate,
  projectHealth,
  projectProgress,
  taskDurationDays,
  taskDurationLabel,
  toISODate,
} from "@/lib/project-utils";
import {
  durationWithResources,
  effectiveDurationDays,
  findResource,
  portfolioLoad,
  taskAllocation,
  taskResponsibles,
} from "@/lib/resource-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projetos_/$projectId")({
  head: () => ({
    meta: [
      { title: "Detalhe do projeto · YpperConnect" },
      {
        name: "description",
        content:
          "Visão única do projeto: cronograma, caminho crítico, riscos, pontos de atenção e avaliação de IA baseada no PMI.",
      },
      { property: "og:title", content: "Detalhe do projeto · YpperConnect" },
      {
        property: "og:description",
        content: "Cronograma, caminho crítico, riscos e avaliação de IA do projeto de TI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProjetoDetalhe,
});

function Semaforo({ tone, label }: { tone: "verde" | "amarelo" | "vermelho"; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", HEALTH_DOT[tone])} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function Gantt({ project }: { project: Project }) {
  const hydrated = useHydrated();
  const { resources, projects } = useItsm();
  const cpm = useMemo(
    () =>
      hydrated
        ? criticalPath(project, durationWithResources(resources, projects))
        : criticalPath(project),
    [project, resources, projects, hydrated],
  );
  const start = Math.min(parseDate(project.inicio), ...project.tarefas.map((t) => parseDate(t.inicio)));
  const end = Math.max(
    parseDate(project.fim),
    ...project.tarefas.map((t) => cpm.get(t.id)?.ef ?? parseDate(t.fim)),
  );
  const span = Math.max(end - start, 1);
  const hojePct = ((Date.now() - start) / span) * 100;

  if (!project.tarefas.length) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Nenhuma tarefa cadastrada. Adicione tarefas para gerar o cronograma e o caminho crítico.
      </p>
    );
  }

  return (
    <div className="relative mt-4 space-y-2">
      {hydrated && hojePct > 0 && hojePct < 100 ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/60"
          style={{ left: `calc(16rem + (100% - 16rem) * ${hojePct / 100})` }}
        />
      ) : null}
      {project.tarefas.map((t, idx) => {
        const sched = cpm.get(t.id);
        const ini = sched?.es ?? parseDate(t.inicio);
        const fim = sched?.ef ?? parseDate(t.fim);
        const left = ((ini - start) / span) * 100;
        const width = Math.max(((fim - ini) / span) * 100, 1.5);
        const critica = sched?.critica;
        return (
          <div key={t.id} className="flex items-center gap-3 text-sm">
            <div className="flex w-64 shrink-0 items-start gap-1">
              <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                {idx + 1}
              </span>
              <TaskDialog
                project={project}
                afterTask={t}
                trigger={
                  <button
                    type="button"
                    title="Adicionar tarefa abaixo desta"
                    aria-label={`Adicionar tarefa abaixo de ${t.nome}`}
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-border/60 text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                }
              />
              <div className="min-w-0" style={{ paddingLeft: t.paiId ? 12 : 0 }}>
              <div className="flex items-center gap-2">
                {critica ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" title="Tarefa crítica" />
                ) : null}
                <span className="truncate">{t.nome}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {(t.responsaveis ?? [t.responsavel]).join(", ")} · {taskDurationLabel(t)} ·{" "}
                {taskAllocation(t)}% alocado
                {(t.predecessoras ?? []).length
                  ? ` · após ${(t.predecessoras ?? [])
                      .map((p) => project.tarefas.findIndex((x) => x.id === p) + 1)
                      .filter((n) => n > 0)
                      .join(", ")}`
                  : ""}
              </span>
              </div>
            </div>
            <div className="relative h-7 flex-1 rounded-md bg-muted/40">
              <div
                className={cn(
                  "absolute inset-y-1 rounded-md",
                  t.marco
                    ? "bg-warning/70"
                    : critica
                      ? "bg-destructive/60"
                      : "bg-primary/50",
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                <div
                  className="h-full rounded-md bg-foreground/25"
                  style={{ width: `${t.progresso}%` }}
                />
              </div>
            </div>
            <span className="w-28 shrink-0 text-right text-[11px] text-muted-foreground">
              {fmtDate(toISODate(ini))} — {fmtDate(toISODate(fim))}
            </span>
            <span className="w-10 shrink-0 text-right text-xs">{t.progresso}%</span>
          </div>
        );
      })}
    </div>
  );
}

function AiCoach({ project }: { project: Project }) {
  const run = useServerFn(evaluateProjectPlan);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CoachResult | null>(null);

  const resumo = useMemo(() => {
    const cpm = criticalPath(project);
    const linhas = project.tarefas.map((t) => {
      const s = cpm.get(t.id);
      return `- ${t.nome} | atividade: ${t.atividade ?? "-"} | ${t.inicio} a ${t.fim} | duração ${taskDurationLabel(t)} | ${t.progresso}% | responsáveis: ${(t.responsaveis ?? [t.responsavel]).join(", ")} | predecessoras: ${(t.predecessoras ?? []).length} | pai: ${t.paiId ?? "-"} | marco: ${t.marco ? "sim" : "não"} | crítica: ${s?.critica ? "sim" : "não"} | folga: ${s?.folga ?? 0}d`;
    });
    const duracaoProjeto = Math.round((parseDate(project.fim) - parseDate(project.inicio)) / 86_400_000);
    return [
      `Projeto: ${project.nome} (${project.id})`,
      `Objetivo: ${project.objetivo}`,
      `GP: ${project.gerente} | Sponsor: ${project.sponsor} | Status: ${PROJECT_STATUS_LABEL[project.status]}`,
      `Período: ${project.inicio} a ${project.fim} (${duracaoProjeto} dias corridos)`,
      `Progresso real: ${projectProgress(project)}% | esperado pela linha do tempo: ${expectedProgress(project)}%`,
      `Total de tarefas: ${project.tarefas.length} | marcos: ${project.tarefas.filter((t) => t.marco).length}`,
      `Riscos cadastrados: ${(project.riscos ?? []).length}`,
      `Atualizações de status: ${(project.atualizacoes ?? []).length} (última: ${(project.atualizacoes ?? [])[0]?.data ?? "nenhuma"})`,
      `Pontos de atenção abertos: ${(project.atencoes ?? []).filter((a) => a.status === "aberto").length}`,
      "Tarefas:",
      ...(linhas.length ? linhas : ["- nenhuma tarefa cadastrada"]),
    ].join("\n");
  }, [project]);

  async function avaliar() {
    setLoading(true);
    try {
      const r = await run({ data: { resumo } });
      setResult(r);
    } catch (error) {
      toast.error("Não foi possível avaliar o projeto", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }

  const tone =
    result?.veredito === "bom" ? "verde" : result?.veredito === "regular" ? "amarelo" : "vermelho";

  return (
    <div className="glass-panel rounded-2xl border border-border/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Instrutor de IA · boas práticas PMI</h3>
          <p className="text-sm text-muted-foreground">
            Avalia o detalhamento do cronograma, decomposição de tarefas, marcos, riscos e coerência
            de prazos.
          </p>
        </div>
        <Button size="sm" onClick={avaliar} disabled={loading}>
          {loading ? "Avaliando..." : "Avaliar projeto"}
        </Button>
      </div>

      {result ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className={HEALTH_CLASS[tone]}>
              {result.veredito === "bom"
                ? "Detalhamento bom"
                : result.veredito === "regular"
                  ? "Detalhamento regular"
                  : "Detalhamento ruim"}
            </Badge>
            <span className="text-sm text-muted-foreground">Nota {result.nota}/100</span>
          </div>
          <p className="text-sm">{result.resumo}</p>
          {result.pontosFortes.length ? (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground">Pontos fortes</h4>
              <ul className="mt-2 space-y-1 text-sm">
                {result.pontosFortes.map((p) => (
                  <li key={p} className="text-success">
                    • {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.problemas.length ? (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                Pontos de melhoria
              </h4>
              <ul className="mt-2 space-y-3 text-sm">
                {result.problemas.map((p) => (
                  <li key={p.titulo} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          p.severidade === "alta"
                            ? "bg-destructive"
                            : p.severidade === "media"
                              ? "bg-warning"
                              : "bg-info",
                        )}
                      />
                      <span className="font-medium">{p.titulo}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{p.recomendacao}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  alerta,
}: {
  label: string;
  value: string;
  hint?: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-surface/60 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      {hint ? (
        <p className={cn("text-[11px]", alerta ? "text-destructive" : "text-muted-foreground")}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SidePanel({
  titulo,
  contagem,
  acao,
  children,
}: {
  titulo: string;
  contagem: number;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel rounded-2xl border border-border/60 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {titulo}
          <span className="ml-2 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            {contagem}
          </span>
        </h3>
        {acao}
      </div>
      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function ProjetoDetalhe() {
  const { projectId } = Route.useParams();
  const { projects, resources, updateProject, updateTask, removeTask, resolveAttention } = useItsm();
  const hydrated = useHydrated();
  const project = projects.find((p) => p.id === projectId);

  if (!project) {
    return (
      <AppShell title="Projeto não encontrado" subtitle="O projeto solicitado não existe no portfólio">
        <Link to="/projetos" className="text-sm text-primary underline">
          Voltar ao portfólio
        </Link>
      </AppShell>
    );
  }

  const health = hydrated ? projectHealth(project) : null;
  const progresso = projectProgress(project);
  const esperado = hydrated ? expectedProgress(project) : 0;
  const cpm = criticalPath(project);
  const criticas = project.tarefas.filter((t) => cpm.get(t.id)?.critica);
  const cpmReal = criticalPath(project, durationWithResources(resources, projects));
  const previsaoFim = project.tarefas.length
    ? Math.max(...project.tarefas.map((t) => cpmReal.get(t.id)?.ef ?? parseDate(t.fim)))
    : parseDate(project.fim);
  const desvioDias = Math.round((previsaoFim - parseDate(project.fim)) / 86_400_000);
  const equipe = Array.from(new Set(project.tarefas.flatMap(taskResponsibles)));
  const cargas = portfolioLoad(resources, projects).filter((c) => equipe.includes(c.recurso.nome));
  const semCadastro = equipe.filter((n) => !findResource(resources, n));

  return (
    <AppShell
      title={project.nome}
      subtitle={`${project.id} · GP ${project.gerente} · Sponsor ${project.sponsor}`}
      actions={
        <TaskDialog project={project} trigger={<Button size="sm">Nova tarefa</Button>} />
      }
    >
      <Link to="/projetos" className="text-xs text-muted-foreground hover:text-foreground">
        ← Portfólio de projetos
      </Link>

      <div className="mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-5">
          <div className="glass-panel rounded-2xl border border-border/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="max-w-2xl text-sm text-muted-foreground">{project.objetivo}</p>
              <Select
                value={project.status}
                onValueChange={(v) => updateProject(project.id, { status: v as ProjectStatus })}
              >
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <Metric label="Período" value={`${fmtDate(project.inicio)} — ${fmtDate(project.fim)}`} />
              <Metric label="Tarefas" value={`${project.tarefas.length}`} hint={`${criticas.length} crítica(s)`} />
              <Metric label="Progresso" value={`${progresso}%`} hint={`esperado ${esperado}%`} />
              <Metric
                label="Previsão real"
                value={fmtDate(toISODate(previsaoFim))}
                hint={desvioDias > 0 ? `${desvioDias}d de desvio` : "dentro do plano"}
                alerta={desvioDias > 0}
              />
            </div>
            <Progress value={progresso} className="mt-4 h-2" />
          </div>

      <Tabs defaultValue="tarefas">
        <TabsList>
          <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="recursos">Recursos</TabsTrigger>
        </TabsList>

        <TabsContent value="cronograma">
          <div className="glass-panel rounded-2xl border border-border/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Cronograma e caminho crítico</h3>
              <span className="text-xs text-muted-foreground">
                {criticas.length} tarefa(s) crítica(s) · atraso nelas desloca o fim do projeto
              </span>
            </div>
            <Gantt project={project} />
          </div>
          {criticas.length ? (
            <div className="glass-panel mt-4 rounded-2xl border border-destructive/30 p-5">
              <h3 className="text-sm font-semibold text-destructive">Caminho crítico</h3>
              <ol className="mt-2 space-y-1 text-sm">
                {criticas.map((t, i) => (
                  <li key={t.id} className="text-muted-foreground">
                    {i + 1}. <span className="text-foreground">{t.nome}</span> ·{" "}
                    {taskDurationLabel(t)} · {t.progresso}% concluída
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="kanban">
          <div className="glass-panel rounded-2xl border border-border/60 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">Quadro de tarefas</h3>
                <p className="text-xs text-muted-foreground">
                  Arraste os post-its entre as colunas. Ao mover para <strong>Concluído</strong>, a
                  tarefa vai a 100% e assume a data de hoje como fim.
                </p>
              </div>
              <TaskDialog
                project={project}
                trigger={
                  <Button size="sm" variant="outline">
                    Nova tarefa
                  </Button>
                }
              />
            </div>
            <div className="mt-4">
              <ProjectKanban project={project} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tarefas">
          <div className="glass-panel overflow-x-auto rounded-2xl border border-border/60 p-5">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="w-10 py-2 text-left">#</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Tarefa</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Responsáveis</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Duração</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Período</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">%</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {project.tarefas.map((t, idx) => {
                  const s = cpm.get(t.id);
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2" style={{ paddingLeft: t.paiId ? 20 : 0 }}>
                        <div className="flex items-center gap-2">
                          <TaskDialog
                            project={project}
                            afterTask={t}
                            trigger={
                              <button
                                type="button"
                                title="Adicionar tarefa abaixo desta"
                                aria-label={`Adicionar tarefa abaixo de ${t.nome}`}
                                className="grid h-5 w-5 shrink-0 place-items-center rounded border border-border/60 text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            }
                          />
                          {s?.critica ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                          ) : null}
                          <span>{t.nome}</span>
                          {t.marco ? (
                            <Badge variant="outline" className="border-warning/40 text-warning">
                              marco
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {t.atividade ?? "Execução"}
                          {s?.critica ? (
                            <span className="text-destructive"> · caminho crítico</span>
                          ) : (
                            ` · folga ${s?.folga ?? 0}d`
                          )}
                          {(t.predecessoras ?? []).length
                            ? ` · após ${(t.predecessoras ?? [])
                                .map((p) => {
                                  const i = project.tarefas.findIndex((x) => x.id === p);
                                  return i >= 0
                                    ? `${i + 1}. ${project.tarefas[i]!.nome}`
                                    : p;
                                })
                                .join(", ")}`
                            : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {(t.responsaveis ?? [t.responsavel]).join(", ")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{taskDurationLabel(t)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {fmtDate(t.inicio)} — {fmtDate(t.fim)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={t.progresso}
                          onChange={(e) =>
                            updateTask(project.id, t.id, {
                              progresso: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            })
                          }
                          className="w-14 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <TaskDialog
                            project={project}
                            task={t}
                            trigger={
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar tarefa">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            title="Excluir tarefa"
                            onClick={() => removeTask(project.id, t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!project.tarefas.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma tarefa cadastrada ainda.
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Total planejado:{" "}
              {Math.round(project.tarefas.reduce((a, t) => a + taskDurationDays(t), 0))} dias de
              trabalho distribuídos.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="recursos">
          <div className="glass-panel rounded-2xl border border-border/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Capacidade e ritmo real</h3>
              <span
                className={cn(
                  "text-xs",
                  desvioDias > 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                Previsão com disponibilidade: {fmtDateFull(toISODate(previsaoFim))}
                {desvioDias > 0 ? ` · ${desvioDias} dia(s) além do planejado` : " · dentro do plano"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              A duração real considera o percentual do dia que cada pessoa tem para projetos e a
              concorrência com tarefas de outros projetos do portfólio.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="py-2 text-left">Tarefa</th>
                    <th className="py-2 text-left">Responsáveis</th>
                    <th className="py-2 text-left">Alocação</th>
                    <th className="py-2 text-left">Duração planejada</th>
                    <th className="py-2 text-left">Duração real</th>
                    <th className="py-2 text-left">Término previsto</th>
                  </tr>
                </thead>
                <tbody>
                  {project.tarefas.map((t) => {
                    const real = effectiveDurationDays(t, resources, projects);
                    const plano = taskDurationDays(t);
                    return (
                      <tr key={t.id} className="border-b border-border/40">
                        <td className="py-2">{t.nome}</td>
                        <td className="py-2 text-muted-foreground">{taskResponsibles(t).join(", ")}</td>
                        <td className="py-2 text-muted-foreground">{taskAllocation(t)}%</td>
                        <td className="py-2 text-muted-foreground">{Math.round(plano)} d</td>
                        <td className={cn("py-2", real > plano * 1.2 && "text-warning")}>
                          {Math.ceil(real)} d
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {fmtDate(toISODate(cpmReal.get(t.id)?.ef ?? parseDate(t.fim)))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!project.tarefas.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Cadastre tarefas para simular a capacidade da equipe.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {cargas.map((c) => (
              <div
                key={c.recurso.id}
                className={cn(
                  "glass-panel rounded-2xl border p-5",
                  c.conflito ? "border-destructive/50" : "border-border/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="font-medium">{c.recurso.nome}</h4>
                    <p className="text-xs text-muted-foreground">
                      {c.recurso.disponibilidadeProjetos}% do dia para projetos ·{" "}
                      {c.capacidadeHoras.toFixed(1)}h/dia
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={c.conflito ? HEALTH_CLASS.vermelho : HEALTH_CLASS.verde}
                  >
                    {Math.round(c.demandaPct)}% alocado
                  </Badge>
                </div>
                <Progress value={Math.min(c.demandaPct, 100)} className="mt-3 h-1.5" />
                <p className="mt-2 text-xs text-muted-foreground">
                  Atua em {c.projetos.length} projeto(s): {c.projetos.join(", ") || "—"}
                </p>
              </div>
            ))}
            {semCadastro.length ? (
              <p className="text-sm text-warning">
                Sem cadastro de recurso: {semCadastro.join(", ")} — considerados 100% disponíveis até
                serem cadastrados em Recursos e capacidade.
              </p>
            ) : null}
          </div>
        </TabsContent>

      </Tabs>

          {health ? (
            <p className="text-xs text-muted-foreground">
              Saúde geral do projeto: {HEALTH_LABEL[health.geral]}
            </p>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <div className="glass-panel space-y-3 rounded-2xl border border-border/60 p-5">
            <h3 className="text-sm font-semibold">Semáforos de governança</h3>
            {health ? (
              <div className="grid gap-2">
                <Semaforo tone={health.prazo} label={`Prazo (${health.atrasoPct}% atraso)`} />
                <Semaforo
                  tone={health.atualizacao}
                  label={
                    health.diasSemAtualizacao === null
                      ? "Sem atualização"
                      : `${health.diasSemAtualizacao}d sem update`
                  }
                />
                <Semaforo tone={health.risco} label={`Riscos (${(project.riscos ?? []).length})`} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Calculando...</p>
            )}
            {health?.alertas.length ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {health.alertas.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <SidePanel
            titulo="Riscos"
            contagem={(project.riscos ?? []).length}
            acao={<RiskDialog project={project} />}
          >
            {(project.riscos ?? []).length ? (
              <ul className="space-y-2">
                {(project.riscos ?? []).map((r) => (
                  <li key={r.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>Prob. {r.probabilidade}</span>
                      <span>· Impacto {r.impacto}</span>
                      <span>· {r.status}</span>
                    </div>
                    <p className="mt-1 text-sm">{r.descricao}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Mitigação: {r.mitigacao || "—"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-warning">Nenhum risco cadastrado — projeto em alerta.</p>
            )}
          </SidePanel>

          <SidePanel
            titulo="Atualizações"
            contagem={(project.atualizacoes ?? []).length}
            acao={<WeeklyUpdateDialog project={project} />}
          >
            {(project.atualizacoes ?? []).length ? (
              <ul className="space-y-2">
                {(project.atualizacoes ?? []).map((u) => (
                  <li key={u.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{new Date(u.data).toLocaleDateString("pt-BR")}</span>
                      <span>{u.autor}</span>
                    </div>
                    <p className="mt-1 text-sm">{u.descricao}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Próximas: {u.proximasEntregas || "—"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma atualização registrada — o projeto está sinalizado em vermelho.
              </p>
            )}
          </SidePanel>

          <SidePanel
            titulo="Pontos de atenção"
            contagem={(project.atencoes ?? []).filter((a) => a.status === "aberto").length}
            acao={<AttentionDialog project={project} />}
          >
            {(project.atencoes ?? []).length ? (
              <ul className="space-y-2">
                {(project.atencoes ?? []).map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "rounded-lg border p-3",
                      a.status === "aberto" ? "border-destructive/40" : "border-border/60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{a.titulo}</p>
                      {a.status === "aberto" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => resolveAttention(project.id, a.id)}
                        >
                          Resolver
                        </Button>
                      ) : (
                        <Badge variant="outline" className={HEALTH_CLASS.verde}>
                          Resolvido
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.descricao}</p>
                    <p className="mt-1 text-xs">
                      <span className="text-muted-foreground">Decisão: </span>
                      {a.decisaoNecessaria} · {a.responsavelDecisao}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum ponto de atenção aberto.</p>
            )}
          </SidePanel>

          <AiCoach project={project} />
        </aside>
      </div>
    </AppShell>
  );
}
