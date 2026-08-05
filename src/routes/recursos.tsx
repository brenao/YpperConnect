import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/views/app-shell";
import { ResourceDialog } from "@/views/resource-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useHydrated } from "@/hooks/use-hydrated";
import { useItsm } from "@/controllers/itsm-store";
import { capacityHours, portfolioLoad } from "@/services/resource-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recursos")({
  head: () => ({
    meta: [
      { title: "Recursos e capacidade · YpperConnect" },
      {
        name: "description",
        content:
          "Cadastro de recursos de TI com percentual de disponibilidade diária para projetos, alocação multiprojeto e alertas de sobrealocação.",
      },
      { property: "og:title", content: "Recursos e capacidade · YpperConnect" },
      {
        property: "og:description",
        content: "Disponibilidade diária, alocação multiprojeto e conflitos de capacidade da equipe de TI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Recursos,
});

function Recursos() {
  const { resources, projects, removeResource } = useItsm();
  const hydrated = useHydrated();
  const [busca, setBusca] = useState("");

  const cargas = useMemo(
    () => (hydrated ? portfolioLoad(resources, projects) : []),
    [hydrated, resources, projects],
  );

  const filtradas = cargas.filter((c) =>
    `${c.recurso.nome} ${c.recurso.equipe} ${c.recurso.papel}`
      .toLowerCase()
      .includes(busca.trim().toLowerCase()),
  );

  const conflitos = cargas.filter((c) => c.conflito).length;
  const capacidadeTotal = resources.reduce((acc, r) => acc + capacityHours(r), 0);
  const comprometido = cargas.reduce((acc, c) => acc + c.horasComprometidas, 0);

  return (
    <AppShell
      title="Recursos e capacidade"
      subtitle="Disponibilidade diária para projetos, alocação multiprojeto e conflitos de capacidade"
      actions={<ResourceDialog />}
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="glass-panel rounded-2xl border border-border/60 p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Capacidade de projetos</p>
          <p className="mt-2 font-mono text-3xl font-semibold">
            {capacidadeTotal.toFixed(1)}h<span className="text-base">/dia</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{resources.length} recursos cadastrados</p>
        </div>
        <div className="glass-panel rounded-2xl border border-border/60 p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Comprometido hoje</p>
          <p className="mt-2 font-mono text-3xl font-semibold">{comprometido.toFixed(1)}h</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {capacidadeTotal ? Math.round((comprometido / capacidadeTotal) * 100) : 0}% da capacidade
          </p>
        </div>
        <div className="glass-panel rounded-2xl border border-border/60 p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sobrealocados</p>
          <p
            className={cn(
              "mt-2 font-mono text-3xl font-semibold",
              conflitos ? "text-destructive" : "text-success",
            )}
          >
            {conflitos}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Recursos acima de 100% da capacidade</p>
        </div>
      </section>

      <div className="mt-6">
        <Input
          placeholder="Buscar recurso, papel ou equipe..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {filtradas.map((c) => (
          <div
            key={c.recurso.id}
            className={cn(
              "glass-panel rounded-2xl border p-5",
              c.conflito ? "border-destructive/50" : "border-border/60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{c.recurso.nome}</h3>
                <p className="text-xs text-muted-foreground">
                  {c.recurso.papel} · {c.recurso.equipe}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <ResourceDialog
                  resource={c.recurso}
                  trigger={
                    <Button size="sm" variant="outline">
                      Editar
                    </Button>
                  }
                />
                <Button size="sm" variant="ghost" onClick={() => removeResource(c.recurso.id)}>
                  Remover
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div>
                <span className="block uppercase tracking-wide">Jornada</span>
                <span className="text-foreground">{c.recurso.horasDia}h/dia</span>
              </div>
              <div>
                <span className="block uppercase tracking-wide">Para projetos</span>
                <span className="text-foreground">
                  {c.recurso.disponibilidadeProjetos}% · {c.capacidadeHoras.toFixed(1)}h
                </span>
              </div>
              <div>
                <span className="block uppercase tracking-wide">Comprometido</span>
                <span className="text-foreground">{c.horasComprometidas.toFixed(1)}h</span>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Alocação em projetos</span>
                <span className={cn("font-medium", c.conflito && "text-destructive")}>
                  {Math.round(c.demandaPct)}%
                </span>
              </div>
              <Progress value={Math.min(c.demandaPct, 100)} className="h-1.5" />
            </div>

            <div className="mt-4 space-y-1 text-xs">
              {c.atribuicoes.length ? (
                c.atribuicoes.map((a) => (
                  <div key={`${a.projectId}-${a.taskId}`} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">
                      {a.projectNome} · {a.taskNome}
                    </span>
                    <span className="shrink-0">{a.alocacaoPct}%</span>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">Sem tarefas ativas hoje.</span>
              )}
            </div>

            {c.conflito ? (
              <Badge variant="outline" className="mt-3 border-destructive/40 text-destructive">
                Sobrealocado em {c.projetos.length} projeto(s) — replaneje o cronograma
              </Badge>
            ) : null}
          </div>
        ))}
        {hydrated && filtradas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum recurso encontrado.</p>
        ) : null}
      </div>
    </AppShell>
  );
}
