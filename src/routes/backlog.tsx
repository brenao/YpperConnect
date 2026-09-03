import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
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
      { title: "Backlog de projetos · YpperConnect" },
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

function Backlog() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"lista" | "matriz">("lista");
  const [arrastando, setArrastando] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["backlog"], queryFn: () => listarBacklogFn() });

  const modelo: ModeloPriorizacao = q.data?.modelo ?? "simples";
  const podeGerir = q.data?.podeGerir ?? false;
  const itens = useMemo(() => q.data?.demandas ?? [], [q.data]);

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
        description: "Ele saiu do backlog e já aparece em Projetos, pronto para o cronograma.",
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

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return itens;
    return itens.filter((d) =>
      `${d.nome} ${d.objetivo ?? ""} ${d.areaDemandante ?? ""} ${d.justificativa ?? ""}`
        .toLowerCase()
        .includes(t),
    );
  }, [itens, busca]);

  /** Arrasto nativo: a ordem só vai ao servidor quando solta. */
  function aoSoltar(alvoId: string) {
    if (!arrastando || arrastando === alvoId) return;

    const ids = itens.map((d) => d.id);
    const de = ids.indexOf(arrastando);
    const para = ids.indexOf(alvoId);
    if (de < 0 || para < 0) return;

    ids.splice(para, 0, ...ids.splice(de, 1));
    setArrastando(null);
    reordenar.mutate(ids);
  }

  const semPontuacao = itens.filter((d) => calcularScore(modelo, d) === null).length;

  return (
    <AppShell
      title="Backlog de projetos"
      subtitle="O que foi pedido e ainda aguarda priorização. Nada aqui consome capacidade nem cobra acompanhamento."
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar o backlog: {String(q.error)}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Na fila</p>
            <p className="mt-2 font-mono text-3xl font-semibold">{itens.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">projeto(s) aguardando decisão</p>
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
            <p className="text-sm font-medium">Backlog vazio.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Registre aqui o que foi pedido mas ainda não foi decidido. Projeto no backlog não
              cobra acompanhamento semanal nem ocupa a capacidade da equipe — e entra na carteira no
              dia em que for priorizado.
            </p>
          </div>
        ) : visao === "matriz" ? (
          <Matriz itens={visiveis} modelo={modelo} />
        ) : (
          <ol className="space-y-2">
            {visiveis.map((d, i) => (
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
          {semPontuacao.length} projeto(s) fora da matriz por falta de valor ou esforço.
        </p>
      ) : null}
    </div>
  );
}
