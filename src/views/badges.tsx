import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  evaluateSla,
  formatSlaHoras,
  type Priority,
  type RecordType,
  type Ticket,
  type TicketStatus,
} from "@/lib/itsm-types";

const priorityStyle: Record<Priority, string> = {
  P1: "bg-p1/15 text-p1 border-p1/40",
  P2: "bg-p2/15 text-p2 border-p2/40",
  P3: "bg-p3/15 text-p3 border-p3/40",
  P4: "bg-p4/15 text-p4 border-p4/40",
};

export function PriorityBadge({ value, full }: { value: Priority; full?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-medium",
        priorityStyle[value],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {full ? PRIORITY_LABEL[value] : value}
    </span>
  );
}

const typeStyle: Record<RecordType, string> = {
  incidente: "bg-destructive/12 text-destructive border-destructive/30",
  requisicao: "bg-info/12 text-info border-info/30",
  melhoria: "bg-success/12 text-success border-success/30",
  problema: "bg-warning/12 text-warning border-warning/30",
  tarefa: "bg-muted text-muted-foreground border-border",
};

export function TypeBadge({ value }: { value: RecordType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        typeStyle[value],
      )}
    >
      {TYPE_LABEL[value]}
    </span>
  );
}

const statusStyle: Record<TicketStatus, string> = {
  novo: "bg-primary/12 text-primary border-primary/30",
  triagem: "bg-info/12 text-info border-info/30",
  em_andamento: "bg-warning/12 text-warning border-warning/30",
  aguardando: "bg-muted text-muted-foreground border-border",
  resolvido: "bg-success/12 text-success border-success/30",
  fechado: "bg-secondary text-muted-foreground border-border",
};

export function StatusBadge({ value }: { value: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        statusStyle[value],
      )}
    >
      {STATUS_LABEL[value]}
    </span>
  );
}

export function SlaPill({ ticket }: { ticket: Ticket }) {
  const hydrated = useHydrated();
  if (!hydrated) return <span className="font-mono text-xs text-muted-foreground">—</span>;

  const { estado, restanteHoras, meta, respostaAtrasada } = evaluateSla(ticket);
  const restante = Math.abs(restanteHoras);
  const tempo =
    restante < 24 ? `${Math.max(1, Math.round(restante))}h` : `${Math.round(restante / 24)}d`;
  const label =
    estado === "atendido"
      ? "Dentro do SLA"
      : estado === "estourado"
        ? `SLA vencido há ${tempo}`
        : respostaAtrasada
          ? "Resposta em atraso"
          : `${tempo} restantes`;
  const tone =
    estado === "atendido"
      ? "text-success"
      : estado === "estourado"
        ? "text-destructive"
        : estado === "em_risco"
          ? "text-warning"
          : "text-muted-foreground";
  return (
    <span
      className={cn("font-mono text-xs", tone)}
      title={`Meta ${formatSlaHoras(meta.resposta)} resposta · ${formatSlaHoras(meta.solucao)} solução`}
    >
      {label}
    </span>
  );
}