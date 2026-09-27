/**
 * Quadro kanban do projeto.
 *
 * O `quadro` gravado continua sendo do time: nada aqui move tarefa no
 * banco por conta própria. O que esta tela faz é LER as datas e
 * organizar o que já existe — ordenar, agrupar e destacar. Um robô
 * mexendo no quadro à noite mina a confiança nele, e o time para de
 * usar.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { QuadroTarefa, Tarefa } from "@/repositories/projetos.repo";
import { moverTarefaFn } from "@/services/projetos.functions";
import { cn } from "@/lib/utils";

/**
 * "A fazer" virou "Esta semana".
 *
 * O rótulo mudou porque o conteúdo mudou: a coluna passou a reunir o
 * que está planejado para o período corrente, venha do backlog ou já
 * marcado como a fazer. Chamá-la de "A fazer" enquanto ela decide
 * sozinha quem entra seria um nome que mente sobre o critério.
 *
 * As outras três continuam sendo exatamente o `quadro` gravado.
 */
export const QUADROS: { key: QuadroTarefa; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Esta semana" },
  { key: "doing", label: "Em andamento" },
  { key: "done", label: "Concluído" },
];

function fmt(v: Date | string): string {
  return new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function meiaNoite(v: Date | string): Date {
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Domingo que encerra a semana corrente.
 *
 * A semana começa na segunda, como no calendário brasileiro de
 * trabalho. Domingo pertence à semana que termina, não à que começa —
 * daí o caso especial: `getDay()` devolve 0 para ele, e somar "7 menos
 * zero" jogaria o corte para o domingo seguinte.
 */
function fimDaSemana(hoje: Date): Date {
  const d = meiaNoite(hoje);
  const js = d.getDay();
  d.setDate(d.getDate() + (js === 0 ? 0 : 7 - js));
  return d;
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

  const hoje = meiaNoite(new Date());
  const corte = fimDaSemana(hoje);

  /**
   * O conteúdo de cada coluna, já ordenado.
   *
   * Em backlog, esta semana e em andamento a ordem é a data de início
   * planejada: é a sequência em que o trabalho deveria acontecer, e é o
   * que quem olha o quadro quer ler de cima para baixo. Concluído
   * inverte e usa a data de conclusão — ali a pergunta é "o que acabou
   * de sair", não "o que começa primeiro".
   *
   * Tarefa planejada para o período aparece em "Esta semana" mesmo
   * ainda estando no backlog. É leitura derivada, não movimento: o
   * `quadro` no banco continua "backlog", e arrastá-la é que grava a
   * mudança. Assim o quadro não muda sozinho de um dia para o outro.
   *
   * Quem já está em andamento fica onde está. A tarefa passou de "a
   * fazer" no momento em que alguém começou, e puxá-la de volta por
   * causa de uma data seria regredir o trabalho na tela.
   */
  const porColuna = useMemo(() => {
    const porInicio = (a: Tarefa, b: Tarefa) =>
      meiaNoite(a.inicio).getTime() - meiaNoite(b.inicio).getTime();

    const daSemana = (t: Tarefa) => t.quadro === "backlog" && meiaNoite(t.inicio) <= corte;

    const mapa: Record<QuadroTarefa, Tarefa[]> = {
      backlog: tarefas.filter((t) => t.quadro === "backlog" && !daSemana(t)).sort(porInicio),
      todo: tarefas.filter((t) => t.quadro === "todo" || daSemana(t)).sort(porInicio),
      doing: tarefas.filter((t) => t.quadro === "doing").sort(porInicio),
      done: tarefas
        .filter((t) => t.quadro === "done")
        .sort((a, b) => {
          // Sem data de conclusão — tarefa marcada como pronta antes de
          // a coluna existir — cai no término planejado, que é a melhor
          // aproximação disponível.
          const fa = a.concluidoEm ?? a.fim;
          const fb = b.concluidoEm ?? b.fim;
          return new Date(fb).getTime() - new Date(fa).getTime();
        }),
    };
    return mapa;
  }, [tarefas, corte]);

  const atrasadas = useMemo(
    () => tarefas.filter((t) => t.quadro !== "done" && meiaNoite(t.fim) < hoje).length,
    [tarefas, hoje],
  );

  return (
    <div className="space-y-3">
      {atrasadas > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5 text-warning" />
          {atrasadas} tarefa(s) com término no passado — destacadas em laranja.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {QUADROS.map((col) => {
          const itens = porColuna[col.key];
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

              {/* O critério da coluna fica escrito nela: sem isso,
                  encontrar no meio de "Esta semana" uma tarefa que
                  ninguém moveu para lá parece defeito. */}
              {col.key === "todo" ? (
                <p className="mb-2 text-[10px] leading-tight text-muted-foreground">
                  Inclui o que está planejado até {fmt(corte)}.
                </p>
              ) : null}

              <ul className="space-y-2">
                {itens.map((t) => {
                  const done = t.quadro === "done";
                  const atrasada = !done && meiaNoite(t.fim) < hoje;
                  // Veio do backlog pela data, não por alguém ter movido.
                  const puxadaPelaData = col.key === "todo" && t.quadro === "backlog";

                  return (
                    <li key={t.id}>
                      <button
                        draggable={editavel}
                        onDragStart={() => setArrastando(t.id)}
                        onDragEnd={() => setArrastando(null)}
                        onClick={() => editavel && onEditar(t)}
                        className={cn(
                          // Post-it: canto inferior direito dobrado e leve
                          // inclinação no hover, para o quadro não parecer
                          // uma planilha.
                          "w-full rounded-sm p-3 text-left shadow-sm transition-transform",
                          "[clip-path:polygon(0_0,100%_0,100%_calc(100%-14px),calc(100%-14px)_100%,0_100%)]",
                          "hover:-rotate-1 hover:shadow-md",
                          // Laranja é estado, não decoração: o papel
                          // muda de cor quando o prazo passou, e a cor
                          // vence o amarelo padrão.
                          atrasada
                            ? "bg-[#fdba74] text-[#4a2400]"
                            : done
                              ? "bg-[#e7e3cf] text-[#3f3000]"
                              : "bg-[#fde68a] text-[#3f3000]",
                          editavel ? "cursor-grab active:cursor-grabbing" : "cursor-default",
                          arrastando === t.id ? "rotate-2 opacity-60" : "",
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
                          {atrasada ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-[#7c2d12]/40 text-[10px] font-semibold text-[#7c2d12]"
                            >
                              <TriangleAlert className="size-3" /> atrasada
                            </Badge>
                          ) : null}
                          {puxadaPelaData ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-[#8a6d09]/40 text-[10px] text-[#6b5a15]"
                              title="Está no backlog e começa nesta semana. Arraste para confirmar que entrou na fila."
                            >
                              <CalendarClock className="size-3" /> do backlog
                            </Badge>
                          ) : null}
                          {t.marco ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                atrasada
                                  ? "border-[#7c2d12]/40 text-[#7c2d12]"
                                  : "border-[#8a6d09]/40 text-[#6b5a15]",
                              )}
                            >
                              marco
                            </Badge>
                          ) : null}
                          <span
                            className={cn(
                              "font-mono text-[11px]",
                              atrasada ? "font-semibold text-[#7c2d12]" : "text-[#6b5a15]",
                            )}
                          >
                            {fmt(t.inicio)} — {fmt(t.fim)}
                          </span>
                        </div>

                        {(responsaveis[t.id] ?? []).length > 0 ? (
                          <p
                            className={cn(
                              "mt-1.5 truncate text-[11px]",
                              atrasada ? "text-[#7c2d12]" : "text-[#6b5a15]",
                            )}
                          >
                            {(responsaveis[t.id] ?? []).map(nomeRecurso).join(", ")}
                          </p>
                        ) : null}

                        {!done && t.progresso > 0 ? (
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#00000022]">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                atrasada ? "bg-[#7c2d12]" : "bg-[#8a6d09]",
                              )}
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
    </div>
  );
}
