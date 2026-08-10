import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Loader2, ListChecks, Search } from "lucide-react";
import { AppShell } from "@/views/app-shell";
import { ProjectDialog } from "@/views/project-dialogs";
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
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import type { ProjetoComProgresso } from "@/repositories/projetos.repo";
import { listarProjetosFn } from "@/services/projetos.functions";
import { usuarioAtualFn } from "@/services/cadastros.functions";
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

type Saude = "no_prazo" | "atencao" | "atrasado" | "encerrado";

const saudeLabel: Record<Saude, string> = {
  no_prazo: "No prazo",
  atencao: "Atenção",
  atrasado: "Atrasado",
  encerrado: "Encerrado",
};

const saudeDot: Record<Saude, string> = {
  no_prazo: "bg-success",
  atencao: "bg-warning",
  atrasado: "bg-destructive",
  encerrado: "bg-muted-foreground",
};

const DIA_MS = 86_400_000;

/**
 * Semáforo por progresso esperado × real.
 *
 * Compara quanto do prazo já passou com quanto do trabalho foi feito.
 * Um projeto com 80% do tempo consumido e 30% entregue está atrasado,
 * mesmo sem ter estourado a data — que é o sinal que interessa à
 * diretoria antes de virar problema.
 */
function calcularSaude(p: ProjetoComProgresso): Saude {
  if (p.status === "concluido" || p.status === "cancelado") return "encerrado";

  const inicio = new Date(p.inicio).getTime();
  const fim = new Date(p.fim).getTime();
  const agora = Date.now();

  if (agora > fim) return "atrasado";

  const duracao = Math.max(1, fim - inicio);
  const decorrido = Math.max(0, agora - inicio);
  const esperado = (decorrido / duracao) * 100;
  const desvio = esperado - p.progresso;

  if (desvio > 25) return "atrasado";
  if (desvio > 10) return "atencao";
  return "no_prazo";
}

function fmtData(v: Date | string): string {
  return new Date(v).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function diasRestantes(fim: Date | string): number {
  return Math.ceil((new Date(fim).getTime() - Date.now()) / DIA_MS);
}

function Projetos() {
  const [busca, setBusca] = useState("");
  const [gp, setGp] = useState("todos");
  const [status, setStatus] = useState<"todos" | ProjectStatus>("todos");

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const q = useQuery({ queryKey: ["projetos"], queryFn: () => listarProjetosFn() });

  const isTi = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;
  const projetos: ProjetoComProgresso[] = useMemo(() => q.data ?? [], [q.data]);

  const gerentes = useMemo(
    () => [...new Set(projetos.map((p) => p.gerenteNome).filter(Boolean))].sort() as string[],
    [projetos],
  );

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return projetos.filter(
      (p) =>
        (gp === "todos" || p.gerenteNome === gp) &&
        (status === "todos" || p.status === status) &&
        (!t || `${p.nome} ${p.objetivo ?? ""}`.toLowerCase().includes(t)),
    );
  }, [projetos, gp, status, busca]);

  const emExecucao = projetos.filter((p) => p.status === "execucao").length;
  const atrasados = projetos.filter((p) => calcularSaude(p) === "atrasado").length;

  return (
    <AppShell
      title="Projetos"
      subtitle="Portfólio de iniciativas de TI com semáforo de prazo, atualização semanal e riscos"
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os projetos: {String(q.error)}
          </div>
        ) : null}

        {/* O botão fica junto da lista, não no cabeçalho: "Abrir chamado"
            é ação global de toda tela, e dois botões primários no mesmo
            canto competem por atenção. */}
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou objetivo..."
              value={busca}
              maxLength={120}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-8"
            />
          </div>
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
          {isTi ? <ProjectDialog /> : null}
        </div>

        {projetos.length > 0 ? (
          <div className="panel flex flex-wrap items-center gap-4 p-4 text-sm">
            <span className="text-muted-foreground">
              {projetos.length} projeto(s) · {emExecucao} em execução
            </span>
            {atrasados > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="size-4" />
                {atrasados} com progresso abaixo do esperado
              </span>
            ) : null}
          </div>
        ) : null}

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando projetos...
          </p>
        ) : filtrados.length === 0 ? (
          <div className="panel p-8 text-center">
            <ListChecks className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {projetos.length === 0 ? "Nenhum projeto cadastrado" : "Nenhum projeto encontrado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {projetos.length === 0
                ? "Cadastre o primeiro projeto para acompanhar cronograma, riscos e capacidade da equipe."
                : "Tente outros filtros."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtrados.map((p) => {
              const saude = calcularSaude(p);
              const dias = diasRestantes(p.fim);
              const encerrado = saude === "encerrado";

              return (
                <Link
                  key={p.id}
                  to="/projetos/$projectId"
                  params={{ projectId: p.id }}
                  className="panel block p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{p.nome}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {p.gerenteNome ?? "Sem gerente"}
                        {p.sponsorNome ? ` · patrocínio de ${p.sponsorNome}` : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium",
                        statusStyle[p.status],
                      )}
                    >
                      {PROJECT_STATUS_LABEL[p.status]}
                    </span>
                  </div>

                  {p.objetivo ? (
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.objetivo}</p>
                  ) : null}

                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", saudeDot[saude])} />
                        <span
                          className={cn(
                            saude === "atrasado"
                              ? "text-destructive"
                              : saude === "atencao"
                                ? "text-warning"
                                : "text-muted-foreground",
                          )}
                        >
                          {saudeLabel[saude]}
                        </span>
                      </span>
                      <span className="font-mono">{p.progresso}%</span>
                    </div>
                    <Progress value={p.progresso} />
                    <p className="text-xs text-muted-foreground">
                      {p.tarefasConcluidas} de {p.totalTarefas} tarefa(s) concluída(s)
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-3.5" />
                      {fmtData(p.inicio)} — {fmtData(p.fim)}
                    </span>
                    {!encerrado ? (
                      <span className={cn(dias < 0 ? "text-destructive" : "")}>
                        {dias < 0 ? `${Math.abs(dias)}d em atraso` : `${dias}d restantes`}
                      </span>
                    ) : null}
                    {p.riscosAbertos > 0 ? (
                      <Badge variant="outline" className="border-warning/40 text-xs text-warning">
                        {p.riscosAbertos} risco(s)
                      </Badge>
                    ) : null}
                    {p.atencoesAbertas > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-destructive/40 text-xs text-destructive"
                      >
                        {p.atencoesAbertas} decisão(ões) pendente(s)
                      </Badge>
                    ) : null}
                    {p.ultimaAtualizacao ? (
                      <span className="ml-auto">Atualizado em {fmtData(p.ultimaAtualizacao)}</span>
                    ) : (
                      <span className="ml-auto text-warning">Sem atualização registrada</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
