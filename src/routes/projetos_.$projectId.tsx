import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { ProjectDialog } from "@/views/project-dialogs";
import { ProjectKanban } from "@/views/project-kanban";
import { TaskDialog } from "@/views/task-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import type { Tarefa } from "@/repositories/projetos.repo";
import {
  detalheProjetoFn,
  criarRiscoFn,
  criarAtualizacaoFn,
  criarAtencaoFn,
  resolverAtencaoFn,
  type RiscoInput,
  type AtualizacaoInput,
  type AtencaoInput,
} from "@/services/projetos.functions";
import { listarRecursosFn } from "@/services/recursos.functions";
import { usuarioAtualFn } from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projetos_/$projectId")({
  component: DetalheProjeto,
});

const statusStyle: Record<ProjectStatus, string> = {
  planejamento: "bg-info/12 text-info border-info/30",
  execucao: "bg-primary/12 text-primary border-primary/30",
  paralisado: "bg-warning/12 text-warning border-warning/30",
  cancelado: "bg-muted text-muted-foreground border-border",
  concluido: "bg-success/12 text-success border-success/30",
};

const nivelStyle: Record<string, string> = {
  alta: "border-destructive/40 text-destructive",
  alto: "border-destructive/40 text-destructive",
  media: "border-warning/40 text-warning",
  medio: "border-warning/40 text-warning",
  baixa: "border-border text-muted-foreground",
  baixo: "border-border text-muted-foreground",
};

const SEM = "__nenhum__";

function fmt(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function paraInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function doInput(v: string): Date {
  const [a, m, d] = v.split("-").map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Ordena a WBS: filhas logo abaixo da mãe, com nível para indentar. */
function achatarWbs(tarefas: Tarefa[]): { tarefa: Tarefa; nivel: number }[] {
  const porPai = new Map<string | null, Tarefa[]>();
  for (const t of tarefas) {
    const chave = t.paiId ?? null;
    porPai.set(chave, [...(porPai.get(chave) ?? []), t]);
  }

  const saida: { tarefa: Tarefa; nivel: number }[] = [];
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

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const q = useQuery({
    queryKey: ["projeto", projectId],
    queryFn: () => detalheProjetoFn({ data: { id: projectId } }),
  });
  const recursosQuery = useQuery({ queryKey: ["recursos"], queryFn: () => listarRecursosFn() });

  const [editando, setEditando] = useState<Tarefa | undefined>(undefined);
  const [tarefaAberta, setTarefaAberta] = useState(false);

  const editavel = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;
  const recursos = useMemo(() => recursosQuery.data?.recursos ?? [], [recursosQuery.data]);

  const nomeRecurso = (id: string) => recursos.find((r) => r.id === id)?.nome ?? "—";

  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });
  function invalidar() {
    qc.invalidateQueries({ queryKey: ["projeto", projectId] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
  }

  const novoRisco = useMutation({
    mutationFn: (v: RiscoInput) => criarRiscoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Risco registrado");
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

  const novaAtencao = useMutation({
    mutationFn: (v: AtencaoInput) => criarAtencaoFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Ponto de atenção registrado");
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

  const { projeto, tarefas, vinculos, riscos, atualizacoes, atencoes } = q.data;
  const wbs = achatarWbs(tarefas);
  const concluidas = tarefas.filter((t) => t.quadro === "done").length;
  const progresso = tarefas.length
    ? Math.round(tarefas.reduce((s, t) => s + t.progresso, 0) / tarefas.length)
    : 0;
  const atencoesAbertas = atencoes.filter((a) => a.status === "aberto");
  const riscosAbertos = riscos.filter((r) => r.status !== "mitigado");
  const atrasado = new Date(projeto.fim) < new Date() && projeto.status === "execucao";

  return (
    <AppShell
      title={projeto.nome}
      subtitle={`${projeto.gerenteNome ?? "Sem gerente"} · ${fmt(projeto.inicio)} — ${fmt(projeto.fim)}`}
      actions={
        editavel ? (
          <span className="flex gap-2">
            <ProjectDialog
              project={projeto}
              trigger={
                <Button variant="outline" size="sm">
                  Editar projeto
                </Button>
              }
            />
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setEditando(undefined);
                setTarefaAberta(true);
              }}
            >
              <Plus className="size-4" /> Nova tarefa
            </Button>
          </span>
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
          </div>
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Progresso</p>
            <p className="mt-1 font-mono text-2xl font-semibold">{progresso}%</p>
            <Progress value={progresso} className="mt-2" />
            <p className="mt-1 text-xs text-muted-foreground">
              {concluidas} de {tarefas.length} tarefa(s)
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
          </div>
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Decisões pendentes
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-semibold",
                atencoesAbertas.length ? "text-destructive" : "",
              )}
            >
              {atencoesAbertas.length}
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

        <Tabs defaultValue="kanban">
          <TabsList>
            <TabsTrigger value="kanban">Quadro</TabsTrigger>
            <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
            <TabsTrigger value="riscos">Riscos e atenções</TabsTrigger>
            <TabsTrigger value="acompanhamento">Acompanhamento</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------ kanban */}
          <TabsContent value="kanban" className="mt-4">
            {tarefas.length === 0 ? (
              <div className="panel p-8 text-center text-sm text-muted-foreground">
                Nenhuma tarefa cadastrada. Sem cronograma, o projeto não entra no cálculo de
                capacidade da equipe.
              </div>
            ) : (
              <ProjectKanban
                projetoId={projectId}
                tarefas={tarefas}
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

          {/* -------------------------------------------------- cronograma */}
          <TabsContent value="cronograma" className="mt-4">
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Tarefa</th>
                    <th className="px-4 py-2 font-medium">Responsáveis</th>
                    <th className="px-4 py-2 font-medium">Início</th>
                    <th className="px-4 py-2 font-medium">Término</th>
                    <th className="px-4 py-2 font-medium">Progresso</th>
                  </tr>
                </thead>
                <tbody>
                  {wbs.map(({ tarefa: t, nivel }) => {
                    const preds = vinculos.predecessoras[t.id] ?? [];
                    return (
                      <tr
                        key={t.id}
                        className={cn(
                          "border-b border-border/60",
                          editavel ? "cursor-pointer hover:bg-secondary/40" : "",
                        )}
                        onClick={() => {
                          if (!editavel) return;
                          setEditando(t);
                          setTarefaAberta(true);
                        }}
                      >
                        <td className="px-4 py-2">
                          <span
                            className="flex items-center gap-1"
                            style={{ paddingLeft: `${nivel * 16}px` }}
                          >
                            {nivel > 0 ? (
                              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                            ) : null}
                            <span
                              className={cn(t.quadro === "done" ? "line-through opacity-70" : "")}
                            >
                              {t.nome}
                            </span>
                            {t.marco ? (
                              <Badge variant="outline" className="ml-1 text-[10px]">
                                marco
                              </Badge>
                            ) : null}
                          </span>
                          {t.atividade || preds.length ? (
                            <span
                              className="mt-0.5 block text-[11px] text-muted-foreground"
                              style={{ paddingLeft: `${nivel * 16 + 16}px` }}
                            >
                              {t.atividade ?? ""}
                              {preds.length
                                ? `${t.atividade ? " · " : ""}depende de ${preds.length} tarefa(s)`
                                : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {(vinculos.responsaveis[t.id] ?? []).map(nomeRecurso).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {fmt(t.inicio)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {fmt(t.fim)}
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-2">
                            <Progress value={t.progresso} className="w-20" />
                            <span className="font-mono text-xs">{t.progresso}%</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {tarefas.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma tarefa cadastrada.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ------------------------------------------------------ riscos */}
          <TabsContent value="riscos" className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="size-4 text-warning" /> Riscos
                </h2>
                {editavel ? (
                  <RiscoDialog
                    projetoId={projectId}
                    onSalvar={(v) => novoRisco.mutate(v)}
                    salvando={novoRisco.isPending}
                  />
                ) : null}
              </div>
              <ul className="mt-4 space-y-2">
                {riscos.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-xs", nivelStyle[r.probabilidade])}
                      >
                        prob. {r.probabilidade}
                      </Badge>
                      <Badge variant="outline" className={cn("text-xs", nivelStyle[r.impacto])}>
                        impacto {r.impacto}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {r.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm">{r.descricao}</p>
                    {r.mitigacao ? (
                      <p className="mt-1 text-xs text-muted-foreground">Mitigação: {r.mitigacao}</p>
                    ) : null}
                  </li>
                ))}
                {riscos.length === 0 ? (
                  <li className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum risco registrado.
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="size-4 text-destructive" /> Pontos de atenção
                </h2>
                {editavel ? (
                  <AtencaoDialog
                    projetoId={projectId}
                    onSalvar={(v) => novaAtencao.mutate(v)}
                    salvando={novaAtencao.isPending}
                  />
                ) : null}
              </div>
              <ul className="mt-4 space-y-2">
                {atencoes.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "rounded-lg border p-3",
                      a.status === "aberto"
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border bg-surface opacity-70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{a.titulo}</p>
                      {editavel && a.status === "aberto" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          disabled={resolver.isPending}
                          onClick={() => resolver.mutate(a.id)}
                        >
                          Resolver
                        </Button>
                      ) : null}
                    </div>
                    {a.descricao ? (
                      <p className="mt-1 text-sm text-muted-foreground">{a.descricao}</p>
                    ) : null}
                    {a.decisaoNecessaria ? (
                      <p className="mt-1 text-xs">
                        <strong>Decisão:</strong> {a.decisaoNecessaria}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {a.responsavelDecisaoNome ? `${a.responsavelDecisaoNome} · ` : ""}
                      {fmt(a.criadoEm)}
                      {a.resolvidoEm ? ` · resolvido em ${fmt(a.resolvidoEm)}` : ""}
                    </p>
                  </li>
                ))}
                {atencoes.length === 0 ? (
                  <li className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum ponto de atenção.
                  </li>
                ) : null}
              </ul>
            </div>
          </TabsContent>

          {/* ---------------------------------------------- acompanhamento */}
          <TabsContent value="acompanhamento" className="mt-4">
            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="size-4 text-primary" /> Atualizações de status
                </h2>
                {editavel ? (
                  <AtualizacaoDialog
                    projetoId={projectId}
                    onSalvar={(v) => novaAtualizacao.mutate(v)}
                    salvando={novaAtualizacao.isPending}
                  />
                ) : null}
              </div>

              <ol className="mt-4 space-y-0">
                {atualizacoes.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 pb-5">
                    {i < atualizacoes.length - 1 ? (
                      <span
                        className="absolute left-[5px] top-3 h-full w-px bg-border"
                        aria-hidden
                      />
                    ) : null}
                    <span className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-background" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs text-muted-foreground">
                        {fmt(a.dataRef)}
                        {a.autorNome ? ` · ${a.autorNome}` : ""}
                      </p>
                      {a.descricao ? <p className="mt-1 text-sm">{a.descricao}</p> : null}
                      {a.ultimasEntregas ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          <strong className="text-foreground">Entregue:</strong> {a.ultimasEntregas}
                        </p>
                      ) : null}
                      {a.proximasEntregas ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <strong className="text-foreground">A seguir:</strong>{" "}
                          {a.proximasEntregas}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
                {atualizacoes.length === 0 ? (
                  <li className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma atualização registrada. Projeto sem acompanhamento some do radar da
                    diretoria.
                  </li>
                ) : null}
              </ol>
            </div>
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

// ------------------------------------------------------------ subdiálogos

function RiscoDialog({
  projetoId,
  onSalvar,
  salvando,
}: {
  projetoId: string;
  onSalvar: (v: RiscoInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [probabilidade, setProbabilidade] = useState<"alta" | "media" | "baixa">("media");
  const [impacto, setImpacto] = useState<"alto" | "medio" | "baixo">("medio");
  const [mitigacao, setMitigacao] = useState("");

  function salvar() {
    if (descricao.trim().length < 5) {
      toast.error("Descreva o risco.");
      return;
    }
    onSalvar({
      projetoId,
      descricao: descricao.trim(),
      probabilidade,
      impacto,
      mitigacao: mitigacao.trim() || null,
    });
    setDescricao("");
    setMitigacao("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus className="size-3.5" /> Risco
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar risco</DialogTitle>
          <DialogDescription>
            Risco é o que ainda não aconteceu mas pode comprometer o projeto.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: fornecedor pode atrasar a entrega dos equipamentos"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Probabilidade</Label>
              <Select
                value={probabilidade}
                onValueChange={(v) => setProbabilidade(v as typeof probabilidade)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="baixa">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Impacto</Label>
              <Select value={impacto} onValueChange={(v) => setImpacto(v as typeof impacto)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alto">Alto</SelectItem>
                  <SelectItem value="medio">Médio</SelectItem>
                  <SelectItem value="baixo">Baixo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Plano de mitigação</Label>
            <Textarea
              rows={2}
              value={mitigacao}
              onChange={(e) => setMitigacao(e.target.value)}
              placeholder="O que será feito para reduzir a probabilidade ou o impacto"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtencaoDialog({
  projetoId,
  onSalvar,
  salvando,
}: {
  projetoId: string;
  onSalvar: (v: AtencaoInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [decisao, setDecisao] = useState("");
  const [responsavel, setResponsavel] = useState(SEM);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => import("@/services/cadastros.functions").then((m) => m.listarUsuariosFn()),
    enabled: open,
  });

  function salvar() {
    if (titulo.trim().length < 5) {
      toast.error("Informe o título.");
      return;
    }
    onSalvar({
      projetoId,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      decisaoNecessaria: decisao.trim() || null,
      responsavelDecisaoId: responsavel === SEM ? null : responsavel,
    });
    setTitulo("");
    setDescricao("");
    setDecisao("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus className="size-3.5" /> Atenção
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ponto de atenção</DialogTitle>
          <DialogDescription>
            Algo que trava o projeto e depende de decisão de alguém.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Contexto</Label>
            <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Decisão necessária</Label>
            <Textarea rows={2} value={decisao} onChange={(e) => setDecisao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Quem decide</Label>
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Não definido</SelectItem>
                {(usuarios.data ?? [])
                  .filter((u) => u.ativo)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtualizacaoDialog({
  projetoId,
  onSalvar,
  salvando,
}: {
  projetoId: string;
  onSalvar: (v: AtualizacaoInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dataRef, setDataRef] = useState(paraInput(new Date()));
  const [descricao, setDescricao] = useState("");
  const [ultimas, setUltimas] = useState("");
  const [proximas, setProximas] = useState("");

  function salvar() {
    if (descricao.trim().length < 5 && ultimas.trim().length < 5) {
      toast.error("Descreva o andamento ou o que foi entregue.");
      return;
    }
    onSalvar({
      projetoId,
      dataRef: doInput(dataRef),
      descricao: descricao.trim() || null,
      ultimasEntregas: ultimas.trim() || null,
      proximasEntregas: proximas.trim() || null,
    });
    setDescricao("");
    setUltimas("");
    setProximas("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <MessageSquarePlus className="size-3.5" /> Atualizar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atualização de status</DialogTitle>
          <DialogDescription>
            Registro semanal do andamento. É o que a diretoria lê.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Data de referência</Label>
            <Input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Andamento geral</Label>
            <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Últimas entregas</Label>
            <Textarea rows={2} value={ultimas} onChange={(e) => setUltimas(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Próximas entregas</Label>
            <Textarea rows={2} value={proximas} onChange={(e) => setProximas(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
