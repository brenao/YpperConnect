import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles, Server } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { PriorityBadge, SlaPill, StatusBadge, TypeBadge } from "@/views/badges";
import { SlaPanel } from "@/views/sla-panel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { useItsm } from "@/controllers/itsm-store";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  type RecordType,
  type Ticket,
  type TicketStatus,
} from "@/models/itsm-types";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

const PRIORITY_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

const TABS = [
  { value: "todos", label: "Todos" },
  { value: "incidente", label: "Incidentes" },
  { value: "requisicao", label: "Requisições" },
  { value: "melhoria", label: "Melhorias" },
  { value: "problema", label: "Problemas" },
  { value: "tarefa", label: "Tarefas" },
] as const;

const TAB_ACCENT: Record<string, string> = {
  todos: "bg-primary/15 text-primary border-primary/40",
  incidente: "bg-destructive/15 text-destructive border-destructive/40",
  requisicao: "bg-info/15 text-info border-info/40",
  melhoria: "bg-success/15 text-success border-success/40",
  problema: "bg-warning/15 text-warning border-warning/40",
  tarefa: "bg-secondary text-foreground border-border",
};

function fmtDataHora(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export const Route = createFileRoute("/chamados")({
  head: () => ({
    meta: [
      { title: "Chamados · YpperConnect" },
      {
        name: "description",
        content:
          "Fila única de incidentes, requisições, melhorias, problemas e tarefas com prioridade, status e SLA padronizados.",
      },
      { property: "og:title", content: "Chamados · YpperConnect" },
      {
        property: "og:description",
        content: "Fila única de atendimento de TI com classificação ITIL e controle de SLA.",
      },
    ],
  }),
  component: Chamados,
});

function Chamados() {
  const { tickets, updateTicket, createTicket, role } = useItsm();
  const hydrated = useHydrated();
  const isTi = hydrated ? role === "ti" : true;
  const [q, setQ] = useState("");
  const [encerramento, setEncerramento] = useState("");
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

  const contagemPorTipo = useMemo(() => {
    const base: Record<string, number> = { todos: tickets.length };
    tickets.forEach((t) => {
      base[t.tipo] = (base[t.tipo] ?? 0) + 1;
    });
    return base;
  }, [tickets]);

  /** Agrupa por sistema e ordena por criticidade e, em seguida, data de abertura. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Ticket[]>();
    filtered.forEach((t) => {
      const chave = t.sistema?.trim() || t.servico || "Sem sistema";
      mapa.set(chave, [...(mapa.get(chave) ?? []), t]);
    });
    const ordenar = (a: Ticket, b: Ticket) =>
      (PRIORITY_ORDER[a.prioridade] ?? 9) - (PRIORITY_ORDER[b.prioridade] ?? 9) ||
      new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime();

    return [...mapa.entries()]
      .map(([sistema, lista]) => ({ sistema, lista: [...lista].sort(ordenar) }))
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.lista[0]!.prioridade] ?? 9) -
            (PRIORITY_ORDER[b.lista[0]!.prioridade] ?? 9) ||
          a.sistema.localeCompare(b.sistema),
      );
  }, [filtered]);

  const atual: Ticket | null = tickets.find((t) => t.id === selectedId) ?? null;

  // Recorrência: 3+ incidentes no mesmo sistema/serviço sugerem abertura de Problema.
  const sugestoesProblema = useMemo(() => {
    const grupos = new Map<string, Ticket[]>();
    tickets
      .filter((t) => t.tipo === "incidente")
      .forEach((t) => {
        const chave = t.sistema?.trim() || t.servico;
        grupos.set(chave, [...(grupos.get(chave) ?? []), t]);
      });
    return [...grupos.entries()]
      .filter(([chave, lista]) => {
        const jaExiste = tickets.some(
          (t) => t.tipo === "problema" && `${t.titulo} ${t.sistema ?? ""}`.toLowerCase().includes(chave.toLowerCase()),
        );
        return lista.length >= 3 && !jaExiste;
      })
      .map(([chave, lista]) => ({ chave, lista }));
  }, [tickets]);

  function abrirProblema(chave: string, lista: Ticket[]) {
    const p = createTicket({
      titulo: `Investigação de causa raiz — ${chave}`,
      descricao: `Criado a partir da recorrência de ${lista.length} incidentes em ${chave}. Incidentes relacionados: ${lista
        .map((t) => t.id)
        .join(", ")}.`,
      tipo: "problema",
      categoria: lista[0]?.categoria ?? "Infraestrutura",
      servico: lista[0]?.servico ?? chave,
      sistema: lista[0]?.sistema,
      impacto: "alto",
      urgencia: "media",
      solicitante: "Equipe de TI",
      origem: "ia",
    });
    lista.forEach((t) => updateTicket(t.id, { problemaVinculado: p.id }));
    toast.success(`Problema ${p.id} criado`, {
      description: "Incidentes recorrentes vinculados para análise de causa raiz.",
    });
  }

  return (
    <AppShell
      title="Chamados"
      subtitle="Canal único de abertura e acompanhamento — incidentes, requisições, melhorias, problemas e tarefas"
    >
      <div className="space-y-4">
        {isTi && sugestoesProblema.length ? (
          <div className="panel space-y-3 border-warning/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <Sparkles className="size-4" /> Recorrência detectada — avalie abrir um Problema
            </p>
            {sugestoesProblema.map(({ chave, lista }) => (
              <div key={chave} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
                <span className="text-sm">
                  <strong>{chave}</strong> acumulou {lista.length} incidentes ({lista.map((t) => t.id).join(", ")}).
                </span>
                <Button size="sm" variant="secondary" onClick={() => abrirProblema(chave, lista)}>
                  Criar Problema
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="panel space-y-4 p-4">
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1.5">
            {TABS.map((tab) => {
              const ativo = tipo === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setTipo(tab.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-all",
                    ativo
                      ? `${TAB_ACCENT[tab.value]} font-medium shadow-sm`
                      : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 font-mono text-[11px]",
                      ativo ? "bg-current/15" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {contagemPorTipo[tab.value] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
        </div>

        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[6rem_1fr_9rem_5rem_8.5rem_7rem_7rem_8rem] gap-3 border-b border-border px-5 py-3 text-xs uppercase tracking-wide text-muted-foreground lg:grid">
            <span>ID</span>
            <span>Registro</span>
            <span>Sistema</span>
            <span>Prior.</span>
            <span>Status</span>
            <span>Abertura</span>
            <span>Limite SLA</span>
            <span>Situação</span>
          </div>

          {grupos.map(({ sistema, lista }) => (
            <section key={sistema}>
              <header className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-5 py-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Server className="size-3.5 text-muted-foreground" />
                  {sistema}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {lista.length} {lista.length === 1 ? "chamado" : "chamados"}
                </span>
              </header>
              <ul className="divide-y divide-border">
                {lista.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelectedId(t.id)}
                      className="grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-secondary/50 lg:grid-cols-[6rem_1fr_9rem_5rem_8.5rem_7rem_7rem_8rem] lg:items-center lg:gap-3"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{t.titulo}</span>
                        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                          <TypeBadge value={t.tipo} />
                          <span className="truncate">{t.solicitante}</span>
                        </span>
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {t.sistema?.trim() || t.servico}
                      </span>
                      <span>
                        <PriorityBadge value={t.prioridade} />
                      </span>
                      <span>
                        <StatusBadge value={t.status} />
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {hydrated ? fmtDataHora(t.criadoEm) : "—"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {hydrated ? fmtDataHora(t.prazoSla) : "—"}
                      </span>
                      <SlaPill ticket={t} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {grupos.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              Nenhum chamado encontrado com os filtros atuais.
            </p>
          ) : null}
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
                     ...(atual.sistema ? [["Sistema", atual.sistema]] : []),
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

                <SlaPanel ticket={atual} />

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

                {atual.descricaoEncerramento ? (
                  <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
                    <p className="text-xs font-medium text-success">Descrição de encerramento</p>
                    <p className="mt-1">{atual.descricaoEncerramento}</p>
                  </div>
                ) : null}

                {isTi ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Descrição para encerramento
                      </p>
                      <Textarea
                        rows={3}
                        maxLength={1000}
                        value={encerramento || atual.descricaoEncerramento || ""}
                        onChange={(e) => setEncerramento(e.target.value)}
                        placeholder="Descreva a solução aplicada, causa e orientações ao solicitante"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Atualizar status
                      </p>
                      <Select
                        value={atual.status}
                        onValueChange={(v) => {
                          const novo = v as TicketStatus;
                          const texto = (encerramento || atual.descricaoEncerramento || "").trim();
                          if ((novo === "resolvido" || novo === "fechado") && texto.length < 10) {
                            toast.error("Informe a descrição de encerramento", {
                              description: "Obrigatória para resolver ou fechar o chamado.",
                            });
                            return;
                          }
                          updateTicket(atual.id, {
                            status: novo,
                            ...(texto ? { descricaoEncerramento: texto } : {}),
                          });
                          setEncerramento("");
                          toast.success(`${atual.id} atualizado para ${STATUS_LABEL[novo]}`);
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
                  </>
                ) : (
                  <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted-foreground">
                    <Badge variant="outline" className="mb-2">Perfil não TI</Badge>
                    <p>
                      Somente a equipe de TI pode responder, atuar e encerrar chamados. Você pode
                      acompanhar o andamento por aqui.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}