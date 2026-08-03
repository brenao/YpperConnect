import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/itsm/app-shell";
import {
  AttentionDialog,
  RiskDialog,
  TaskDialog,
  WeeklyUpdateDialog,
} from "@/components/itsm/project-forms";
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
} from "@/lib/project-utils";
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
  const cpm = useMemo(() => criticalPath(project), [project]);
  const start = Math.min(parseDate(project.inicio), ...project.tarefas.map((t) => parseDate(t.inicio)));
  const end = Math.max(parseDate(project.fim), ...project.tarefas.map((t) => parseDate(t.fim)));
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
      {project.tarefas.map((t) => {
        const sched = cpm.get(t.id);
        const left = ((parseDate(t.inicio) - start) / span) * 100;
        const width = Math.max(((parseDate(t.fim) - parseDate(t.inicio)) / span) * 100, 1.5);
        const critica = sched?.critica;
        return (
          <div key={t.id} className="flex items-center gap-3 text-sm">
            <div className="w-64 shrink-0" style={{ paddingLeft: t.paiId ? 16 : 0 }}>
              <div className="flex items-center gap-2">
                {critica ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" title="Tarefa crítica" />
                ) : null}
                <span className="truncate">{t.nome}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {(t.responsaveis ?? [t.responsavel]).join(", ")} · {taskDurationLabel(t)}
              </span>
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
              {fmtDate(t.inicio)} — {fmtDate(t.fim)}
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

function ProjetoDetalhe() {
  const { projectId } = Route.useParams();
  const { projects, updateProject, updateTask, removeTask, resolveAttention } = useItsm();
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

  return (
    <AppShell
      title={project.nome}
      subtitle={`${project.id} · GP ${project.gerente} · Sponsor ${project.sponsor}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <WeeklyUpdateDialog project={project} />
          <RiskDialog project={project} />
          <AttentionDialog project={project} />
          <TaskDialog project={project} trigger={<Button size="sm">Nova tarefa</Button>} />
        </div>
      }
    >
      <Link to="/projetos" className="text-xs text-muted-foreground hover:text-foreground">
        ← Portfólio de projetos
      </Link>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <div className="glass-panel rounded-2xl border border-border/60 p-5 lg:col-span-2">
          <p className="text-sm text-muted-foreground">{project.objetivo}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {fmtDateFull(project.inicio)} — {fmtDateFull(project.fim)}
            </span>
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
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Progresso {progresso}% · esperado {esperado}%
              </span>
              <span className="font-medium">{project.tarefas.length} tarefas</span>
            </div>
            <Progress value={progresso} className="h-2" />
          </div>
        </div>

        <div className="glass-panel space-y-3 rounded-2xl border border-border/60 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold">Semáforos de governança</h3>
          {health ? (
            <div className="grid gap-2 sm:grid-cols-3">
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
      </div>

      <Tabs defaultValue="cronograma" className="mt-6">
        <TabsList>
          <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
          <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          <TabsTrigger value="atualizacoes">Atualizações</TabsTrigger>
          <TabsTrigger value="riscos">Riscos</TabsTrigger>
          <TabsTrigger value="atencoes">Atenções</TabsTrigger>
          <TabsTrigger value="ia">Instrutor IA</TabsTrigger>
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

        <TabsContent value="tarefas">
          <div className="glass-panel overflow-x-auto rounded-2xl border border-border/60 p-5">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left">Tarefa</th>
                  <th className="py-2 text-left">Responsáveis</th>
                  <th className="py-2 text-left">Duração</th>
                  <th className="py-2 text-left">Período</th>
                  <th className="py-2 text-left">Folga</th>
                  <th className="py-2 text-left">%</th>
                  <th className="py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {project.tarefas.map((t) => {
                  const s = cpm.get(t.id);
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="py-2" style={{ paddingLeft: t.paiId ? 20 : 0 }}>
                        <div className="flex items-center gap-2">
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
                          {(t.predecessoras ?? []).length
                            ? ` · após ${(t.predecessoras ?? [])
                                .map((p) => project.tarefas.find((x) => x.id === p)?.nome ?? p)
                                .join(", ")}`
                            : ""}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {(t.responsaveis ?? [t.responsavel]).join(", ")}
                      </td>
                      <td className="py-2 text-muted-foreground">{taskDurationLabel(t)}</td>
                      <td className="py-2 text-muted-foreground">
                        {fmtDate(t.inicio)} — {fmtDate(t.fim)}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {s?.critica ? (
                          <span className="text-destructive">crítica</span>
                        ) : (
                          `${s?.folga ?? 0}d`
                        )}
                      </td>
                      <td className="py-2">
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
                          className="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <TaskDialog
                            project={project}
                            task={t}
                            trigger={
                              <Button size="sm" variant="ghost">
                                Editar
                              </Button>
                            }
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => removeTask(project.id, t.id)}
                          >
                            Excluir
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

        <TabsContent value="atualizacoes">
          <div className="space-y-3">
            {(project.atualizacoes ?? []).map((u) => (
              <div key={u.id} className="glass-panel rounded-2xl border border-border/60 p-5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(u.data).toLocaleDateString("pt-BR")}</span>
                  <span>{u.autor}</span>
                </div>
                <p className="mt-2 text-sm">{u.descricao}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
                  <div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Últimas entregas
                    </span>
                    <p>{u.ultimasEntregas || "—"}</p>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Próximas entregas
                    </span>
                    <p>{u.proximasEntregas || "—"}</p>
                  </div>
                </div>
              </div>
            ))}
            {!(project.atualizacoes ?? []).length ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma atualização registrada — o projeto está sinalizado em vermelho.
              </p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="riscos">
          <div className="grid gap-3 md:grid-cols-2">
            {(project.riscos ?? []).map((r) => (
              <div key={r.id} className="glass-panel rounded-2xl border border-border/60 p-5">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline">Prob. {r.probabilidade}</Badge>
                  <Badge variant="outline">Impacto {r.impacto}</Badge>
                  <Badge variant="outline">{r.status}</Badge>
                </div>
                <p className="mt-2 text-sm">{r.descricao}</p>
                <p className="mt-2 text-xs text-muted-foreground">Mitigação: {r.mitigacao || "—"}</p>
              </div>
            ))}
            {!(project.riscos ?? []).length ? (
              <p className="text-sm text-warning">
                Nenhum risco cadastrado — projeto sinalizado em alerta.
              </p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="atencoes">
          <div className="space-y-3">
            {(project.atencoes ?? []).map((a) => (
              <div
                key={a.id}
                className={cn(
                  "glass-panel rounded-2xl border p-5",
                  a.status === "aberto" ? "border-destructive/40" : "border-border/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium">{a.titulo}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{a.descricao}</p>
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">Decisão necessária: </span>
                      {a.decisaoNecessaria}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Responsável: {a.responsavelDecisao}
                    </p>
                  </div>
                  {a.status === "aberto" ? (
                    <Button size="sm" variant="outline" onClick={() => resolveAttention(project.id, a.id)}>
                      Marcar resolvido
                    </Button>
                  ) : (
                    <Badge variant="outline" className={HEALTH_CLASS.verde}>
                      Resolvido
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            {!(project.atencoes ?? []).length ? (
              <p className="text-sm text-muted-foreground">Nenhum ponto de atenção aberto.</p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="ia">
          <AiCoach project={project} />
        </TabsContent>
      </Tabs>

      {health ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Saúde geral do projeto: {HEALTH_LABEL[health.geral]}
        </p>
      ) : null}
    </AppShell>
  );
}
