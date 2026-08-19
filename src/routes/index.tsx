import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Clock,
  Loader2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
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
import { AppShell } from "@/views/app-shell";
import { PriorityBadge, StatusBadge, TypeBadge } from "@/views/badges";
import { TYPE_LABEL, type Priority, type RecordType, type TicketStatus } from "@/models/itsm-types";
import { painelFn } from "@/services/indicadores.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Beagle One · Central de governança e atendimento de TI" },
      {
        name: "description",
        content:
          "Painel de governança de TI com chamados ITIL, matriz de prioridade, catálogo de serviços, base de conhecimento e cronograma de projetos.",
      },
      { property: "og:title", content: "Beagle One · Central de governança de TI" },
      {
        property: "og:description",
        content:
          "Visibilidade completa sobre incidentes, requisições, problemas, SLAs e projetos da área de TI.",
      },
    ],
  }),
  component: Dashboard,
});

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

/** Situação do prazo sem depender do tipo Ticket legado. */
function PrazoPill({ prazo }: { prazo: Date | string }) {
  const ms = new Date(prazo).getTime() - Date.now();
  const horas = Math.round(ms / 3_600_000);
  const vencido = ms < 0;
  const critico = !vencido && horas <= 4;

  const texto = vencido
    ? `${Math.abs(horas)}h vencido`
    : horas >= 24
      ? `${Math.round(horas / 24)}d restantes`
      : `${horas}h restantes`;

  return (
    <span
      className={
        vencido
          ? "font-mono text-xs text-destructive"
          : critico
            ? "font-mono text-xs text-warning"
            : "font-mono text-xs text-muted-foreground"
      }
    >
      {texto}
    </span>
  );
}

function Dashboard() {
  const painel = useQuery({ queryKey: ["painel"], queryFn: () => painelFn() });

  const d = painel.data;
  const resumo = d?.resumo;

  if (painel.isPending) {
    return (
      <AppShell title="Visão geral da operação de TI" subtitle="Carregando indicadores...">
        <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Consultando o banco...
        </p>
      </AppShell>
    );
  }

  if (painel.error || !resumo) {
    return (
      <AppShell title="Visão geral da operação de TI" subtitle="Falha ao carregar">
        <div className="panel border-destructive/40 p-5 text-sm text-destructive">
          Não foi possível carregar os indicadores: {String(painel.error)}
        </div>
      </AppShell>
    );
  }

  const tipos = (d?.tipos ?? []).map((t) => ({
    tipo: TYPE_LABEL[t.tipo as RecordType] ?? t.tipo,
    total: t.total,
  }));

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
              {(d?.prioridades ?? []).map((row) => (
                <div
                  key={row.prioridade}
                  className="rounded-lg border border-border/60 bg-card/60 p-3"
                >
                  <PriorityBadge value={row.prioridade as Priority} />
                  <p className="mt-2 font-mono text-2xl">{row.total}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Backlog aberto"
            value={String(resumo.abertos)}
            hint={`${resumo.totalChamados} registros no total`}
            icon={Users}
          />
          <Kpi
            label="Incidentes críticos"
            value={String(resumo.criticos)}
            hint="Fluxo P1 com ponte de crise"
            icon={AlertTriangle}
            tone="danger"
          />
          <Kpi
            label="Aderência ao SLA"
            value={`${resumo.aderenciaSla}%`}
            hint={`${resumo.vencidos} chamado(s) fora do prazo`}
            icon={TrendingUp}
            tone="success"
          />
          <Kpi
            label="Base de conhecimento"
            value={String(resumo.artigos)}
            hint={`${resumo.artigosPendentes} artigo(s) a revisar`}
            icon={BookOpen}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="panel p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold">Volume de abertura nos últimos 7 dias</h3>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d?.volume ?? []}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} allowDecimals={false} />
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
                    name="Incidentes"
                    stroke="var(--chart-4)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="requisicoes"
                    name="Requisições"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="outros"
                    name="Outros"
                    stroke="var(--chart-3)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel p-5">
            <h3 className="text-sm font-semibold">Registros por classificação</h3>
            {tipos.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">Nenhum chamado registrado ainda.</p>
            ) : (
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tipos} layout="vertical" margin={{ left: 24 }}>
                    <XAxis type="number" hide allowDecimals={false} />
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
                      {tipos.map((_, i) => (
                        <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
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
              {(d?.fila ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="font-mono text-xs text-muted-foreground">{t.codigo}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.titulo}</span>
                  <TypeBadge value={t.tipo as RecordType} />
                  <PriorityBadge value={t.prioridade as Priority} />
                  <StatusBadge value={t.status as TicketStatus} />
                  <PrazoPill prazo={t.prazoSla} />
                </li>
              ))}
              {(d?.fila ?? []).length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Nenhum chamado aberto no momento.
                </li>
              ) : null}
            </ul>
          </div>

          <div className="panel p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" /> Sinais detectados
            </h3>
            <div className="mt-4 space-y-3">
              {(d?.recorrencias ?? []).length > 0 ? (
                (d?.recorrencias ?? []).map((r) => (
                  <div
                    key={r.sistemaNome}
                    className="rounded-lg border border-warning/30 bg-warning/10 p-3"
                  >
                    <p className="text-xs font-medium text-warning">Recorrência identificada</p>
                    <p className="mt-1 text-sm">
                      <strong>{r.sistemaNome}</strong> acumulou {r.total} incidentes abertos. Avalie
                      registrar um Problema para análise de causa raiz.
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <p className="text-xs font-medium text-muted-foreground">Recorrência</p>
                  <p className="mt-1 text-sm">
                    Nenhum sistema com três ou mais incidentes abertos.
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs font-medium text-muted-foreground">Conhecimento</p>
                <p className="mt-1 text-sm">
                  {resumo.artigosPendentes} artigo(s) precisam de revisão ou complemento.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs font-medium text-muted-foreground">Projetos</p>
                <p className="mt-1 text-sm">{resumo.projetosEmExecucao} projeto(s) em execução.</p>
              </div>

              {resumo.comProblemaVinculado > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <p className="text-xs font-medium text-muted-foreground">Correlação</p>
                  <p className="mt-1 text-sm">
                    {resumo.comProblemaVinculado} chamado(s) já vinculados a um Problema.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
