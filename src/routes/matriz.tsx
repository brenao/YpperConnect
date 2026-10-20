import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, Search } from "lucide-react";
import { AppShell } from "@/views/app-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  QUADRANTE_LABEL,
  calcularScore,
  quadranteDe,
  type ModeloPriorizacao,
  type Quadrante,
} from "@/services/priorizacao";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import type { ProjetoBacklog } from "@/repositories/backlog.repo";
import { listarBacklogFn } from "@/services/backlog.functions";
import { cn } from "@/lib/utils";

/**
 * Matriz de priorização: valor × esforço.
 *
 * Ganhou tela própria quando as listas se separaram. Antes era uma aba
 * do backlog, e ali respondia mal uma pergunta que não era a daquela
 * tela: o backlog pergunta "o que decidir agora", e a matriz pergunta
 * "o que decidimos antes estava certo?".
 *
 * É a única visão que olha as três listas ao mesmo tempo — fila, em
 * andamento e paralisado —, e é justamente desse cruzamento que vem a
 * conversa útil: um projeto em execução no quadrante de questionar, ou
 * um ganho rápido parado há três meses, são as duas linhas que uma
 * reunião de priorização precisa ver.
 *
 * Concluído e cancelado ficam de fora. Eles ainda têm valor e esforço
 * gravados e cairiam num quadrante, ocupando espaço com decisão que já
 * aconteceu e não volta atrás.
 */
export const Route = createFileRoute("/matriz")({
  head: () => ({
    meta: [
      { title: "Matriz de priorização · BeagleOne" },
      {
        name: "description",
        content:
          "Valor contra esforço: a fila, o que está em andamento e o que parou, no mesmo plano.",
      },
    ],
  }),
  component: MatrizPriorizacao,
});

/** Cor da tarja por situação: verde anda, amarelo parou, cinza aguarda. */
function classeStatus(status: string): string {
  switch (status) {
    case "execucao":
      return "border-success/40 text-success";
    case "planejamento":
      return "border-info/40 text-info";
    case "paralisado":
      return "border-warning/40 text-warning";
    default:
      return "";
  }
}

function MatrizPriorizacao() {
  const [busca, setBusca] = useState("");

  const q = useQuery({
    queryKey: ["backlog"],
    queryFn: () => listarBacklogFn(),
  });
  const modelo: ModeloPriorizacao = q.data?.modelo ?? "simples";

  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (q.data?.demandas ?? [])
      .filter((d) => d.status !== "concluido" && d.status !== "cancelado")
      .filter((d) =>
        t === ""
          ? true
          : `${d.nome} ${d.areaDemandante ?? ""} ${d.gerenteNome ?? ""}`.toLowerCase().includes(t),
      );
  }, [q.data, busca]);

  const porQuadrante = useMemo(() => {
    const m = new Map<Quadrante, ProjetoBacklog[]>();
    for (const d of itens) {
      const quad = quadranteDe(d);
      if (!quad) continue;
      m.set(quad, [...(m.get(quad) ?? []), d]);
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
    <AppShell
      title="Matriz de priorização"
      subtitle="Valor contra esforço: a fila, o que está andando e o que parou, no mesmo plano."
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar: {String(q.error)}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-56 max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, área ou gerente..."
              className="pl-8"
            />
          </div>

          {/* O modelo em uso aparece aqui, e só aqui: é nesta visão que
              a fórmula muda o que se vê, e saber que "esforço 3" vem do
              RICE ou do modelo simples é o que permite discordar da
              posição de um quadrante. */}
          <p className="text-xs text-muted-foreground">
            Pontuação por{" "}
            <strong className="font-medium text-foreground">
              {modelo === "rice" ? "RICE" : "valor ÷ esforço"}
            </strong>
            {modelo === "rice"
              ? " — alcance × impacto × confiança ÷ esforço."
              : " — modelo simples, definido em Administração."}
          </p>
        </div>

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {ordem.map(({ q: quad, classe }) => {
                const lista = porQuadrante.get(quad) ?? [];
                const fora = lista.filter((d) => d.status !== "backlog").length;

                return (
                  <section key={quad} className={cn("panel p-4", classe)}>
                    <div className="flex items-baseline justify-between">
                      <h2 className="text-sm font-semibold">{QUADRANTE_LABEL[quad]}</h2>
                      {/* Quantos do quadrante já saíram da fila: é o
                          número que diz se a decisão seguiu a matriz. */}
                      <span className="font-mono text-xs text-muted-foreground">
                        {lista.length}
                        {fora > 0 ? ` · ${fora} priorizado(s)` : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {quad === "ganho_rapido"
                        ? "Muito valor, pouco esforço. Faça agora."
                        : quad === "aposta"
                          ? "Muito valor, muito esforço. Precisa de decisão."
                          : quad === "preencher"
                            ? "Pouco valor, pouco esforço. Encaixa nas folgas."
                            : "Pouco valor, muito esforço. Vale perguntar por quê."}
                    </p>

                    <ul className="mt-3 space-y-1.5">
                      {lista.map((d) => {
                        const naFila = d.status === "backlog";
                        return (
                          /* Priorizado ganha fundo e tarja com a
                             situação; a fila continua com o cartão
                             vazado. A situação vai por escrito, e não
                             só por cor: quem imprime a matriz para a
                             reunião perde a cor, e "priorizado"
                             responde menos do que "em execução". */
                          <li
                            key={d.id}
                            className={cn(
                              "rounded-md border p-2",
                              naFila ? "border-border" : "border-primary/30 bg-primary/5",
                            )}
                          >
                            <p className="flex items-center gap-1.5 text-xs font-medium">
                              <span className="truncate">{d.nome}</span>
                              {d.sigiloso ? (
                                <Lock className="size-3 shrink-0 text-warning" />
                              ) : null}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              {!naFila ? (
                                <Badge
                                  variant="outline"
                                  className={cn("text-[10px]", classeStatus(d.status))}
                                >
                                  {PROJECT_STATUS_LABEL[d.status as ProjectStatus] ?? d.status}
                                </Badge>
                              ) : null}
                              <span className="truncate">
                                {d.areaDemandante ?? "Sem área"} · score{" "}
                                {calcularScore(modelo, d) ?? "—"}
                              </span>
                            </p>
                          </li>
                        );
                      })}
                      {lista.length === 0 ? (
                        <li className="py-3 text-center text-xs text-muted-foreground">Vazio</li>
                      ) : null}
                    </ul>
                  </section>
                );
              })}
            </div>

            {/* Legenda: a cor sozinha não carrega a informação — quem
                imprime a matriz para a reunião a perde inteira. */}
            <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-border" /> aguardando decisão
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-primary/30 bg-primary/5" /> já
                priorizado
              </span>
              {semPontuacao.length > 0 ? (
                <span>
                  {semPontuacao.length} projeto(s) fora da matriz por falta de valor ou esforço.
                </span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
