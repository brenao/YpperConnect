import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { ResourceDialog } from "@/views/resource-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { capacidadeProjeto, type Recurso } from "@/repositories/recursos.repo";
import { listarRecursosFn, definirRecursoAtivoFn } from "@/services/recursos.functions";
import { usuarioAtualFn } from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recursos")({
  head: () => ({
    meta: [
      { title: "Recursos e capacidade · Beagle One" },
      {
        name: "description",
        content:
          "Cadastro de recursos de TI com percentual de disponibilidade diária para projetos, alocação multiprojeto e alertas de sobrealocação.",
      },
      { property: "og:title", content: "Recursos e capacidade · Beagle One" },
      {
        property: "og:description",
        content:
          "Disponibilidade diária, alocação multiprojeto e conflitos de capacidade da equipe de TI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Recursos,
});

function Recursos() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const q = useQuery({ queryKey: ["recursos"], queryFn: () => listarRecursosFn() });

  const isTi = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;
  const recursos: Recurso[] = useMemo(() => q.data?.recursos ?? [], [q.data]);

  /** Carga vinda das tarefas de projeto, indexada por recurso. */
  const cargaPorId = useMemo(() => {
    const m = new Map<string, { horas: number; projetos: number }>();
    for (const c of q.data?.cargas ?? []) {
      m.set(c.recursoId, { horas: c.horasComprometidas, projetos: c.projetosAtivos });
    }
    return m;
  }, [q.data]);

  const alternar = useMutation({
    mutationFn: (v: { id: string; ativo: boolean }) => definirRecursoAtivoFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["recursos"] });
      toast.success(v.ativo ? "Recurso reativado" : "Recurso desativado");
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return recursos
      .filter((r) => mostrarInativos || r.ativo)
      .filter(
        (r) => !t || `${r.nome} ${r.papel ?? ""} ${r.equipeNome ?? ""}`.toLowerCase().includes(t),
      );
  }, [recursos, busca, mostrarInativos]);

  const ativos = recursos.filter((r) => r.ativo);
  const capacidadeTotal = ativos.reduce((acc, r) => acc + capacidadeProjeto(r), 0);
  const comprometido = [...cargaPorId.values()].reduce((acc, c) => acc + c.horas, 0);
  const conflitos = ativos.filter(
    (r) => (cargaPorId.get(r.id)?.horas ?? 0) > capacidadeProjeto(r),
  ).length;

  const semAlocacao = (q.data?.cargas ?? []).length === 0;

  return (
    <AppShell
      title="Recursos e capacidade"
      subtitle="Disponibilidade diária para projetos, alocação multiprojeto e conflitos de capacidade"
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os recursos: {String(q.error)}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Capacidade de projetos
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold">
              {capacidadeTotal.toFixed(1)}h<span className="text-base">/dia</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ativos.length} recurso(s) ativo(s)
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Comprometido hoje
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold">{comprometido.toFixed(1)}h</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {capacidadeTotal ? Math.round((comprometido / capacidadeTotal) * 100) : 0}% da
              capacidade
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sobrealocados</p>
            <p
              className={cn(
                "mt-2 font-mono text-3xl font-semibold",
                conflitos ? "text-destructive" : "text-success",
              )}
            >
              {conflitos}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recursos acima de 100% da capacidade
            </p>
          </div>
        </section>

        {semAlocacao && recursos.length > 0 ? (
          <div className="panel border-warning/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Alocação zerada.</p>
            <p className="mt-1">
              A carga vem das tarefas de projeto em andamento. Nenhuma tarefa tem responsável
              alocado no período atual — vincule os recursos às tarefas dentro de cada projeto.
            </p>
          </div>
        ) : null}

        {/* Ação de coleção fica junto da coleção. O cabeçalho é reservado
            à identidade e ao "Abrir chamado", que é global de toda tela. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, papel ou equipe"
              className="pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setMostrarInativos((v) => !v)}
          >
            {mostrarInativos ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {mostrarInativos ? "Ocultar inativos" : "Mostrar inativos"}
          </Button>
          {isTi ? <ResourceDialog /> : null}
        </div>

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando recursos...
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visiveis.map((r) => {
              const capacidade = capacidadeProjeto(r);
              const carga = cargaPorId.get(r.id);
              const horas = carga?.horas ?? 0;
              const pct = capacidade ? Math.round((horas / capacidade) * 100) : 0;
              const conflito = horas > capacidade;

              return (
                <article key={r.id} className={cn("panel p-5", r.ativo ? "" : "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{r.nome}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.papel ?? "Sem papel definido"}
                        {r.equipeNome ? ` · ${r.equipeNome}` : ""}
                      </p>
                    </div>
                    {isTi ? (
                      <div className="flex shrink-0 gap-1">
                        <ResourceDialog
                          resource={r}
                          trigger={
                            <Button variant="ghost" size="icon" className="size-7" title="Editar">
                              <Pencil className="size-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title={r.ativo ? "Desativar" : "Reativar"}
                          disabled={alternar.isPending}
                          onClick={() => alternar.mutate({ id: r.id, ativo: !r.ativo })}
                        >
                          {r.ativo ? (
                            <EyeOff className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Eye className="size-3.5 text-success" />
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!r.ativo ? (
                      <Badge variant="outline" className="text-xs">
                        Inativo
                      </Badge>
                    ) : null}
                    {r.usuarioId ? null : (
                      <Badge variant="outline" className="text-xs">
                        Sem vínculo no sistema
                      </Badge>
                    )}
                    {conflito ? (
                      <Badge
                        variant="outline"
                        className="border-destructive/40 text-xs text-destructive"
                      >
                        Sobrealocado
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {horas.toFixed(1)}h de {capacidade.toFixed(1)}h/dia
                      </span>
                      <span
                        className={cn(
                          "font-mono",
                          conflito ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {pct}%
                      </span>
                    </div>
                    <Progress value={Math.min(100, pct)} />
                    <p className="text-xs text-muted-foreground">
                      Jornada {r.horasDia}h · {r.disponibilidadeProjetos}% para projetos
                      {carga?.projetos ? ` · ${carga.projetos} projeto(s)` : ""}
                    </p>
                  </div>
                </article>
              );
            })}

            {visiveis.length === 0 ? (
              <p className="panel col-span-full px-5 py-10 text-center text-sm text-muted-foreground">
                Nenhum recurso cadastrado.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
