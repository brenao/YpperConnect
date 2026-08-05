import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/views/app-shell";
import { NewProjectDialog } from "@/views/project-forms";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHydrated } from "@/hooks/use-hydrated";
import { useItsm } from "@/controllers/itsm-store";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import {
  HEALTH_CLASS,
  HEALTH_DOT,
  HEALTH_LABEL,
  fmtDateFull,
  projectHealth,
  projectProgress,
} from "@/services/project-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projetos")({
  head: () => ({
    meta: [
      { title: "Projetos e cronograma · YpperConnect" },
      {
        name: "description",
        content:
          "Portfólio de projetos de TI com semáforo de saúde, gerente responsável, atualização semanal e progresso do cronograma.",
      },
      { property: "og:title", content: "Projetos e cronograma · YpperConnect" },
      {
        property: "og:description",
        content: "Portfólio de projetos de TI com semáforo de saúde e progresso do cronograma.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Projetos,
});

const statusStyle: Record<ProjectStatus, string> = {
  planejamento: "bg-info/12 text-info border-info/30",
  execucao: "bg-primary/12 text-primary border-primary/30",
  paralisado: "bg-warning/12 text-warning border-warning/30",
  cancelado: "bg-muted text-muted-foreground border-border",
  concluido: "bg-success/12 text-success border-success/30",
};

function Projetos() {
  const { projects } = useItsm();
  const hydrated = useHydrated();
  const [busca, setBusca] = useState("");
  const [gp, setGp] = useState("todos");
  const [status, setStatus] = useState<"todos" | ProjectStatus>("todos");

  const gerentes = useMemo(
    () => Array.from(new Set(projects.map((p) => p.gerente))).sort(),
    [projects],
  );

  const filtrados = useMemo(
    () =>
      projects.filter(
        (p) =>
          (gp === "todos" || p.gerente === gp) &&
          (status === "todos" || p.status === status) &&
          p.nome.toLowerCase().includes(busca.trim().toLowerCase()),
      ),
    [projects, gp, status, busca],
  );

  return (
    <AppShell
      title="Projetos"
      subtitle="Portfólio de iniciativas de TI com semáforo de prazo, atualização semanal e riscos"
      actions={<NewProjectDialog />}
    >
      <div className="grid gap-3 md:grid-cols-[1fr_200px_200px]">
        <Input
          placeholder="Buscar por nome do projeto..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select value={gp} onValueChange={setGp}>
          <SelectTrigger>
            <SelectValue placeholder="Responsável (GP)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os GPs</SelectItem>
            {gerentes.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {filtrados.map((p) => {
          const health = hydrated ? projectHealth(p) : null;
          const progresso = projectProgress(p);
          return (
            <Link
              key={p.id}
              to="/projetos/$projectId"
              params={{ projectId: p.id }}
              className="glass-panel group rounded-2xl border border-border/60 p-5 transition hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {health ? (
                      <span className={cn("h-2.5 w-2.5 rounded-full", HEALTH_DOT[health.geral])} />
                    ) : null}
                    <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                  </div>
                  <h3 className="mt-1 truncate text-lg font-semibold">{p.nome}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.objetivo}</p>
                </div>
                <Badge variant="outline" className={cn("shrink-0", statusStyle[p.status])}>
                  {PROJECT_STATUS_LABEL[p.status]}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div>
                  <span className="block text-[11px] uppercase tracking-wide">GP</span>
                  <span className="text-foreground">{p.gerente}</span>
                </div>
                <div>
                  <span className="block text-[11px] uppercase tracking-wide">Sponsor</span>
                  <span className="text-foreground">{p.sponsor}</span>
                </div>
                <div>
                  <span className="block text-[11px] uppercase tracking-wide">Período</span>
                  <span className="text-foreground">
                    {fmtDateFull(p.inicio)} — {fmtDateFull(p.fim)}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] uppercase tracking-wide">Tarefas</span>
                  <span className="text-foreground">{p.tarefas.length}</span>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progresso</span>
                  <span className="font-medium">{progresso}%</span>
                </div>
                <Progress value={progresso} className="h-1.5" />
              </div>

              {health ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline" className={HEALTH_CLASS[health.geral]}>
                    {HEALTH_LABEL[health.geral]}
                  </Badge>
                  {health.alertas.slice(0, 2).map((a) => (
                    <span
                      key={a}
                      className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}
            </Link>
          );
        })}
        {filtrados.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum projeto encontrado com esses filtros.</p>
        ) : null}
      </div>
    </AppShell>
  );
}
