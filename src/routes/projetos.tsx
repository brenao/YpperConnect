import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/itsm/app-shell";
import { Progress } from "@/components/ui/progress";
import { useItsm } from "@/lib/itsm-store";
import type { Project } from "@/lib/itsm-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projetos")({
  head: () => ({
    meta: [
      { title: "Projetos e cronograma · GovTI" },
      {
        name: "description",
        content:
          "Cadastro de projetos de TI com cronograma visual, marcos, responsáveis e progresso das iniciativas de governança.",
      },
      { property: "og:title", content: "Projetos e cronograma · GovTI" },
      {
        property: "og:description",
        content: "Cronograma das iniciativas de governança de TI com marcos e responsáveis.",
      },
    ],
  }),
  component: Projetos,
});

const statusStyle: Record<Project["status"], string> = {
  planejamento: "bg-info/12 text-info border-info/30",
  execucao: "bg-primary/12 text-primary border-primary/30",
  risco: "bg-destructive/12 text-destructive border-destructive/30",
  concluido: "bg-success/12 text-success border-success/30",
};

const statusLabel: Record<Project["status"], string> = {
  planejamento: "Planejamento",
  execucao: "Em execução",
  risco: "Em risco",
  concluido: "Concluído",
};

const fmt = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

function Gantt({ project }: { project: Project }) {
  const start = new Date(`${project.inicio}T00:00:00`).getTime();
  const end = new Date(`${project.fim}T00:00:00`).getTime();
  const span = Math.max(end - start, 1);
  const hoje = Date.now();
  const hojePct = ((hoje - start) / span) * 100;

  return (
    <div className="relative mt-4 space-y-2">
      {hojePct > 0 && hojePct < 100 ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/60"
          style={{ left: `calc(14rem + (100% - 14rem) * ${hojePct / 100})` }}
        />
      ) : null}
      {project.tarefas.map((t) => {
        const ts = new Date(`${t.inicio}T00:00:00`).getTime();
        const te = new Date(`${t.fim}T00:00:00`).getTime();
        const left = ((ts - start) / span) * 100;
        const width = Math.max(((te - ts) / span) * 100, 1.5);
        return (
          <div key={t.id} className="flex items-center gap-3">
            <div className="w-56 shrink-0">
              <p className="truncate text-sm">{t.nome}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t.responsavel} · {fmt(t.inicio)} → {fmt(t.fim)}
              </p>
            </div>
            <div className="relative h-7 flex-1 rounded-md bg-surface">
              <div
                className={cn(
                  "absolute top-1 h-5 rounded-md border",
                  t.marco
                    ? "border-warning bg-warning/30"
                    : "border-primary/40 bg-primary/20",
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                <div
                  className="h-full rounded-md bg-primary/60"
                  style={{ width: `${t.progresso}%` }}
                />
              </div>
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
              {t.progresso}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Projetos() {
  const { projects } = useItsm();

  return (
    <AppShell
      title="Projetos e cronograma"
      subtitle="Iniciativas estruturantes de governança de TI com marcos, responsáveis e progresso"
    >
      <div className="space-y-5">
        {projects.map((p) => {
          const progresso = Math.round(
            p.tarefas.reduce((acc, t) => acc + t.progresso, 0) / (p.tarefas.length || 1),
          );
          return (
            <section key={p.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs font-medium",
                        statusStyle[p.status],
                      )}
                    >
                      {statusLabel[p.status]}
                    </span>
                  </div>
                  <h2 className="mt-2 text-base font-semibold">{p.nome}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{p.objetivo}</p>
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <span>Sponsor: {p.sponsor}</span>
                  <span>Gerente: {p.gerente}</span>
                  <span>
                    Janela: {fmt(p.inicio)} → {fmt(p.fim)}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Progress value={progresso} className="h-2" />
                <span className="font-mono text-xs text-muted-foreground">{progresso}%</span>
              </div>

              <Gantt project={p} />
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}