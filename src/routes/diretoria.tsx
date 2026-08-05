import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { DateRange } from "react-day-picker";
import {
  CartesianGrid,
  Bar,
  BarChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/views/app-shell";
import { DateRangePicker } from "@/views/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHydrated } from "@/hooks/use-hydrated";
import { useItsm } from "@/controllers/itsm-store";
import {
  PROJECT_STATUS_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  evaluateSla,
  type Priority,
  type ProjectStatus,
  type RecordType,
  type TicketStatus,
} from "@/models/itsm-types";
import { HEALTH_DOT, isLate, parseDate, projectHealth } from "@/services/project-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/diretoria")({
  head: () => ({
    meta: [
      { title: "Visão diretoria · YpperConnect" },
      {
        name: "description",
        content:
          "Painel executivo de TI: portfólio de projetos, entregas por mês, atrasos, paralisados e volume de chamados por prioridade.",
      },
      { property: "og:title", content: "Visão diretoria · YpperConnect" },
      {
        property: "og:description",
        content: "Painel executivo com portfólio, entregas previstas e chamados por prioridade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Diretoria,
});

const MES = (d: Date) =>
  d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="glass-panel rounded-xl border border-border/50 p-4">
      <span className="line-clamp-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass-panel rounded-2xl border border-border/60 p-5", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Diretoria() {
  const { projects, tickets } = useItsm();
  const hydrated = useHydrated();
  const [busca, setBusca] = useState("");
  const [gp, setGp] = useState("todos");
  const [status, setStatus] = useState<"todos" | ProjectStatus>("todos");
  const [periodo, setPeriodo] = useState<DateRange | undefined>(undefined);

  const inicioMs = periodo?.from ? new Date(periodo.from).setHours(0, 0, 0, 0) : null;
  const fimMs = periodo?.to
    ? new Date(periodo.to).setHours(23, 59, 59, 999)
    : periodo?.from
      ? new Date(periodo.from).setHours(23, 59, 59, 999)
      : null;

  const gerentes = useMemo(
    () => Array.from(new Set(projects.map((p) => p.gerente))).sort(),
    [projects],
  );

  const filtrados = useMemo(
    () =>
      projects.filter(
        (p) =>
          (gp === "todos" || p.gerente === gp) &&
          (status === "todos" || p.status === status) &&
          p.nome.toLowerCase().includes(busca.trim().toLowerCase()) &&
          (inicioMs === null ||
            fimMs === null ||
            // projeto ativo em qualquer momento dentro do período informado
            (parseDate(p.inicio) <= fimMs && parseDate(p.fim) >= inicioMs)),
      ),
    [projects, gp, status, busca, inicioMs, fimMs],
  );

  const emExecucao = filtrados.filter((p) => p.status === "execucao").length;
  const atrasados = hydrated ? filtrados.filter((p) => isLate(p)).length : 0;
  const parados = filtrados.filter((p) => p.status === "paralisado" || p.status === "cancelado").length;
  const concluidos = filtrados.filter((p) => p.status === "concluido").length;

  const porPrioridade = useMemo(() => {
    const abertos = tickets.filter(
      (t) =>
        t.status !== "fechado" &&
        t.status !== "resolvido" &&
        (inicioMs === null ||
          fimMs === null ||
          (new Date(t.criadoEm).getTime() >= inicioMs &&
            new Date(t.criadoEm).getTime() <= fimMs)),
    );
    return (["P1", "P2", "P3", "P4"] as Priority[]).map((p) => ({
      prioridade: p,
      total: abertos.filter((t) => t.prioridade === p).length,
    }));
  }, [tickets, inicioMs, fimMs]);

  const porResponsavel = useMemo(() => {
    const map = new Map<string, number>();
    filtrados.forEach((p) => map.set(p.gerente, (map.get(p.gerente) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtrados]);

  // ---- Visão executiva de chamados (criados x atendidos no período) ----
  const noPeriodo = (iso: string | undefined) => {
    if (!iso) return false;
    if (inicioMs === null || fimMs === null) return true;
    const ms = new Date(iso).getTime();
    return ms >= inicioMs && ms <= fimMs;
  };

  const chamados = useMemo(() => {
    const encerrado = (s: TicketStatus) => s === "resolvido" || s === "fechado";
    const criados = tickets.filter((t) => noPeriodo(t.criadoEm));
    const atendidos = tickets.filter((t) => encerrado(t.status) && noPeriodo(t.criadoEm));
    const emAberto = tickets.filter((t) => !encerrado(t.status));
    const backlog = emAberto.filter((t) => noPeriodo(t.criadoEm));
    const primeiroRetorno = criados.filter((t) => Boolean(t.respondidoEm));
    const dentroSla = atendidos.filter((t) => evaluateSla(t).estado === "atendido").length;
    const emRisco = hydrated
      ? emAberto.filter((t) => {
          const e = evaluateSla(t).estado;
          return e === "em_risco" || e === "estourado";
        }).length
      : 0;
    const taxaAtendimento = criados.length
      ? Math.round((atendidos.length / criados.length) * 100)
      : 0;
    const aderenciaSla = atendidos.length
      ? Math.round((dentroSla / atendidos.length) * 100)
      : 0;

    const porTipo = (Object.keys(TYPE_LABEL) as RecordType[])
      .map((tipo) => ({
        tipo,
        label: TYPE_LABEL[tipo],
        criados: criados.filter((t) => t.tipo === tipo).length,
        atendidos: atendidos.filter((t) => t.tipo === tipo).length,
      }))
      .filter((r) => r.criados || r.atendidos);

    const porStatus = (Object.keys(STATUS_LABEL) as TicketStatus[])
      .map((s) => ({ status: s, total: criados.filter((t) => t.status === s).length }))
      .filter((r) => r.total > 0);

    const equipes = new Map<string, { criados: number; atendidos: number }>();
    criados.forEach((t) => {
      const atual = equipes.get(t.equipe) ?? { criados: 0, atendidos: 0 };
      atual.criados += 1;
      if (encerrado(t.status)) atual.atendidos += 1;
      equipes.set(t.equipe, atual);
    });
    const porEquipe = [...equipes.entries()].sort((a, b) => b[1].criados - a[1].criados);

    return {
      criados: criados.length,
      atendidos: atendidos.length,
      backlog: backlog.length,
      emRisco,
      taxaAtendimento,
      aderenciaSla,
      primeiroRetorno: criados.length
        ? Math.round((primeiroRetorno.length / criados.length) * 100)
        : 0,
      porTipo,
      porStatus,
      porEquipe,
    };
  }, [tickets, inicioMs, fimMs, hydrated]);

  /** Série mensal de chamados criados x atendidos dentro da janela analisada. */
  const serieChamados = useMemo(() => {
    const hoje = new Date();
    const primeiro =
      inicioMs !== null ? new Date(inicioMs) : new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
    const ultimo = fimMs !== null ? new Date(fimMs) : hoje;
    const total =
      (ultimo.getFullYear() - primeiro.getFullYear()) * 12 +
      (ultimo.getMonth() - primeiro.getMonth());
    const linhas: { mes: string; criados: number; atendidos: number }[] = [];
    for (let i = 0; i <= Math.max(total, 0); i++) {
      const ini = new Date(primeiro.getFullYear(), primeiro.getMonth() + i, 1).getTime();
      const fim = new Date(primeiro.getFullYear(), primeiro.getMonth() + i + 1, 1).getTime();
      const doMes = tickets.filter((t) => {
        const ms = new Date(t.criadoEm).getTime();
        return ms >= ini && ms < fim;
      });
      linhas.push({
        mes: MES(new Date(ini)),
        criados: doMes.length,
        atendidos: doMes.filter((t) => t.status === "resolvido" || t.status === "fechado").length,
      });
    }
    return linhas;
  }, [tickets, inicioMs, fimMs]);

  // Gráfico de baleia: 3 meses entregues + 6 meses previstos, com curva acumulada.
  const baleia = useMemo(() => {
    const meses: { mes: string; acumulado: number }[] = [];
    let acumulado = 0;
    const hoje = new Date();
    const primeiro =
      inicioMs !== null ? new Date(inicioMs) : new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
    const ultimo =
      fimMs !== null ? new Date(fimMs) : new Date(hoje.getFullYear(), hoje.getMonth() + 6, 1);
    const totalMeses =
      (ultimo.getFullYear() - primeiro.getFullYear()) * 12 +
      (ultimo.getMonth() - primeiro.getMonth());
    for (let i = 0; i <= Math.max(totalMeses, 0); i++) {
      const ini = new Date(primeiro.getFullYear(), primeiro.getMonth() + i, 1).getTime();
      const fim = new Date(primeiro.getFullYear(), primeiro.getMonth() + i + 1, 1).getTime();
      const doMes = filtrados.filter((p) => {
        const f = parseDate(p.fim);
        return f >= ini && f < fim && p.status !== "cancelado";
      });
      acumulado += doMes.length;
      meses.push({ mes: MES(new Date(ini)), acumulado });
    }
    return meses;
  }, [filtrados, inicioMs, fimMs]);

  return (
    <AppShell
      title="Visão diretoria"
      subtitle="Panorama executivo do portfólio de projetos e da operação de atendimento"
    >
      <Tabs defaultValue="projetos" className="w-full">
        <div className="glass-panel sticky top-2 z-20 rounded-2xl border border-border/60 p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <TabsList className="w-fit">
              <TabsTrigger value="projetos">Projetos</TabsTrigger>
              <TabsTrigger value="chamados">Chamados</TabsTrigger>
            </TabsList>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {periodo?.from ? "Período aplicado" : "Todo o histórico"}
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_260px_200px_200px]">
            <Input
              placeholder="Filtrar por nome do projeto..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <DateRangePicker
              value={periodo}
              onChange={setPeriodo}
              placeholder="Período (início → fim)"
            />
            <Select value={gp} onValueChange={setGp}>
              <SelectTrigger>
                <SelectValue placeholder="Responsável (GP)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os GPs</SelectItem>
                {gerentes.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ---------------- PROJETOS ---------------- */}
        <TabsContent value="projetos" className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Projetos cadastrados" value={filtrados.length} />
            <Kpi label="Em execução" value={emExecucao} tone="text-primary" />
            <Kpi
              label="Em atraso"
              value={atrasados}
              tone="text-destructive"
              hint="Prazo estourado ou >15% de desvio"
            />
            <Kpi label="Paralisados / cancelados" value={parados} tone="text-warning" />
            <Kpi label="Concluídos" value={concluidos} tone="text-success" />
          </div>

          <Panel
            title="Curva de entregas (baleia)"
            description="Acumulado de projetos entregues e previstos, mês a mês, dentro do período selecionado."
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={baleia}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="mes" stroke="currentColor" className="text-xs" />
                  <YAxis stroke="currentColor" className="text-xs" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="acumulado"
                    name="Acumulado de entregas"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Panel title="Projetos por responsável" description="Distribuição do portfólio por GP.">
              <ul className="space-y-2.5">
                {porResponsavel.map(([nome, total]) => {
                  const max = porResponsavel[0]?.[1] ?? 1;
                  return (
                    <li key={nome} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{nome}</span>
                        <span className="font-mono text-muted-foreground">{total}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((total / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
                {!porResponsavel.length ? (
                  <li className="text-sm text-muted-foreground">Sem projetos no filtro atual.</li>
                ) : null}
              </ul>
            </Panel>

            <Panel
              title="Semáforo do portfólio"
              description="Saúde de cada projeto conforme prazo e desvio."
            >
              <ul className="max-h-[420px] space-y-1 overflow-auto pr-1">
                {filtrados.map((p) => {
                  const h = hydrated ? projectHealth(p) : null;
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                      <Link
                        to="/projetos/$projectId"
                        params={{ projectId: p.id }}
                        className="flex min-w-0 items-center gap-2 hover:text-primary"
                      >
                        {h ? (
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[h.geral])} />
                        ) : null}
                        <span className="truncate">{p.nome}</span>
                      </Link>
                      <Badge variant="outline" className="shrink-0">
                        {PROJECT_STATUS_LABEL[p.status]}
                      </Badge>
                    </li>
                  );
                })}
                {!filtrados.length ? (
                  <li className="text-sm text-muted-foreground">Sem projetos no filtro atual.</li>
                ) : null}
              </ul>
            </Panel>
          </div>
        </TabsContent>

        {/* ---------------- CHAMADOS ---------------- */}
        <TabsContent value="chamados" className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Chamados criados" value={chamados.criados} />
            <Kpi
              label="Chamados atendidos"
              value={chamados.atendidos}
              tone="text-success"
              hint={`${chamados.taxaAtendimento}% do que foi criado`}
            />
            <Kpi label="Backlog em aberto" value={chamados.backlog} tone="text-warning" />
            <Kpi
              label="SLA em risco / estourado"
              value={chamados.emRisco}
              tone="text-destructive"
              hint="Abertos fora do prazo ou próximos"
            />
            <Kpi
              label="Aderência ao SLA"
              value={`${chamados.aderenciaSla}%`}
              tone="text-primary"
              hint={`Primeiro retorno em ${chamados.primeiroRetorno}%`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Panel
              title="Chamados criados x atendidos"
              description="Volume mensal de entrada e de encerramento no período selecionado."
            >
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serieChamados}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="mes" stroke="currentColor" className="text-xs" />
                    <YAxis stroke="currentColor" className="text-xs" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 12,
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="criados"
                      name="Criados"
                      fill="var(--color-primary)"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="atendidos"
                      name="Atendidos"
                      fill="var(--color-success)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Abertos por prioridade" description="Fila atual conforme a matriz P1–P4.">
              <ul className="space-y-2">
                {porPrioridade.map((p) => (
                  <li
                    key={p.prioridade}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <span
                      className={cn(
                        "text-sm font-medium",
                        p.prioridade === "P1"
                          ? "text-destructive"
                          : p.prioridade === "P2"
                            ? "text-warning"
                            : undefined,
                      )}
                    >
                      {p.prioridade}
                    </span>
                    <span className="font-mono text-lg tabular-nums">{p.total}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Por classificação" description="criados / atendidos">
              <ul className="space-y-2 text-sm">
                {chamados.porTipo.map((r) => (
                  <li key={r.tipo} className="flex items-center justify-between gap-3">
                    <span className="truncate">{r.label}</span>
                    <span className="font-mono text-muted-foreground">
                      {r.criados} / <span className="text-success">{r.atendidos}</span>
                    </span>
                  </li>
                ))}
                {!chamados.porTipo.length ? (
                  <li className="text-muted-foreground">Sem chamados no período.</li>
                ) : null}
              </ul>
            </Panel>

            <Panel title="Por status" description="Distribuição da fila no período">
              <ul className="space-y-2 text-sm">
                {chamados.porStatus.map((r) => (
                  <li key={r.status} className="flex items-center justify-between gap-3">
                    <span className="truncate">{STATUS_LABEL[r.status]}</span>
                    <span className="font-mono text-muted-foreground">{r.total}</span>
                  </li>
                ))}
                {!chamados.porStatus.length ? (
                  <li className="text-muted-foreground">Sem chamados no período.</li>
                ) : null}
              </ul>
            </Panel>

            <Panel title="Por equipe" description="criados / atendidos">
              <ul className="space-y-2 text-sm">
                {chamados.porEquipe.map(([equipe, r]) => (
                  <li key={equipe} className="flex items-center justify-between gap-3">
                    <span className="truncate">{equipe}</span>
                    <span className="font-mono text-muted-foreground">
                      {r.criados} / <span className="text-success">{r.atendidos}</span>
                    </span>
                  </li>
                ))}
                {!chamados.porEquipe.length ? (
                  <li className="text-muted-foreground">Sem chamados no período.</li>
                ) : null}
              </ul>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
