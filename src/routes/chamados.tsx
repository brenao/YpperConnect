import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/itsm/app-shell";
import { PriorityBadge, SlaPill, StatusBadge, TypeBadge } from "@/components/itsm/badges";
import { SlaPanel } from "@/components/itsm/sla-panel";
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
import { useItsm } from "@/lib/itsm-store";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  type RecordType,
  type Ticket,
  type TicketStatus,
} from "@/lib/itsm-types";
import { useHydrated } from "@/hooks/use-hydrated";

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
                  <SlaPill ticket={t} />
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