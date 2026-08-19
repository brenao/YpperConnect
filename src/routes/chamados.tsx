import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Sparkles, Server, Filter, X, Loader2, History } from "lucide-react";
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
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  type Priority,
  type TicketStatus,
} from "@/models/itsm-types";
import type { Chamado } from "@/repositories/chamados.repo";
import { paraTicket, fmtDataHora } from "@/lib/chamado-adapter";
import {
  listarChamadosFn,
  criarChamadoFn,
  atualizarChamadoFn,
  buscarChamadoFn,
  type NovoChamadoInput,
  type AlteracaoChamadoInput,
} from "@/services/chamados.functions";
import {
  usuarioAtualFn,
  listarUsuariosFn,
  listarAtendentesFn,
} from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

const PRIORITY_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/** Grid da lista. Constante única porque cabeçalho e linhas precisam bater. */
const GRID = "lg:grid-cols-[7rem_1fr_8rem_8rem_4.5rem_7.5rem_6.5rem_6.5rem_8rem]";

/** Valor sentinela do select: Radix não aceita SelectItem com value="". */
const SEM_RESPONSAVEL = "__nenhum__";

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

/** Rótulos legíveis para a trilha de auditoria. */
const CAMPO_LABEL: Record<string, string> = {
  criacao: "Chamado aberto",
  status: "Status",
  responsavelId: "Responsável",
  equipeId: "Equipe",
  impacto: "Impacto",
  urgencia: "Urgência",
  prioridade: "Prioridade",
  categoriaId: "Categoria",
  servicoId: "Serviço",
  sistemaId: "Sistema",
  problemaVinculadoId: "Problema vinculado",
  descricaoEncerramento: "Descrição de encerramento",
};

function textoBusca(c: Chamado) {
  return [
    c.codigo,
    c.titulo,
    c.descricao,
    c.solicitanteNome,
    c.servicoNome,
    c.sistemaNome,
    c.responsavelNome,
    c.equipeNome,
    c.origem,
    TYPE_LABEL[c.tipo],
    PRIORITY_LABEL[c.prioridade],
    STATUS_LABEL[c.status],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function fmtDataHoraLonga(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const Route = createFileRoute("/chamados")({
  head: () => ({
    meta: [
      { title: "Chamados · Beagle One" },
      {
        name: "description",
        content:
          "Fila única de incidentes, requisições, melhorias, problemas e tarefas com prioridade, status e SLA padronizados.",
      },
      { property: "og:title", content: "Chamados · Beagle One" },
      {
        property: "og:description",
        content: "Fila única de atendimento de TI com classificação ITIL e controle de SLA.",
      },
    ],
  }),
  component: Chamados,
});

function Chamados() {
  const qc = useQueryClient();

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const usuarios = useQuery({ queryKey: ["usuarios"], queryFn: () => listarUsuariosFn() });
  const atendentes = useQuery({ queryKey: ["atendentes"], queryFn: () => listarAtendentesFn() });
  const chamadosQuery = useQuery({
    queryKey: ["chamados"],
    queryFn: () => listarChamadosFn({ data: { limite: 500 } }),
  });

  const chamados: Chamado[] = useMemo(() => chamadosQuery.data ?? [], [chamadosQuery.data]);
  // Permissão de atuação: admin ou membro de alguma equipe de TI.
  const isTi = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;

  /** Resolve IDs gravados no histórico para nomes legíveis. */
  const nomePorId = useMemo(() => {
    const m = new Map<string, string>();
    (usuarios.data ?? []).forEach((u) => m.set(u.id, u.nome));
    return m;
  }, [usuarios.data]);

  const [q, setQ] = useState("");
  const [encerramento, setEncerramento] = useState("");
  const [tipo, setTipo] = useState<string>("todos");
  const [status, setStatus] = useState<string>("todos");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filtroSistema, setFiltroSistema] = useState<string>("todos");
  const [filtroResponsavel, setFiltroResponsavel] = useState<string>("todos");
  const [filtroPrioridade, setFiltroPrioridade] = useState<string>("todos");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todos");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Detalhe do chamado selecionado, com histórico. Só busca quando o painel abre. */
  const detalhe = useQuery({
    queryKey: ["chamado", selectedId],
    queryFn: () => buscarChamadoFn({ data: { id: selectedId! } }),
    enabled: !!selectedId,
  });

  const atualizar = useMutation({
    mutationFn: (v: AlteracaoChamadoInput) => atualizarChamadoFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chamados"] });
      qc.invalidateQueries({ queryKey: ["chamado", selectedId] });
    },
    onError: (e: Error) => toast.error("Não foi possível atualizar", { description: e.message }),
  });

  const criar = useMutation({
    mutationFn: (v: NovoChamadoInput) => criarChamadoFn({ data: v }),
    onError: (e: Error) => toast.error("Não foi possível criar", { description: e.message }),
  });

  const sistemasAtivos = useMemo(
    () => [...new Set(chamados.map((c) => c.sistemaNome).filter(Boolean))].sort() as string[],
    [chamados],
  );
  const responsaveisAtivos = useMemo(
    () => [...new Set(chamados.map((c) => c.responsavelNome).filter(Boolean))].sort() as string[],
    [chamados],
  );

  const filtered = useMemo(
    () =>
      chamados.filter(
        (c) =>
          (tipo === "todos" || c.tipo === tipo) &&
          (status === "todos" || c.status === status) &&
          (filtroSistema === "todos" || c.sistemaNome === filtroSistema) &&
          (filtroResponsavel === "todos" || c.responsavelNome === filtroResponsavel) &&
          (filtroPrioridade === "todos" || c.prioridade === filtroPrioridade) &&
          (filtroOrigem === "todos" || c.origem === filtroOrigem) &&
          (q.trim() === "" || textoBusca(c).includes(q.toLowerCase())),
      ),
    [chamados, tipo, status, filtroSistema, filtroResponsavel, filtroPrioridade, filtroOrigem, q],
  );

  const activeFiltersCount = [
    filtroSistema,
    filtroResponsavel,
    filtroPrioridade,
    filtroOrigem,
  ].filter((v) => v !== "todos").length;

  function clearFilters() {
    setQ("");
    setStatus("todos");
    setFiltroSistema("todos");
    setFiltroResponsavel("todos");
    setFiltroPrioridade("todos");
    setFiltroOrigem("todos");
  }

  const contagemPorTipo = useMemo(() => {
    const base: Record<string, number> = { todos: chamados.length };
    chamados.forEach((c) => {
      base[c.tipo] = (base[c.tipo] ?? 0) + 1;
    });
    return base;
  }, [chamados]);

  /** Agrupa por sistema e ordena por criticidade e, em seguida, data de abertura. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Chamado[]>();
    filtered.forEach((c) => {
      const chave = c.sistemaNome || c.servicoNome || "Sem sistema";
      mapa.set(chave, [...(mapa.get(chave) ?? []), c]);
    });
    const ordenar = (a: Chamado, b: Chamado) =>
      (PRIORITY_ORDER[a.prioridade] ?? 9) - (PRIORITY_ORDER[b.prioridade] ?? 9) ||
      new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime();

    return [...mapa.entries()]
      .map(([sistema, lista]) => ({ sistema, lista: [...lista].sort(ordenar) }))
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.lista[0]!.prioridade] ?? 9) -
            (PRIORITY_ORDER[b.lista[0]!.prioridade] ?? 9) || a.sistema.localeCompare(b.sistema),
      );
  }, [filtered]);

  const atual: Chamado | null = chamados.find((c) => c.id === selectedId) ?? null;

  // Recorrência: 3+ incidentes no mesmo sistema/serviço sugerem abertura de Problema.
  const sugestoesProblema = useMemo(() => {
    const porChave = new Map<string, Chamado[]>();
    chamados
      .filter((c) => c.tipo === "incidente")
      .forEach((c) => {
        const chave = c.sistemaNome || c.servicoNome || "Sem sistema";
        porChave.set(chave, [...(porChave.get(chave) ?? []), c]);
      });
    return [...porChave.entries()]
      .filter(([chave, lista]) => {
        const jaExiste = chamados.some(
          (c) => c.tipo === "problema" && c.titulo.toLowerCase().includes(chave.toLowerCase()),
        );
        return lista.length >= 3 && !jaExiste;
      })
      .map(([chave, lista]) => ({ chave, lista }));
  }, [chamados]);

  async function abrirProblema(chave: string, lista: Chamado[]) {
    const base = lista[0]!;
    try {
      const p = await criar.mutateAsync({
        titulo: `Investigação de causa raiz — ${chave}`.slice(0, 300),
        descricao: `Criado a partir da recorrência de ${lista.length} incidentes em ${chave}. Incidentes relacionados: ${lista.map((c) => c.codigo).join(", ")}.`,
        tipo: "problema",
        categoriaId: base.categoriaId,
        servicoId: base.servicoId,
        sistemaId: base.sistemaId,
        impacto: "alto",
        urgencia: "media",
        origem: "ia",
      });

      // Vincula em sequência: cada update grava sua própria linha de histórico.
      for (const c of lista) {
        await atualizar.mutateAsync({ id: c.id, problemaVinculadoId: p.id });
      }

      qc.invalidateQueries({ queryKey: ["chamados"] });
      toast.success(`Problema ${p.codigo} criado`, {
        description: "Incidentes recorrentes vinculados para análise de causa raiz.",
      });
    } catch {
      /* o onError das mutations já notificou */
    }
  }

  function alterarStatus(c: Chamado, novo: TicketStatus) {
    const texto = (encerramento || c.descricaoEncerramento || "").trim();
    if ((novo === "resolvido" || novo === "fechado") && texto.length < 10) {
      toast.error("Informe a descrição de encerramento", {
        description: "Obrigatória para resolver ou fechar o chamado.",
      });
      return;
    }
    atualizar.mutate(
      { id: c.id, status: novo, ...(texto ? { descricaoEncerramento: texto } : {}) },
      {
        onSuccess: () => {
          setEncerramento("");
          toast.success(`${c.codigo} atualizado para ${STATUS_LABEL[novo]}`);
        },
      },
    );
  }

  function alterarResponsavel(c: Chamado, valor: string) {
    const novoId = valor === SEM_RESPONSAVEL ? null : valor;
    // Atribuir também move o chamado para a equipe da pessoa: responsável
    // sem equipe correspondente quebra a fila por equipe.
    const pessoa = atendentes.data?.find((a) => a.id === novoId);
    atualizar.mutate(
      {
        id: c.id,
        responsavelId: novoId,
        ...(pessoa ? { equipeId: pessoa.equipeId } : {}),
      },
      {
        onSuccess: () =>
          toast.success(
            novoId ? `Atribuído a ${pessoa?.nome ?? "responsável"}` : "Atribuição removida",
          ),
      },
    );
  }

  /** Traduz o valor bruto do histórico para algo legível na tela. */
  function valorLegivel(campo: string, valor: string | null): string {
    if (!valor) return "vazio";
    if (campo === "status") return STATUS_LABEL[valor as TicketStatus] ?? valor;
    if (campo === "prioridade") return PRIORITY_LABEL[valor as Priority] ?? valor;
    if (campo.endsWith("Id")) return nomePorId.get(valor) ?? valor;
    if (campo === "descricaoEncerramento") {
      return valor.length > 60 ? `${valor.slice(0, 60)}...` : valor;
    }
    return valor;
  }

  const carregando = chamadosQuery.isPending || usuario.isPending;

  return (
    <AppShell
      title="Chamados"
      subtitle="Canal único de abertura e acompanhamento — incidentes, requisições, melhorias, problemas e tarefas"
    >
      <div className="space-y-4">
        {chamadosQuery.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os chamados: {String(chamadosQuery.error)}
          </div>
        ) : null}

        {isTi && sugestoesProblema.length ? (
          <div className="panel space-y-3 border-warning/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <Sparkles className="size-4" /> Recorrência detectada — avalie abrir um Problema
            </p>
            {sugestoesProblema.map(({ chave, lista }) => (
              <div
                key={chave}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <span className="text-sm">
                  <strong>{chave}</strong> acumulou {lista.length} incidentes (
                  {lista.map((c) => c.codigo).join(", ")}).
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={criar.isPending || atualizar.isPending}
                  onClick={() => abrirProblema(chave, lista)}
                >
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

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-56 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  maxLength={120}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por código, descrição, sistema, responsável..."
                  className="pl-9"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-44">
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
              <Button
                variant={advancedOpen ? "secondary" : "outline"}
                size="icon"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="shrink-0"
                aria-label="Filtros avançados"
              >
                <Filter className="size-4" />
              </Button>
              {q || activeFiltersCount > 0 || status !== "todos" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="shrink-0 gap-1 text-muted-foreground"
                >
                  <X className="size-3.5" /> Limpar
                </Button>
              ) : null}
            </div>

            {advancedOpen ? (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Sistema</label>
                  <Select value={filtroSistema} onValueChange={setFiltroSistema}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os sistemas</SelectItem>
                      {sistemasAtivos.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Responsável</label>
                  <Select value={filtroResponsavel} onValueChange={setFiltroResponsavel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os responsáveis</SelectItem>
                      {responsaveisAtivos.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Prioridade</label>
                  <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas as prioridades</SelectItem>
                      {(["P1", "P2", "P3", "P4"] as const).map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                  <label className="text-xs font-medium text-muted-foreground">Origem</label>
                  <div className="flex flex-wrap gap-2">
                    {(["todos", "portal", "ia", "email", "telefone"] as const).map((o) => (
                      <button
                        key={o}
                        onClick={() => setFiltroOrigem(o)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs transition-all",
                          filtroOrigem === o
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {o === "todos"
                          ? "Qualquer origem"
                          : o === "ia"
                            ? "Buddy AI"
                            : o.charAt(0).toUpperCase() + o.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {activeFiltersCount > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Filtros ativos:</span>
                {filtroSistema !== "todos" && (
                  <Badge variant="secondary" className="gap-1">
                    Sistema: {filtroSistema}
                    <button
                      onClick={() => setFiltroSistema("todos")}
                      aria-label="Remover filtro de sistema"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                )}
                {filtroResponsavel !== "todos" && (
                  <Badge variant="secondary" className="gap-1">
                    Responsável: {filtroResponsavel}
                    <button
                      onClick={() => setFiltroResponsavel("todos")}
                      aria-label="Remover filtro de responsável"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                )}
                {filtroPrioridade !== "todos" && (
                  <Badge variant="secondary" className="gap-1">
                    Prioridade: {PRIORITY_LABEL[filtroPrioridade as Priority]}
                    <button
                      onClick={() => setFiltroPrioridade("todos")}
                      aria-label="Remover filtro de prioridade"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                )}
                {filtroOrigem !== "todos" && (
                  <Badge variant="secondary" className="gap-1">
                    Origem:{" "}
                    {filtroOrigem === "ia"
                      ? "Buddy AI"
                      : filtroOrigem.charAt(0).toUpperCase() + filtroOrigem.slice(1)}
                    <button
                      onClick={() => setFiltroOrigem("todos")}
                      aria-label="Remover filtro de origem"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div
            className={cn(
              "hidden gap-3 border-b border-border px-5 py-3 text-xs uppercase tracking-wide text-muted-foreground lg:grid",
              GRID,
            )}
          >
            <span>Código</span>
            <span>Registro</span>
            <span>Sistema</span>
            <span>Responsável</span>
            <span>Prior.</span>
            <span>Status</span>
            <span>Abertura</span>
            <span>Limite SLA</span>
            <span>Situação</span>
          </div>

          {carregando ? (
            <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando chamados...
            </p>
          ) : null}

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
                {lista.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-secondary/50 lg:items-center lg:gap-3",
                        GRID,
                      )}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{c.codigo}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{c.titulo}</span>
                        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                          <TypeBadge value={c.tipo} />
                          <span className="truncate">{c.solicitanteNome}</span>
                        </span>
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {c.sistemaNome || c.servicoNome || "—"}
                      </span>
                      <span
                        className={cn(
                          "truncate text-sm",
                          c.responsavelNome ? "text-foreground" : "italic text-muted-foreground",
                        )}
                      >
                        {c.responsavelNome || "Não atribuído"}
                      </span>
                      <span>
                        <PriorityBadge value={c.prioridade} />
                      </span>
                      <span>
                        <StatusBadge value={c.status} />
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {fmtDataHora(c.criadoEm)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {fmtDataHora(c.prazoSla)}
                      </span>
                      <SlaPill ticket={paraTicket(c)} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {!carregando && grupos.length === 0 ? (
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
                  {atual.codigo}
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
                    ["Serviço", atual.servicoNome ?? "—"],
                    ["Sistema", atual.sistemaNome ?? "—"],
                    ["Solicitante", atual.solicitanteNome ?? "—"],
                    ["Responsável", atual.responsavelNome ?? "Não atribuído"],
                    ["Equipe", atual.equipeNome ?? "—"],
                    ["Origem", atual.origem === "ia" ? "Buddy AI" : atual.origem],
                    ["Impacto", atual.impacto],
                    ["Urgência", atual.urgencia],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border bg-surface p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="mt-0.5 capitalize">{v}</dd>
                    </div>
                  ))}
                </dl>

                <SlaPanel ticket={paraTicket(atual)} />

                {atual.problemaVinculadoId ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                    <p className="flex items-center gap-2 text-xs font-medium text-warning">
                      <Sparkles className="size-3.5" /> Correlação identificada
                    </p>
                    <p className="mt-1">Vinculado a um Problema para análise de causa raiz.</p>
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
                        Responsável
                      </p>
                      <Select
                        value={atual.responsavelId ?? SEM_RESPONSAVEL}
                        disabled={atualizar.isPending}
                        onValueChange={(v) => alterarResponsavel(atual, v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não atribuído" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_RESPONSAVEL}>Não atribuído</SelectItem>
                          {(atendentes.data ?? []).map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.nome}
                              {a.equipeNome ? ` · ${a.equipeNome}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

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
                        disabled={atualizar.isPending}
                        onValueChange={(v) => alterarStatus(atual, v as TicketStatus)}
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
                  </>
                ) : (
                  <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted-foreground">
                    <Badge variant="outline" className="mb-2">
                      Perfil não TI
                    </Badge>
                    <p>
                      Somente a equipe de TI pode responder, atuar e encerrar chamados. Você pode
                      acompanhar o andamento por aqui.
                    </p>
                  </div>
                )}

                {/* Trilha de auditoria: vem de chamado_historico, uma linha por campo alterado. */}
                <div className="space-y-3 border-t border-border pt-5">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                    <History className="size-3.5" /> Histórico do chamado
                  </p>

                  {detalhe.isPending ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Carregando histórico...
                    </p>
                  ) : detalhe.error ? (
                    <p className="text-xs text-destructive">
                      Não foi possível carregar o histórico.
                    </p>
                  ) : (
                    <ol className="space-y-0">
                      {(detalhe.data?.historico ?? []).map((ev, i, arr) => (
                        <li key={ev.id} className="relative flex gap-3 pb-4">
                          {/* Linha vertical conectando os eventos, exceto no último. */}
                          {i < arr.length - 1 ? (
                            <span
                              className="absolute left-[5px] top-3 h-full w-px bg-border"
                              aria-hidden
                            />
                          ) : null}
                          <span className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-background" />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-sm">
                              {ev.campo === "criacao" ? (
                                <span className="font-medium">Chamado aberto</span>
                              ) : (
                                <>
                                  <span className="font-medium">
                                    {CAMPO_LABEL[ev.campo] ?? ev.campo}
                                  </span>
                                  {ev.valorAnterior ? (
                                    <>
                                      {" de "}
                                      <span className="text-muted-foreground line-through">
                                        {valorLegivel(ev.campo, ev.valorAnterior)}
                                      </span>
                                    </>
                                  ) : null}
                                  {" para "}
                                  <span className="text-foreground">
                                    {valorLegivel(ev.campo, ev.valorNovo)}
                                  </span>
                                </>
                              )}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {fmtDataHoraLonga(ev.criadoEm)}
                              {ev.autorNome ? ` · ${ev.autorNome}` : ""}
                            </p>
                          </div>
                        </li>
                      ))}

                      {(detalhe.data?.historico ?? []).length === 0 ? (
                        <li className="text-xs text-muted-foreground">
                          Nenhum evento registrado ainda.
                        </li>
                      ) : null}
                    </ol>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
