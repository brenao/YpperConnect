/**
 * Instrutor de IA: avalia o detalhamento do cronograma pelas boas
 * práticas do PMI e devolve nota, pontos fortes e problemas acionáveis.
 *
 * Roda sob demanda, não ao abrir a tela: é chamada paga a um provedor
 * externo e o cronograma muda pouco entre uma visita e outra.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { GraduationCap, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { evaluateProjectPlan, type CoachResult } from "@/services/ai-project-coach.functions";

const VEREDITO: Record<CoachResult["veredito"], { rotulo: string; classe: string }> = {
  bom: { rotulo: "Planejamento consistente", classe: "text-success" },
  regular: { rotulo: "Planejamento aceitável", classe: "text-warning" },
  ruim: { rotulo: "Planejamento frágil", classe: "text-destructive" },
};

const SEVERIDADE: Record<string, string> = {
  alta: "border-destructive/40 text-destructive",
  media: "border-warning/40 text-warning",
  baixa: "border-border text-muted-foreground",
};

export function ProjectCoach({ resumo }: { resumo: string }) {
  const [resultado, setResultado] = useState<CoachResult | null>(null);

  const avaliar = useMutation({
    mutationFn: () => evaluateProjectPlan({ data: { resumo } }),
    onSuccess: (r) => setResultado(r),
  });

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GraduationCap className="size-4 text-primary" /> Instrutor de cronograma
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={avaliar.isPending}
          onClick={() => avaliar.mutate()}
        >
          {avaliar.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Avaliando...
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" /> {resultado ? "Avaliar de novo" : "Avaliar"}
            </>
          )}
        </Button>
      </div>

      {avaliar.error ? (
        <p className="mt-3 text-sm text-destructive">{(avaliar.error as Error).message}</p>
      ) : null}

      {!resultado && !avaliar.isPending && !avaliar.error ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Avalia o detalhamento das tarefas, o sequenciamento, os marcos e o acompanhamento segundo
          as boas práticas do PMI, e aponta o que corrigir.
        </p>
      ) : null}

      {resultado ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xl font-semibold">{resultado.nota}</span>
            <span className={cn("text-sm font-medium", VEREDITO[resultado.veredito].classe)}>
              {VEREDITO[resultado.veredito].rotulo}
            </span>
          </div>

          <p className="text-sm text-muted-foreground">{resultado.resumo}</p>

          {resultado.pontosFortes.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pontos fortes
              </p>
              <ul className="mt-1 space-y-0.5">
                {resultado.pontosFortes.map((p, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    · {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {resultado.problemas.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                O que corrigir
              </p>
              <ul className="mt-1.5 space-y-2">
                {resultado.problemas.map((p, i) => (
                  <li key={i} className="rounded-lg border border-border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", SEVERIDADE[p.severidade] ?? "")}
                      >
                        {p.severidade}
                      </Badge>
                      <span className="text-sm font-medium">{p.titulo}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.recomendacao}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            Avaliação gerada por IA a partir da forma do cronograma. Use como checklist, não como
            veredito.
          </p>
        </div>
      ) : null}
    </section>
  );
}
