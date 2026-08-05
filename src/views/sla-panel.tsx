import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";
import { evaluateSla, formatSlaHoras, type Ticket } from "@/models/itsm-types";

const stateLabel = {
  atendido: "SLA atendido",
  no_prazo: "Dentro do prazo",
  em_risco: "Em risco",
  estourado: "SLA vencido",
} as const;

const stateTone = {
  atendido: "text-success",
  no_prazo: "text-muted-foreground",
  em_risco: "text-warning",
  estourado: "text-destructive",
} as const;

const barTone = {
  atendido: "bg-success",
  no_prazo: "bg-primary",
  em_risco: "bg-warning",
  estourado: "bg-destructive",
} as const;

/** Acompanhamento do SLA de resposta e solução do chamado. */
export function SlaPanel({ ticket }: { ticket: Ticket }) {
  const hydrated = useHydrated();
  const { estado, consumo, restanteHoras, meta, respostaAtrasada } = evaluateSla(ticket);
  const restante = Math.abs(restanteHoras);
  const tempo =
    restante < 24 ? `${Math.max(1, Math.round(restante))}h` : `${Math.round(restante / 24)}d`;

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">
          SLA · {ticket.tipo} {ticket.prioridade}
        </span>
        <span className={cn("font-mono", hydrated ? stateTone[estado] : "text-muted-foreground")}>
          {hydrated
            ? `${stateLabel[estado]}${estado === "atendido" ? "" : estado === "estourado" ? ` há ${tempo}` : ` · ${tempo} restantes`}`
            : "—"}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full transition-all", barTone[estado])}
          style={{ width: `${hydrated ? Math.min(100, Math.max(2, consumo)) : 0}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Meta de resposta</p>
          <p className="font-mono">
            {formatSlaHoras(meta.resposta)}
            {" · "}
            <span
              className={
                ticket.respondidoEm
                  ? "text-success"
                  : respostaAtrasada
                    ? "text-destructive"
                    : "text-muted-foreground"
              }
            >
              {ticket.respondidoEm ? "respondido" : respostaAtrasada ? "em atraso" : "pendente"}
            </span>
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Meta de solução</p>
          <p className="font-mono">
            {formatSlaHoras(meta.solucao)}
            {" · "}
            <span className="text-muted-foreground">
              {hydrated ? new Date(ticket.prazoSla).toLocaleString("pt-BR") : "—"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}