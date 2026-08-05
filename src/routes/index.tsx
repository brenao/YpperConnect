import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, Clock, Sparkles, TrendingUp, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useHydrated } from "@/hooks/use-hydrated";
import { AppShell } from "@/views/app-shell";
import { PriorityBadge, SlaPill, StatusBadge, TypeBadge } from "@/views/badges";
import { useItsm } from "@/controllers/itsm-store";
import { TYPE_LABEL, type Priority, type RecordType } from "@/models/itsm-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "YpperConnect · Central de governança e atendimento de TI" },
      {
        name: "description",
        content:
          "Painel de governança de TI com chamados ITIL, matriz de prioridade, catálogo de serviços, base de conhecimento e cronograma de projetos.",
      },
      { property: "og:title", content: "YpperConnect · Central de governança de TI" },
      {
        property: "og:description",
        content:
          "Visibilidade completa sobre incidentes, requisições, problemas, SLAs e projetos da área de TI.",
      },
    ],
  }),
  component: Dashboard,
});

const volumeSerie = [
  { dia: "Seg", incidentes: 12, requisicoes: 18 },
  { dia: "Ter", incidentes: 9, requisicoes: 22 },
  { dia: "Qua", incidentes: 16, requisicoes: 15 },
  { dia: "Qui", incidentes: 7, requisicoes: 25 },
  { dia: "Sex", incidentes: 11, requisicoes: 20 },
  { dia: "Sáb", incidentes: 3, requisicoes: 4 },
  { dia: "Dom", incidentes: 2, requisicoes: 2 },
];

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Clock;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon
          className={
            tone === "danger"
              ? "size-4 text-destructive"
              : tone === "success"
                ? "size-4 text-success"
                : "size-4 text-primary"
          }
        />
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Dashboard() {
  const { tickets, articles, projects } = useItsm();
  const hydrated = useHydrated();

  const abertos = tickets.filter((t) => t.status !== "resolvido" && t.status !== "fechado");
  const criticos = abertos.filter((t) => t.prioridade === "P1");
  const agora = hydrated ? Date.now() : 0;
  const vencidos = agora ? abertos.filter((t) => new Date(t.prazoSla).getTime() < agora) : [];
  const aderencia = Math.round(((abertos.length - vencidos.length) / (abertos.length || 1)) * 100);

  const porPrioridade = (["P1", "P2", "P3", "P4"] as Priority[]).map((p) => ({
    p,
    total: abertos.filter((t) => t.prioridade === p).length,
  }));

  const porTipo = (Object.keys(TYPE_LABEL) as RecordType[]).map((t) => ({
    tipo: TYPE_LABEL[t],
    total: tickets.filter((x) => x.tipo === t).length,
  }));

  const recorrencia = tickets.filter((t) => t.problemaVinculado);

  return (
    <AppShell
      title="Visão geral da operação de TI"
      subtitle="Backlog, níveis de serviço e sinais de recorrência em tempo real"
    >
      <div className="space-y-6">
        <section className="panel bg-hero overflow-hidden p-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                <Sparkles className="size-3.5" /> Governança assistida por IA
              </span>
              <h2 className="mt-4 text-2xl font-semibold">
                Um único canal para <span className="text-gradient">todo o atendimento de TI</span>
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Categorias, prioridades, responsabilidades e SLAs padronizados nas práticas de
                Incidentes, Requisições, Problemas e Melhoria Contínua.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {porPrioridade.map((row) => (
                <div key={row.p} className="rounded-lg border border-border/60 bg-card/60 p-3">
                  <PriorityBadge value={row.p} />
                  <p className="mt-2 font-mono text-2xl">{row.total}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Backlog aberto"
            value={String(abertos.length)}
            hint={`${tickets.length} registros no total`}
            icon={Users}
          />
          <Kpi
            label="Incidentes críticos"
            value={String(criticos.length)}
            hint="Fluxo P1 com ponte de crise"
            icon={AlertTriangle}
            tone="danger"
          />
          <Kpi
            label="Aderência ao SLA"
            value={`${aderencia}%`}
            hint={`${vencidos.length} chamados fora do prazo`}
            icon={TrendingUp}
            tone="success"
          />
          <Kpi
            label="Base de conhecimento"
            value={String(articles.length)}
            hint={`${articles.filter((a) => a.status === "revisar").length} artigos a revisar`}
            icon={Clock}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="panel p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold">Volume de atendimento na semana</h3>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={volumeSerie}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="incidentes"
                    stroke="var(--chart-4)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="requisicoes"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel p-5">
            <h3 className="text-sm font-semibold">Registros por classificação</h3>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porTipo} layout="vertical" margin={{ left: 24 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="tipo"
                    width={130}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="total" radius={6}>
                    {porTipo.map((_, i) => (
                      <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="panel overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-sm font-semibold">Fila prioritária</h3>
              <Link
                to="/chamados"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Ver todos os chamados <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {abertos.slice(0, 5).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.titulo}</span>
                  <TypeBadge value={t.tipo} />
                  <PriorityBadge value={t.prioridade} />
                  <StatusBadge value={t.status} />
                  <SlaPill ticket={t} />
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" /> Sinais detectados pela IA
            </h3>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                <p className="text-xs font-medium text-warning">Recorrência identificada</p>
                <p className="mt-1 text-sm">
                  {recorrencia.length} registros correlatos apontam para o mesmo comportamento de
                  rede. Recomenda-se avaliar o registro de Problema PRB-018.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs font-medium text-muted-foreground">Conhecimento</p>
                <p className="mt-1 text-sm">
                  {articles.filter((a) => a.status !== "publicado").length} artigos precisam de
                  revisão ou complemento.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs font-medium text-muted-foreground">Projetos</p>
                <p className="mt-1 text-sm">
                  {projects.filter((p) => p.status === "execucao").length} projeto(s) em execução na
                  estruturação das práticas ITIL.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
