import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CornerDownRight,
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
import type { DadosCpm, Tarefa, TarefaCalculada } from "@/repositories/projetos.repo";
import {
  detalheProjetoFn,
  criarRiscoFn,
  criarAtualizacaoFn,
  criarAtencaoFn,
  resolverAtencaoFn,
  atualizarCampoTarefaFn,
  inserirAbaixoFn,
  salvarBaselineFn,
  type RiscoInput,
  type AtualizacaoInput,
  type AtencaoInput,
  type CampoTarefaInput,
} from "@/services/projetos.functions";
import { listarRecursosFn } from "@/services/recursos.functions";
import { usuarioAtualFn, listarUsuariosFn } from "@/services/cadastros.functions";
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
const UM_DIA = 86_400_000;

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

function diasEntre(inicio: Date | string, fim: Date | string): number {
  const a = new Date(inicio).setHours(0, 0, 0, 0);
  const b = new Date(fim).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b - a) / UM_DIA) + 1);
}

/** Ordena a WBS: filhas logo abaixo da mãe, com nível para indentar. */
function achatarWbs(tarefas: TarefaCalculada[]): { tarefa: TarefaCalculada; nivel: number }[] {
  const porPai = new Map<string | null, TarefaCalculada[]>();
  for (const t of tarefas) {
    const chave = t.paiId ?? null;
    porPai.set(chave, [...(porPai.get(chave) ?? []), t]);
  }

  const saida: { tarefa: TarefaCalculada; nivel: number }[] = [];
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

  const { projeto, tarefas, cpm, vinculos, riscos, atualizacoes, atencoes, baselines, planejado } =
    q.data;

  const wbs = achatarWbs(tarefas);

  // Índice de exibição por tarefa: o rótulo "após 3. Nome" precisa do
  // número que o usuário vê na grade, não do UUID.
  const indicePorId = new Map<string, number>();
  wbs.forEach(({ tarefa }, i) => indicePorId.set(tarefa.id, i + 1));

  const criticas = Object.values(cpm).filter((c) => c.critica).length;

  // Baseline indexada por tarefa: usada para marcar desvio de data.
  const planejadoPorTarefa = new Map<string, { inicio: Date; fim: Date }>();
  for (const p of planejado) {
    planejadoPorTarefa.set(p.tarefaId, { inicio: new Date(p.inicio), fim: new Date(p.fim) });
  }

  // Progresso do projeto: só as folhas contam. Incluir os pais somaria o
  // mesmo trabalho duas vezes.
  const folhas = tarefas.filter((t) => !t.ehPai);
  const concluidas = folhas.filter((t) => t.quadro === "done").length;
  const progresso = folhas.length
    ? Math.round(folhas.reduce((s, t) => s + t.progressoEfetivo, 0) / folhas.length)
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
              {concluidas} de {folhas.length} tarefa(s)
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

        <Tabs defaultValue="cronograma">
          <TabsList>
            <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
            <TabsTrigger value="kanban">Quadro</TabsTrigger>
            <TabsTrigger value="riscos">Riscos e atenções</TabsTrigger>
            <TabsTrigger value="acompanhamento">Acompanhamento</TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------- cronograma */}
          <TabsContent value="cronograma" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Clique em nome, datas e percentual para editar. Linhas com subtarefas mostram o
                consolidado e não são editáveis.
                {criticas > 0 ? (
                  <>
                    {" "}
                    <span className="text-destructive">
                      {criticas} tarefa(s) no caminho crítico
                    </span>{" "}
                    — atraso nelas empurra a entrega.
                  </>
                ) : null}
              </p>
              {editavel ? (
                <BaselineBar
                  projetoId={projectId}
                  baselines={baselines}
                  onSalvar={() => invalidar()}
                />
              ) : null}
            </div>

            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-10 px-2 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Tarefa</th>
                    <th className="w-20 px-3 py-2 font-medium">Duração</th>
                    <th className="w-40 px-3 py-2 font-medium">Responsáveis</th>
                    <th className="w-32 px-3 py-2 font-medium">Início</th>
                    <th className="w-32 px-3 py-2 font-medium">Término</th>
                    <th className="w-28 px-3 py-2 font-medium">%</th>
                    <th className="w-20 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {/* Linha 0: o projeto. Consolida tudo e dá referência de
                      escala para quem lê o cronograma de cima. */}
                  <tr className="border-b border-border bg-secondary/40 font-medium">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">0</td>
                    <td className="px-4 py-2">{projeto.nome}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {diasEntre(projeto.inicio, projeto.fim)} d
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {projeto.gerenteNome ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{fmt(projeto.inicio)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{fmt(projeto.fim)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{progresso}%</td>
                    <td />
                  </tr>

                  {wbs.map(({ tarefa: t, nivel }, i) => (
                    <LinhaCronograma
                      key={t.id}
                      indice={i + 1}
                      tarefa={t}
                      nivel={nivel}
                      cpm={cpm[t.id]}
                      predecessoras={(vinculos.predecessoras[t.id] ?? []).map((p) => ({
                        indice: indicePorId.get(p) ?? 0,
                        nome: tarefas.find((x) => x.id === p)?.nome ?? "",
                      }))}
                      responsaveis={(vinculos.responsaveis[t.id] ?? []).map(nomeRecurso)}
                      planejado={planejadoPorTarefa.get(t.id)}
                      editavel={editavel}
                      onDetalhe={() => {
                        setEditando(t);
                        setTarefaAberta(true);
                      }}
                    />
                  ))}

                  {tarefas.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma tarefa. Use <strong>Nova tarefa</strong> para começar o cronograma.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

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
                tarefas={tarefas.filter((t) => !t.ehPai)}
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

// ------------------------------------------------------ campos editáveis

/**
 * Campo que salva ao sair (onBlur), não a cada tecla.
 *
 * Salvar por tecla geraria uma requisição por dígito e, num campo de
 * data, tentaria gravar "10/0" no meio da digitação. O rascunho local
 * volta ao valor do servidor quando a gravação falha.
 */
function CampoInline({
  valor,
  tipo,
  editavel,
  alerta,
  onSalvar,
}: {
  valor: string;
  tipo: "date" | "number";
  editavel: boolean;
  alerta?: string | undefined;
  onSalvar: (v: string) => void;
}) {
  const [rascunho, setRascunho] = useState(valor);

  // Se o servidor devolveu outro valor (rollup, rejeição), acompanha.
  useEffect(() => setRascunho(valor), [valor]);

  if (!editavel) {
    return (
      <span className={cn("font-mono text-xs", alerta ? "text-warning" : "text-muted-foreground")}>
        {tipo === "date" ? valor.split("-").reverse().join("/") : `${valor}%`}
      </span>
    );
  }

  return (
    <Input
      type={tipo}
      value={rascunho}
      min={tipo === "number" ? 0 : undefined}
      max={tipo === "number" ? 100 : undefined}
      title={alerta}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        if (rascunho !== valor && rascunho !== "") onSalvar(rascunho);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(valor);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-7 border-transparent bg-transparent px-1 font-mono text-xs hover:border-border focus:border-primary",
        alerta ? "text-warning" : "",
      )}
    />
  );
}

/**
 * Nome editável em linha. Diferente dos campos numéricos, precisa de
 * largura flexível e de um caminho para abrir o detalhe — daí o ícone
 * separado em vez de clique no texto, que conflitaria com o foco.
 */
function NomeInline({
  valor,
  negrito,
  riscado,
  onSalvar,
  onDetalhe,
}: {
  valor: string;
  negrito: boolean;
  riscado: boolean;
  onSalvar: (v: string) => void;
  onDetalhe: () => void;
}) {
  const [rascunho, setRascunho] = useState(valor);
  useEffect(() => setRascunho(valor), [valor]);

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        value={rascunho}
        maxLength={300}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          const v = rascunho.trim();
          if (v && v !== valor) onSalvar(v);
          else if (!v) setRascunho(valor);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setRascunho(valor);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-primary",
          negrito ? "font-medium" : "",
          riscado ? "line-through opacity-70" : "",
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title="Abrir detalhes"
        onClick={onDetalhe}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </span>
  );
}

function LinhaCronograma({
  indice,
  tarefa: t,
  nivel,
  cpm,
  predecessoras,
  responsaveis,
  planejado,
  editavel,
  onDetalhe,
}: {
  indice: number;
  tarefa: TarefaCalculada;
  nivel: number;
  cpm: DadosCpm | undefined;
  predecessoras: { indice: number; nome: string }[];
  responsaveis: string[];
  planejado: { inicio: Date; fim: Date } | undefined;
  editavel: boolean;
  onDetalhe: () => void;
}) {
  const qc = useQueryClient();

  const salvarCampo = useMutation({
    mutationFn: (v: CampoTarefaInput) => atualizarCampoTarefaFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projeto", t.projetoId] });
      qc.invalidateQueries({ queryKey: ["projetos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const inserir = useMutation({
    mutationFn: (v: { referenciaId: string; comoFilha: boolean }) => inserirAbaixoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto", t.projetoId] }),
    onError: (e: Error) => toast.error("Não foi possível inserir", { description: e.message }),
  });

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const desvioFim =
    planejado && t.fimEfetivo.getTime() > planejado.fim.getTime()
      ? `Planejado para ${fmt(planejado.fim)}`
      : undefined;

  // Pai não é editável: seus valores vêm do rollup das filhas.
  const podeEditar = editavel && !t.ehPai;
  const critica = cpm?.critica ?? false;
  const temSecundaria = !!t.atividade || predecessoras.length > 0 || (!!cpm && !t.ehPai);

  return (
    <tr className={cn("border-b border-border/60", t.ehPai ? "bg-secondary/20" : "")}>
      <td className="px-2 py-1 font-mono text-xs text-muted-foreground">{indice}</td>
      <td className="px-4 py-1">
        <span className="flex items-center gap-1.5" style={{ paddingLeft: `${nivel * 16}px` }}>
          {t.ehPai ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : null}
          {/* Marcador do caminho crítico: folga zero. */}
          {critica ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-destructive"
              title="Caminho crítico — atraso aqui empurra a entrega"
              aria-label="Caminho crítico"
            />
          ) : null}
          {editavel ? (
            <NomeInline
              valor={t.nome}
              negrito={t.ehPai}
              riscado={t.quadro === "done"}
              onSalvar={(v) => salvarCampo.mutate({ id: t.id, nome: v })}
              onDetalhe={onDetalhe}
            />
          ) : (
            <span
              className={cn(
                "truncate",
                t.ehPai ? "font-medium" : "",
                t.quadro === "done" ? "line-through opacity-70" : "",
              )}
            >
              {t.nome}
            </span>
          )}
          {t.marco ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              marco
            </Badge>
          ) : null}
          {t.ehPai ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              ({t.totalFolhas} subtarefa{t.totalFolhas > 1 ? "s" : ""})
            </span>
          ) : null}
        </span>

        {/* Linha secundária: atividade, folga e dependências. */}
        {temSecundaria ? (
          <span
            className="mt-0.5 block text-[11px] text-muted-foreground"
            style={{ paddingLeft: `${nivel * 16 + 14}px` }}
          >
            {t.atividade ? <span>{t.atividade}</span> : null}
            {critica ? (
              <span className="text-destructive">{t.atividade ? " · " : ""}caminho crítico</span>
            ) : cpm && !t.ehPai && cpm.folgaDias > 0 ? (
              <span>
                {t.atividade ? " · " : ""}folga de {cpm.folgaDias}d
              </span>
            ) : null}
            {predecessoras.length > 0 ? (
              <span>
                {t.atividade || critica || cpm ? " · " : ""}após{" "}
                {predecessoras.map((p) => `${p.indice}. ${p.nome}`).join(", ")}
              </span>
            ) : null}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-1 font-mono text-xs text-muted-foreground">
        {cpm ? `${cpm.duracaoDias} d` : "—"}
      </td>
      <td className="truncate px-3 py-1 text-xs text-muted-foreground">
        {t.ehPai ? "—" : responsaveis.join(", ") || "—"}
      </td>
      <td className="px-3 py-1">
        <CampoInline
          valor={iso(t.inicioEfetivo)}
          tipo="date"
          editavel={podeEditar}
          onSalvar={(v) => salvarCampo.mutate({ id: t.id, inicio: new Date(`${v}T12:00:00`) })}
        />
      </td>
      <td className="px-3 py-1">
        <CampoInline
          valor={iso(t.fimEfetivo)}
          tipo="date"
          editavel={podeEditar}
          alerta={desvioFim}
          onSalvar={(v) => salvarCampo.mutate({ id: t.id, fim: new Date(`${v}T12:00:00`) })}
        />
      </td>
      <td className="px-3 py-1">
        <span className="flex items-center gap-2">
          <CampoInline
            valor={String(t.progressoEfetivo)}
            tipo="number"
            editavel={podeEditar}
            onSalvar={(v) => salvarCampo.mutate({ id: t.id, progresso: Number(v) })}
          />
          <Progress value={t.progressoEfetivo} className="h-1 w-10" />
        </span>
      </td>
      <td className="px-2 py-1">
        {editavel ? (
          <span className="flex justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Inserir tarefa abaixo"
              disabled={inserir.isPending}
              onClick={() => inserir.mutate({ referenciaId: t.id, comoFilha: false })}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Inserir subtarefa"
              disabled={inserir.isPending}
              onClick={() => inserir.mutate({ referenciaId: t.id, comoFilha: true })}
            >
              <CornerDownRight className="size-3.5" />
            </Button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** Estado da baseline e botão de salvar nova versão. */
function BaselineBar({
  projetoId,
  baselines,
  onSalvar,
}: {
  projetoId: string;
  baselines: { id: string; versao: number; criadoEm: Date | string }[];
  onSalvar: () => void;
}) {
  const salvar = useMutation({
    mutationFn: () => salvarBaselineFn({ data: { projetoId } }),
    onSuccess: () => {
      onSalvar();
      toast.success("Baseline registrada", {
        description: "As datas atuais viraram a referência de comparação.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const atual = baselines[0];

  return (
    <span className="flex items-center gap-3">
      {atual ? (
        <span className="text-xs text-muted-foreground">
          Baseline v{atual.versao} · {fmt(atual.criadoEm)}
        </span>
      ) : (
        <span className="text-xs text-warning">
          Sem baseline — não há como medir desvio de prazo
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={salvar.isPending}
        onClick={() => salvar.mutate()}
      >
        {atual ? "Nova baseline" : "Salvar baseline"}
      </Button>
    </span>
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
    queryFn: () => listarUsuariosFn(),
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
