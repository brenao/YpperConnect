import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { QuadroTarefa, Tarefa } from "@/repositories/projetos.repo";
import { moverTarefaFn } from "@/services/projetos.functions";
import { cn } from "@/lib/utils";

export const QUADROS: { key: QuadroTarefa; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "A fazer" },
  { key: "doing", label: "Em andamento" },
  { key: "done", label: "Concluído" },
];

function fmt(v: Date | string): string {
  return new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ProjectKanban({
  projetoId,
  tarefas,
  responsaveis,
  nomeRecurso,
  editavel,
  onEditar,
}: {
  projetoId: string;
  tarefas: Tarefa[];
  responsaveis: Record<string, string[]>;
  nomeRecurso: (id: string) => string;
  editavel: boolean;
  onEditar: (t: Tarefa) => void;
}) {
  const qc = useQueryClient();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<QuadroTarefa | null>(null);

  const mover = useMutation({
    mutationFn: (v: { id: string; quadro: QuadroTarefa }) => moverTarefaFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projeto", projetoId] });
      qc.invalidateQueries({ queryKey: ["projetos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível mover", { description: e.message }),
  });

  function soltar(quadro: QuadroTarefa) {
    setSobre(null);
    if (!arrastando) return;
    const t = tarefas.find((x) => x.id === arrastando);
    setArrastando(null);
    if (!t || t.quadro === quadro) return;
    mover.mutate({ id: t.id, quadro });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {QUADROS.map((col) => {
        const itens = tarefas.filter((t) => t.quadro === col.key);
        return (
          <section
            key={col.key}
            onDragOver={(e) => {
              if (!editavel) return;
              e.preventDefault();
              setSobre(col.key);
            }}
            onDragLeave={() => setSobre(null)}
            onDrop={() => editavel && soltar(col.key)}
            className={cn(
              "rounded-xl border border-border bg-surface p-3 transition-colors",
              sobre === col.key ? "border-primary/50 bg-primary/5" : "",
            )}
          >
            <header className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">{col.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{itens.length}</span>
            </header>

            <ul className="space-y-2">
              {itens.map((t) => {
                const done = t.quadro === "done";
                return (
                  <li key={t.id}>
                    <button
                      draggable={editavel}
                      onDragStart={() => setArrastando(t.id)}
                      onDragEnd={() => setArrastando(null)}
                      onClick={() => editavel && onEditar(t)}
                      className={cn(
                        "w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40",
                        editavel ? "cursor-grab active:cursor-grabbing" : "cursor-default",
                        arrastando === t.id ? "opacity-50" : "",
                      )}
                    >
                      <p
                        className={cn(
                          "text-sm font-medium leading-snug",
                          done ? "line-through opacity-70" : "",
                        )}
                      >
                        {t.nome}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {t.marco ? (
                          <Badge variant="outline" className="text-[10px]">
                            marco
                          </Badge>
                        ) : null}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {fmt(t.inicio)} — {fmt(t.fim)}
                        </span>
                      </div>

                      {(responsaveis[t.id] ?? []).length > 0 ? (
                        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                          {(responsaveis[t.id] ?? []).map(nomeRecurso).join(", ")}
                        </p>
                      ) : null}

                      {!done && t.progresso > 0 ? (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${t.progresso}%` }}
                          />
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}

              {itens.length === 0 ? (
                <li className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                  Vazio
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
