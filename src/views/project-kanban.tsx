import { useState } from "react";
import { CalendarDays, GripVertical, User } from "lucide-react";
import { toast } from "sonner";
import { useItsm } from "@/lib/itsm-store";
import { KANBAN_LABEL, type KanbanStatus, type Project, type ProjectTask } from "@/lib/itsm-types";
import { fmtDate, toISODate } from "@/lib/project-utils";
import { cn } from "@/lib/utils";

const COLUNAS: KanbanStatus[] = ["backlog", "todo", "doing", "done"];

const COL_ACCENT: Record<KanbanStatus, string> = {
  backlog: "bg-muted-foreground/40",
  todo: "bg-info",
  doing: "bg-warning",
  done: "bg-success",
};

/** Coluna atual da tarefa: explícita quando movida, senão derivada do progresso. */
export function taskBoard(t: ProjectTask): KanbanStatus {
  if (t.quadro) return t.quadro;
  if (t.progresso >= 100) return "done";
  if (t.progresso > 0) return "doing";
  return "backlog";
}

function PostIt({
  task,
  project,
  onDragStart,
}: {
  task: ProjectTask;
  project: Project;
  onDragStart: () => void;
}) {
  const pessoas = task.responsaveis ?? [task.responsavel];
  const done = taskBoard(task) === "done";
  return (
    <article
      draggable
      onDragStart={onDragStart}
      className={cn(
        "group cursor-grab rounded-[4px] border border-amber-300/60 bg-amber-200 p-3 text-neutral-900 shadow-[3px_4px_10px_-4px_rgba(0,0,0,0.55)] transition-transform active:cursor-grabbing",
        "rotate-[-0.6deg] hover:rotate-0 hover:shadow-[4px_6px_14px_-4px_rgba(0,0,0,0.6)]",
        done && "bg-amber-100",
      )}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-900/40" />
        <h4 className={cn("min-w-0 text-sm font-semibold leading-snug", done && "line-through opacity-70")}>
          {task.nome}
        </h4>
      </div>
      <p className="mt-1 pl-5 text-[11px] text-neutral-900/70">{task.atividade ?? "Execução"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-[11px] text-neutral-900/70">
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3" /> {pessoas.join(", ")}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3" /> {fmtDate(task.inicio)} — {fmtDate(task.fim)}
        </span>
      </div>
      <div className="mt-2 pl-5">
        <div className="h-1 overflow-hidden rounded-full bg-neutral-900/15">
          <div className="h-full rounded-full bg-neutral-900/60" style={{ width: `${task.progresso}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-900/60">
          <span>{project.id}</span>
          <span>{task.progresso}%</span>
        </div>
      </div>
    </article>
  );
}

/** Quadro kanban das tarefas de um projeto (backlog / a fazer / em andamento / concluído). */
export function ProjectKanban({ project }: { project: Project }) {
  const { updateTask } = useItsm();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<KanbanStatus | null>(null);

  function mover(taskId: string, coluna: KanbanStatus) {
    const t = project.tarefas.find((x) => x.id === taskId);
    if (!t || taskBoard(t) === coluna) return;
    if (coluna === "done") {
      const hoje = toISODate(Date.now());
      updateTask(project.id, taskId, {
        quadro: "done",
        progresso: 100,
        fim: hoje,
        concluidoEm: hoje,
      });
      toast.success(`"${t.nome}" concluída`, { description: `100% · fim ajustado para ${fmtDate(hoje)}` });
      return;
    }
    updateTask(project.id, taskId, {
      quadro: coluna,
      concluidoEm: undefined,
      ...(t.progresso >= 100 ? { progresso: coluna === "doing" ? 90 : 0 } : {}),
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUNAS.map((col) => {
        const itens = project.tarefas.filter((t) => taskBoard(t) === col);
        return (
          <section
            key={col}
            onDragOver={(e) => {
              e.preventDefault();
              setSobre(col);
            }}
            onDragLeave={() => setSobre((s) => (s === col ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              if (arrastando) mover(arrastando, col);
              setArrastando(null);
            }}
            className={cn(
              "glass-panel flex min-h-[240px] flex-col rounded-2xl border border-border/60 p-3 transition-colors",
              sobre === col && "border-primary/60 bg-primary/5",
            )}
          >
            <header className="flex items-center gap-2 px-1 pb-3">
              <span className={cn("h-2 w-2 rounded-full", COL_ACCENT[col])} />
              <h3 className="text-sm font-semibold">{KANBAN_LABEL[col]}</h3>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{itens.length}</span>
            </header>
            <div className="flex flex-col gap-3">
              {itens.map((t) => (
                <PostIt key={t.id} task={t} project={project} onDragStart={() => setArrastando(t.id)} />
              ))}
              {!itens.length ? (
                <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                  Arraste tarefas para cá
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
