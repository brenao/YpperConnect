import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { AppShell } from "@/views/app-shell";
import { DateRangePicker } from "@/views/date-range-picker";
import { PriorityBadge } from "@/views/badges";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  type Priority,
  type RecordType,
  type TicketStatus,
} from "@/models/itsm-types";
import { diretoriaFn } from "@/services/indicadores.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/diretoria")({
  head: () => ({
    meta: [
      { title: "Visão diretoria · YpperConnect" },
      {
        name: "description",
        content:
          "Panorama executivo do portfólio de projetos e da operação de atendimento de TI, com indicadores de SLA e produtividade.",
      },
      { property: "og:title", content: "Visão diretoria · YpperConnect" },
      {
        property: "og:description",
        content: "Indicadores executivos de projetos, chamados e níveis de serviço.",
      },
    ],
  }),
  component: Diretoria,
});

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl font-semibold", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Barra horizontal simples: mais legível que gráfico para poucas linhas. */
function Barras({
  dados,
  rotulo,
}: {
  dados: { chave: string; total: number; atendidos: number }[];
  rotulo: (k: string) => string;
}) {
  const max = Math.max(1, ...dados.map((d) => d.total));
  if (dados.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados no período.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {dados.map((d) => (
        <li key={d.chave}>
          <div className="flex items-center justify-between text-sm">
            <span>{rotulo(d.chave)}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {d.total} criados · {d.atendidos} atendidos
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${(d.total / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Diretoria() {
  const [periodo, setPeriodo] = useState<DateRange | undefined>(undefined);

  // Normaliza para o dia inteiro: 'de' à meia-noite, 'ate' às 23:59:59.
  const filtro = useMemo(() => {
    const de = periodo?.from ? new Date(new Date(periodo.from).setHours(0, 0, 0, 0)) : undefined;
    const base = periodo?.to ?? periodo?.from;
    const ate = base ? new Date(new Date(base).setHours(23, 59, 59, 999)) : undefined;
    return { de, ate };
  }, [periodo]);

  const q = useQuery({
    queryKey: ["diretoria", filtro.de?.toISOString(), filtro.ate?.toISOString()],
    queryFn: () =>
      diretoriaFn({
        data: {
          ...(filtro.de ? { de: filtro.de } : {}),
          ...(filtro.ate ? { ate: filtro.ate } : {}),
        },
      }),
  });

  const d = q.data;

  return (
    <AppShell
      title="Visão diretoria"
      subtitle="Panorama executivo do portfólio de projetos e da operação de atendimento"
    >
      <div className="space-y-4">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <DateRangePicker value={periodo} onChange={setPeriodo} />
          <span className="text-xs text-muted-foreground">
            {filtro.de
              ? "Chamados abertos no período selecionado"
              : "Todo o histórico — selecione um período para recortar"}
          </span>
          {q.isFetching ? (
            <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os indicadores: {String(q.error)}
          </div>
        ) : null}

        {q.isPending || !d ? (
          <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Consultando o banco...
          </p>
        ) : (
          <Tabs defaultValue="chamados">
            <TabsList>
              <TabsTrigger value="chamados">Chamados</TabsTrigger>
              <TabsTrigger value="projetos">Projetos</TabsTrigger>
            </TabsList>

            {/* --------------------------------------------------- chamados */}
            <TabsContent value="chamados" className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label="Chamados criados"
                  value={d.chamados.criados}
                  hint={`${d.chamados.atendidos} atendidos`}
                />
                <Kpi
                  label="Backlog em aberto"
                  value={d.chamados.backlog}
                  hint={`${d.chamados.vencidos} fora do prazo`}
                  tone="text-warning"
                />
                <Kpi
                  label="Aderência ao SLA"
                  value={`${d.chamados.aderencia}%`}
                  hint="dos atendidos fecharam no prazo"
                  tone="text-success"
                />
                <Kpi
                  label="Tempo médio de solução"
                  value={`${d.chamados.tempoMedioSolucaoH}h`}
                  hint="horas de relógio, da abertura ao fechamento"
                />
              </div>

              <Panel
                title="Chamados criados × atendidos"
                description="Abertura e encerramento por dia. Linhas separando indicam backlog crescendo."
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={d.serie}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="criados"
                        name="Criados"
                        stroke="var(--chart-4)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="atendidos"
                        name="Atendidos"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Por prioridade" description="Conforme a matriz impacto × urgência.">
                  <div className="space-y-3">
                    {d.prioridade.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem dados no período.</p>
                    ) : (
                      d.prioridade.map((p) => (
                        <div
                          key={p.chave}
                          className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
                        >
                          <PriorityBadge value={p.chave as Priority} full />
                          <span className="font-mono text-sm">
                            {p.total}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {p.atendidos} atendidos
                            </span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>

                <Panel title="Por classificação" description="Criados e atendidos por tipo.">
                  <Barras dados={d.tipo} rotulo={(k) => TYPE_LABEL[k as RecordType] ?? k} />
                </Panel>

                <Panel title="Por status" description="Distribuição da fila no período.">
                  <Barras dados={d.status} rotulo={(k) => STATUS_LABEL[k as TicketStatus] ?? k} />
                </Panel>

                <Panel title="Por equipe" description="Carga distribuída entre os times.">
                  <Barras dados={d.equipe} rotulo={(k) => k} />
                </Panel>
              </div>

              <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span className="text-muted-foreground">
                  {d.chamados.comPrimeiroRetorno} de {d.chamados.criados} chamados receberam
                  primeiro retorno da TI.
                </span>
                <Link
                  to="/chamados"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Ver fila completa <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
            </TabsContent>

            {/* --------------------------------------------------- projetos */}
            <TabsContent value="projetos" className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Projetos cadastrados" value={d.projetos.total} />
                <Kpi label="Em execução" value={d.projetos.emExecucao} tone="text-primary" />
                <Kpi label="Atrasados" value={d.projetos.atrasados} tone="text-destructive" />
                <Kpi label="Concluídos" value={d.projetos.concluidos} tone="text-success" />
              </div>

              {d.projetos.total === 0 ? (
                <div className="panel p-5 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Nenhum projeto no banco.</p>
                  <p className="mt-1">
                    A tela de projetos ainda grava em armazenamento local e não foi migrada. Os
                    números aqui refletem o banco — por isso aparecem zerados.
                  </p>
                  <Link
                    to="/projetos"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Abrir projetos <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              ) : (
                <Panel title="Distribuição do portfólio" description="Projetos por situação.">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[
                          { situacao: "Planejamento", total: d.projetos.planejamento },
                          { situacao: "Execução", total: d.projetos.emExecucao },
                          { situacao: "Parados", total: d.projetos.parados },
                          { situacao: "Concluídos", total: d.projetos.concluidos },
                        ]}
                        layout="vertical"
                        margin={{ left: 24 }}
                      >
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="situacao"
                          width={110}
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
                          {[0, 1, 2, 3].map((i) => (
                            <Cell key={i} fill={`var(--chart-${i + 1})`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              )}

              {d.projetos.atrasados > 0 ? (
                <div className="panel border-destructive/40 p-4 text-sm">
                  <Badge variant="outline" className="border-destructive/40 text-destructive">
                    Atenção
                  </Badge>
                  <p className="mt-2">
                    {d.projetos.atrasados} projeto(s) em andamento com data de término já vencida.
                  </p>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
