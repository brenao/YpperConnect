import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { DateRange } from "react-day-picker";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/itsm/app-shell";
import { DateRangePicker } from "@/components/itsm/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHydrated } from "@/hooks/use-hydrated";
import { useItsm } from "@/lib/itsm-store";
import { PROJECT_STATUS_LABEL, type Priority, type ProjectStatus } from "@/lib/itsm-types";
import { HEALTH_DOT, isLate, parseDate, projectHealth } from "@/lib/project-utils";
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
    <div className="glass-panel rounded-2xl border border-border/60 p-5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className={cn("mt-2 text-3xl font-semibold", tone)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
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
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_260px_200px_200px]">
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Projetos cadastrados" value={filtrados.length} />
        <Kpi label="Em execução" value={emExecucao} tone="text-primary" />
        <Kpi label="Em atraso" value={atrasados} tone="text-destructive" hint="Prazo estourado ou >15% de desvio" />
        <Kpi label="Paralisados / cancelados" value={parados} tone="text-warning" />
        <Kpi label="Concluídos" value={concluidos} tone="text-success" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        {porPrioridade.map((p) => (
          <Kpi
            key={p.prioridade}
            label={`Chamados ${p.prioridade} abertos`}
            value={p.total}
            tone={
              p.prioridade === "P1"
                ? "text-destructive"
                : p.prioridade === "P2"
                  ? "text-warning"
                  : undefined
            }
          />
        ))}
      </div>

      <div className="glass-panel mt-6 rounded-2xl border border-border/60 p-5">
        <h3 className="font-semibold">Curva de entregas (baleia)</h3>
        <p className="text-sm text-muted-foreground">
          Acumulado de projetos entregues e previstos, mês a mês (3 meses passados e 6 futuros).
        </p>
        <div className="mt-4 h-80">
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
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl border border-border/60 p-5">
          <h3 className="font-semibold">Projetos por responsável</h3>
          <ul className="mt-3 space-y-2">
            {porResponsavel.map(([nome, total]) => (
              <li key={nome} className="flex items-center justify-between text-sm">
                <span>{nome}</span>
                <span className="font-mono text-muted-foreground">{total}</span>
              </li>
            ))}
            {!porResponsavel.length ? (
              <li className="text-sm text-muted-foreground">Sem projetos no filtro atual.</li>
            ) : null}
          </ul>
        </div>

        <div className="glass-panel rounded-2xl border border-border/60 p-5">
          <h3 className="font-semibold">Semáforo do portfólio</h3>
          <ul className="mt-3 space-y-2">
            {filtrados.map((p) => {
              const h = hydrated ? projectHealth(p) : null;
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link
                    to="/projetos/$projectId"
                    params={{ projectId: p.id }}
                    className="flex min-w-0 items-center gap-2 hover:text-primary"
                  >
                    {h ? <span className={cn("h-2 w-2 rounded-full", HEALTH_DOT[h.geral])} /> : null}
                    <span className="truncate">{p.nome}</span>
                  </Link>
                  <Badge variant="outline" className="shrink-0">
                    {PROJECT_STATUS_LABEL[p.status]}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
