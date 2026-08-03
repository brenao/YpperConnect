import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/itsm/app-shell";
import { PriorityBadge, SlaPill, StatusBadge, TypeBadge } from "@/components/itsm/badges";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useItsm } from "@/lib/itsm-store";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  type RecordType,
  type Ticket,
  type TicketStatus,
} from "@/lib/itsm-types";

export const Route = createFileRoute("/chamados")({
  head: () => ({
    meta: [
      { title: "Chamados · GovTI" },
      {
        name: "description",
        content:
          "Fila única de incidentes, requisições, melhorias, problemas e tarefas com prioridade, status e SLA padronizados.",
      },
      { property: "og:title", content: "Chamados · GovTI" },
      {
        property: "og:description",
        content: "Fila única de atendimento de TI com classificação ITIL e controle de SLA.",
      },
    ],
  }),
  component: Chamados,
});

function Chamados() {
  const { tickets, updateTicket } = useItsm();
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<string>("todos");
  const [status, setStatus] = useState<string>("todos");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (tipo === "todos" || t.tipo === tipo) &&
          (status === "todos" || t.status === status) &&
          (q.trim() === "" ||
            `${t.id} ${t.titulo} ${t.solicitante} ${t.servico}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [tickets, tipo, status, q],
  );

  const atual: Ticket | null = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <AppShell
      title="Chamados"
      subtitle="Canal único de abertura e acompanhamento — incidentes, requisições, melhorias, problemas e tarefas"
    >
      <div className="space-y-4">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              maxLength={80}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por ID, título, solicitante ou serviço"
              className="pl-9"
            />
          </div>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Classificação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as classificações</SelectItem>
              {(Object.keys(TYPE_LABEL) as RecordType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[7rem_1fr_10rem_7rem_9rem_9rem] gap-3 border-b border-border px-5 py-3 text-xs uppercase tracking-wide text-muted-foreground lg:grid">
            <span>ID</span>
            <span>Registro</span>
            <span>Classificação</span>
            <span>Prioridade</span>
            <span>Status</span>
            <span>SLA</span>
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelectedId(t.id)}
                  className="grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-secondary/50 lg:grid-cols-[7rem_1fr_10rem_7rem_9rem_9rem] lg:items-center lg:gap-3"
                >
                  <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{t.titulo}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.servico} · {t.solicitante}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <TypeBadge value={t.tipo} />
                  </span>
                  <span>
                    <PriorityBadge value={t.prioridade} />
                  </span>
                  <span>
                    <StatusBadge value={t.status} />
                  </span>
                  <SlaPill prazo={t.prazoSla} status={t.status} />
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                Nenhum chamado encontrado com os filtros atuais.
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <Sheet open={!!atual} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {atual ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-sm text-muted-foreground">
                  {atual.id}
                </SheetTitle>
                <SheetDescription className="text-base text-foreground">
                  {atual.titulo}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                <div className="flex flex-wrap gap-2">
                  <TypeBadge value={atual.tipo} />
                  <PriorityBadge value={atual.prioridade} full />
                  <StatusBadge value={atual.status} />
                </div>

                <p className="text-sm text-muted-foreground">{atual.descricao}</p>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Serviço", atual.servico],
                    ["Categoria", atual.categoria],
                    ["Solicitante", atual.solicitante],
                    ["Responsável", atual.responsavel],
                    ["Equipe", atual.equipe],
                    ["Origem", atual.origem === "ia" ? "Assistente IA" : atual.origem],
                    ["Impacto", atual.impacto],
                    ["Urgência", atual.urgencia],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border bg-surface p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="mt-0.5 capitalize">{v}</dd>
                    </div>
                  ))}
                </dl>

                {atual.problemaVinculado ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                    <p className="flex items-center gap-2 text-xs font-medium text-warning">
                      <Sparkles className="size-3.5" /> Correlação identificada
                    </p>
                    <p className="mt-1">
                      Vinculado ao Problema {atual.problemaVinculado} para análise de causa raiz.
                    </p>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Atualizar status
                  </p>
                  <Select
                    value={atual.status}
                    onValueChange={(v) => {
                      updateTicket(atual.id, { status: v as TicketStatus });
                      toast.success(
                        `${atual.id} atualizado para ${STATUS_LABEL[v as TicketStatus]}`,
                      );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    updateTicket(atual.id, { responsavel: "Equipe de TI" });
                    toast.success("Chamado atribuído à equipe de TI");
                  }}
                >
                  Assumir chamado
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}