import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { ProjectDialog } from "@/views/project-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import {
  QUADRANTE_LABEL,
  calcularScore,
  quadranteDe,
  rotuloEsforco,
  type ModeloPriorizacao,
  type Quadrante,
} from "@/services/priorizacao";
import type { ProjetoBacklog } from "@/repositories/backlog.repo";
import type { Projeto } from "@/repositories/projetos.repo";
import {
  listarBacklogFn,
  reordenarBacklogFn,
  promoverDemandaFn,
  descartarDemandaFn,
} from "@/services/backlog.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/backlog")({
  head: () => ({
    meta: [
      { title: "Backlog de projetos · BeagleOne" },
      {
        name: "description",
        content:
          "Projetos aguardando priorização, com pontuação por valor e esforço e matriz de decisão.",
      },
    ],
  }),
  component: Backlog,
});

/**
 * O item do backlog é um projeto: mesmos campos, mesmo formulário.
 *
 * O cast existe porque a consulta do backlog traz um subconjunto tipado
 * à parte — sem tarefas, sem progresso — e o diálogo espera o tipo
 * completo. É seguro porque o diálogo só lê os campos que o SELECT
 * garante.
 */
function comoProjeto(p: ProjetoBacklog): Projeto {
  return p as unknown as Projeto;
}

/** Cor da tarja por situação: verde anda, vermelho parou, cinza encerrou. */
function classeStatus(status: string): string {
  switch (status) {
    case "execucao":
      return "border-success/40 text-success";
    case "planejamento":
      return "border-info/40 text-info";
    case "paralisado":
      return "border-warning/40 text-warning";
    case "cancelado":
      return "border-destructive/40 text-destructive";
    default:
      return "";
  }
}

function Backlog() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"lista" | "matriz">("lista");
  const [arrastando, setArrastando] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["backlog"], queryFn: () => listarBacklogFn() });

  const modelo: ModeloPriorizacao = q.data?.modelo ?? "simples";
  const podeGerir = q.data?.podeGerir ?? false;
  const itens = useMemo(() => q.data?.demandas ?? [], [q.data]);

  /**
   * A tela virou o índice do portfólio, então separa os dois mundos.
   *
   * Na fila: o que ainda é decisão, com ordem arrastável e pontuação.
   * Já priorizados: o que virou compromisso, só para consulta — a
   * ordem ali é do cronograma, não da priorização, e arrastar não
   * significaria nada.
   */
  const naFila = useMemo(() => itens.filter((d) => d.status === "backlog"), [itens]);
  const priorizados = useMemo(() => itens.filter((d) => d.status !== "backlog"), [itens]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const reordenar = useMutation({
    mutationFn: (ids: string[]) => reordenarBacklogFn({ data: { ids } }),
    onSuccess: invalidar,
    onError: erro,
  });

  const promover = useMutation({
    mutationFn: (id: string) => promoverDemandaFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto priorizado", {
        description: "Ele saiu da fila e agora aparece entre os projetos em andamento.",
      });
    },
    onError: erro,
  });

  const descartar = useMutation({
    mutationFn: (id: string) => descartarDemandaFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto descartado");
    },
    onError: erro,
  });

  function filtrar(lista: ProjetoBacklog[]): ProjetoBacklog[] {
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.filter((d) =>
      `${d.nome} ${d.objetivo ?? ""} ${d.areaDemandante ?? ""} ${d.justificativa ?? ""}`
        .toLowerCase()
        .includes(t),
    );
  }

  const filaVisivel = filtrar(naFila);
  const priorizadosVisiveis = filtrar(priorizados);

  /**
   * Arrasto nativo: a ordem só vai ao servidor quando solta.
   *
   * Opera apenas sobre a fila — o índice vem de `naFila`, não da lista
   * inteira, senão a posição gravada contaria projetos que já saíram da
   * priorização.
   */
  function aoSoltar(alvoId: string) {
    if (!arrastando || arrastando === alvoId) return;

    const ids = naFila.map((d) => d.id);
    const de = ids.indexOf(arrastando);
    const para = ids.indexOf(alvoId);
    if (de < 0 || para < 0) return;

    ids.splice(para, 0, ...ids.splice(de, 1));
    setArrastando(null);
    reordenar.mutate(ids);
  }

  const semPontuacao = naFila.filter((d) => calcularScore(modelo, d) === null).length;
  const emExecucao = priorizados.filter((d) => d.status === "execucao").length;

  return (
    <AppShell
      title="Backlog de projetos"
      subtitle="A carteira inteira num lugar só: o que aguarda decisão no topo, o que já foi priorizado logo abaixo."
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar o backlog: {String(q.error)}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-4">
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Na fila</p>
            <p className="mt-2 font-mono text-3xl font-semibold">{naFila.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">projeto(s) aguardando decisão</p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Já priorizados</p>
            <p className="mt-2 font-mono text-3xl font-semibold">{priorizados.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {emExecucao} em execução no momento
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sem pontuação</p>
            <p
              className={cn(
                "mt-2 font-mono text-3xl font-semibold",
                semPontuacao ? "text-warning" : "",
              )}
            >
              {semPontuacao}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sem valor e esforço não entram no ranking
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Priorização</p>
            <p className="mt-2 text-lg font-semibold">
              {modelo === "rice" ? "RICE" : "Valor ÷ esforço"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {modelo === "rice"
                ? "Alcance × impacto × confiança ÷ esforço"
                : "Modelo simples, definido em Administração"}
            </p>
          </div>
        </section>

        {/* Ação de coleção junto da coleção, como em Projetos: o
            cabeçalho é reservado à identidade e ao "Abrir chamado". */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, objetivo, área ou justificativa..."
              className="pl-8"
            />
          </div>
          <div className="flex items-center rounded-md border border-border p-0.5">
            {(["lista", "matriz"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisao(v)}
                aria-pressed={visao === v}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                  visao === v
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "lista" ? (
                  <List className="size-3.5" />
                ) : (
                  <LayoutGrid className="size-3.5" />
                )}
                {v === "lista" ? "Lista" : "Matriz"}
              </button>
            ))}
          </div>
          <ProjectDialog statusInicial="backlog" modelo={modelo} />
        </div>

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando backlog...
          </p>
        ) : itens.length === 0 ? (
          <div className="panel px-5 py-12 text-center">
            <p className="text-sm font-medium">Nenhum projeto cadastrado.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Registre aqui o que foi pedido mas ainda não foi decidido. Projeto na fila não cobra
              acompanhamento semanal nem ocupa a capacidade da equipe — e entra na carteira no dia
              em que for priorizado.
            </p>
          </div>
        ) : visao === "matriz" ? (
          /* A matriz é ferramenta de decisão: só quem ainda está na fila
             entra. Posicionar projeto em execução num quadrante sugeriria
             que ele ainda pode ser descartado. */
          <Matriz itens={filaVisivel} modelo={modelo} />
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
                Na fila de priorização
              </h2>
              {filaVisivel.length === 0 ? (
                <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
                  {naFila.length === 0
                    ? "Nada aguardando decisão no momento."
                    : "Nenhum projeto da fila corresponde à busca."}
                </p>
              ) : (
                <ol className="space-y-2">
                  {filaVisivel.map((d, i) => (
                    <LinhaBacklog
                      key={d.id}
                      posicao={i + 1}
                      item={d}
                      modelo={modelo}
                      podeGerir={podeGerir}
                      arrastavel={podeGerir && busca.trim() === ""}
                      promovendo={promover.isPending}
                      onArrastarInicio={() => setArrastando(d.id)}
                      onSoltar={() => aoSoltar(d.id)}
                      onPromover={() => promover.mutate(d.id)}
                      onDescartar={() => descartar.mutate(d.id)}
                    />
                  ))}
                </ol>
              )}
            </section>

            {priorizados.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
                  Já priorizados
                </h2>
                {priorizadosVisiveis.length === 0 ? (
                  <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
                    Nenhum projeto priorizado corresponde à busca.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {priorizadosVisiveis.map((d) => (
                      <LinhaPriorizada key={d.id} item={d} modelo={modelo} />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
        )}

        {podeGerir && visao === "lista" && busca.trim() !== "" ? (
          <p className="text-xs text-muted-foreground">
            A ordem só pode ser alterada sem filtro — arrastar sobre uma lista parcial moveria o
            projeto para uma posição que você não está vendo.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}

function LinhaBacklog({
  posicao,
  item: d,
  modelo,
  podeGerir,
  arrastavel,
  promovendo,
  onArrastarInicio,
  onSoltar,
  onPromover,
  onDescartar,
}: {
  posicao: number;
  item: ProjetoBacklog;
  modelo: ModeloPriorizacao;
  podeGerir: boolean;
  arrastavel: boolean;
  promovendo: boolean;
  onArrastarInicio: () => void;
  onSoltar: () => void;
  onPromover: () => void;
  onDescartar: () => void;
}) {
  const score = calcularScore(modelo, d);
  const quadrante = quadranteDe(d);
  const resumo = d.objetivo ?? d.justificativa;

  return (
    <li
      draggable={arrastavel}
      onDragStart={onArrastarInicio}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onSoltar}
      className={cn("panel flex items-start gap-3 p-4", arrastavel ? "cursor-grab" : "")}
    >
      {arrastavel ? (
        <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="mt-0.5 w-6 shrink-0 font-mono text-sm text-muted-foreground">{posicao}</span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{d.nome}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {d.areaDemandante ?? "Sem área"}
          {d.gerenteNome ? ` · ${d.gerenteNome}` : ""}
        </p>
        {resumo ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{resumo}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {score === null ? (
            <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
              Sem pontuação
            </Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-[10px]">
              score {score}
            </Badge>
          )}
          {d.valor !== null ? (
            <Badge variant="outline" className="text-[10px]">
              valor {d.valor}
            </Badge>
          ) : null}
          {d.esforco !== null ? (
            <Badge variant="outline" className="text-[10px]">
              esforço {rotuloEsforco(modelo, d.esforco)}
            </Badge>
          ) : null}
          {quadrante ? (
            <Badge variant="outline" className="text-[10px]">
              {QUADRANTE_LABEL[quadrante]}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ProjectDialog
          project={comoProjeto(d)}
          modelo={modelo}
          trigger={
            <Button variant="ghost" size="icon" className="size-7" title="Editar projeto">
              <Pencil className="size-3.5" />
            </Button>
          }
        />
        {podeGerir ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Descartar"
              onClick={onDescartar}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={promovendo}
              title="Mover para Projetos e começar o cronograma"
              onClick={onPromover}
            >
              Priorizar <ArrowRight className="size-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Linha do que já saiu da fila.
 *
 * Sem arrasto, sem priorizar, sem descartar: aqui a decisão já foi
 * tomada, e as ações da fila não fazem mais sentido. O que interessa é
 * a situação e o quanto andou — e o caminho para o cronograma.
 */
function LinhaPriorizada({ item: d, modelo }: { item: ProjetoBacklog; modelo: ModeloPriorizacao }) {
  const encerrado = d.status === "concluido" || d.status === "cancelado";
  const resumo = d.objetivo ?? d.justificativa;

  return (
    <li className={cn("panel flex items-start gap-3 p-4", encerrado ? "opacity-60" : "")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{d.nome}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {d.areaDemandante ?? "Sem área"}
          {d.gerenteNome ? ` · ${d.gerenteNome}` : ""}
        </p>
        {resumo ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{resumo}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("text-[10px]", classeStatus(d.status))}>
            {PROJECT_STATUS_LABEL[d.status as ProjectStatus] ?? d.status}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {d.progresso}%
          </Badge>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-primary/70"
              style={{ width: `${d.progresso}%` }}
            />
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ProjectDialog
          project={comoProjeto(d)}
          modelo={modelo}
          trigger={
            <Button variant="ghost" size="icon" className="size-7" title="Editar projeto">
              <Pencil className="size-3.5" />
            </Button>
          }
        />
        <Link
          to="/projetos/$projectId"
          params={{ projectId: d.id }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:underline"
        >
          Cronograma <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </li>
  );
}

/**
 * Matriz valor × esforço.
 *
 * É o artefato que funciona numa reunião de priorização: mostra de
 * relance o que é ganho rápido e o que é aposta cara. Só entra quem tem
 * pontuação — posicionar o não avaliado em algum canto sugeriria uma
 * avaliação que ninguém fez.
 */
function Matriz({ itens, modelo }: { itens: ProjetoBacklog[]; modelo: ModeloPriorizacao }) {
  const porQuadrante = useMemo(() => {
    const m = new Map<Quadrante, ProjetoBacklog[]>();
    for (const d of itens) {
      const q = quadranteDe(d);
      if (!q) continue;
      m.set(q, [...(m.get(q) ?? []), d]);
    }
    return m;
  }, [itens]);

  const semPontuacao = itens.filter((d) => quadranteDe(d) === null);

  // A ordem desenha o plano cartesiano: valor alto em cima, esforço
  // baixo à esquerda.
  const ordem: { q: Quadrante; classe: string }[] = [
    { q: "ganho_rapido", classe: "border-success/40" },
    { q: "aposta", classe: "border-info/40" },
    { q: "preencher", classe: "border-border" },
    { q: "descartar", classe: "border-warning/40" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {ordem.map(({ q, classe }) => {
          const lista = porQuadrante.get(q) ?? [];
          return (
            <section key={q} className={cn("panel p-4", classe)}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{QUADRANTE_LABEL[q]}</h2>
                <span className="font-mono text-xs text-muted-foreground">{lista.length}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {q === "ganho_rapido"
                  ? "Muito valor, pouco esforço. Faça agora."
                  : q === "aposta"
                    ? "Muito valor, muito esforço. Precisa de decisão."
                    : q === "preencher"
                      ? "Pouco valor, pouco esforço. Encaixa nas folgas."
                      : "Pouco valor, muito esforço. Vale perguntar por quê."}
              </p>

              <ul className="mt-3 space-y-1.5">
                {lista.map((d) => (
                  <li key={d.id} className="rounded-md border border-border p-2">
                    <p className="truncate text-xs font-medium">{d.nome}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {d.areaDemandante ?? "Sem área"} · score {calcularScore(modelo, d) ?? "—"}
                    </p>
                  </li>
                ))}
                {lista.length === 0 ? (
                  <li className="py-3 text-center text-xs text-muted-foreground">Vazio</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>

      {semPontuacao.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {semPontuacao.length} projeto(s) da fila fora da matriz por falta de valor ou esforço.
        </p>
      ) : null}
    </div>
  );
}
