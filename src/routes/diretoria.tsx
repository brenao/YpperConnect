import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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
  PROJECT_STATUS_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  type Priority,
  type ProjectStatus,
  type RecordType,
  type TicketStatus,
} from "@/models/itsm-types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { diretoriaFn, portfolioFn } from "@/services/indicadores.functions";
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

/** Radix não aceita SelectItem com value vazio. */
const TODOS = "__todos__";

function Diretoria() {
  const [periodo, setPeriodo] = useState<DateRange | undefined>(undefined);
  const [filtroGerente, setFiltroGerente] = useState(TODOS);
  const [filtroStatus, setFiltroStatus] = useState(TODOS);
  const [filtroNome, setFiltroNome] = useState("");

  // Normaliza para o dia inteiro: 'de' à meia-noite, 'ate' às 23:59:59.
  const filtro = useMemo(() => {
    const de = periodo?.from ? new Date(new Date(periodo.from).setHours(0, 0, 0, 0)) : undefined;
    const base = periodo?.to ?? periodo?.from;
    const ate = base ? new Date(new Date(base).setHours(23, 59, 59, 999)) : undefined;
    return { de, ate };
  }, [periodo]);

  const portfolio = useQuery({
    queryKey: ["portfolio", filtroGerente, filtroStatus, filtroNome],
    queryFn: () =>
      portfolioFn({
        data: {
          ...(filtroGerente !== TODOS ? { gerenteId: filtroGerente } : {}),
          ...(filtroStatus !== TODOS ? { status: filtroStatus as ProjectStatus } : {}),
          ...(filtroNome.trim() ? { nome: filtroNome.trim() } : {}),
        },
      }),
  });

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

  // Rótulo do mês corrente, para a linha divisória entre realizado e
  // previsto. Vem da própria série: assim não há risco de o formato
  // divergir do que o banco devolveu.
  const mesAtual = d?.carteira.find((m) => m.atual)?.rotulo;

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
              <TabsTrigger value="portfolio">Portfólio</TabsTrigger>
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
                  <p className="font-medium text-foreground">Nenhum projeto cadastrado.</p>
                  <p className="mt-1">
                    Os indicadores desta aba se alimentam do portfólio. Cadastre o primeiro projeto
                    para que a carteira e a carga por gerente façam sentido.
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

              <Panel
                title="Carteira de entregas"
                description="Concluídos nos últimos meses e previstos para os próximos, pela data de término do projeto. Barras vermelhas marcam cancelamentos."
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={d.carteira} margin={{ left: -20, right: 8 }}>
                      <defs>
                        <linearGradient id="grad-entregue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--success)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--success)" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="grad-previsto" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                        vertical={false}
                      />
                      <XAxis dataKey="rotulo" stroke="var(--muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {/* Divisa entre o que aconteceu e o que é promessa. */}
                      {mesAtual ? (
                        <ReferenceLine
                          x={mesAtual}
                          stroke="var(--muted-foreground)"
                          strokeDasharray="4 4"
                          label={{ value: "hoje", position: "top", fontSize: 10 }}
                        />
                      ) : null}
                      <Area
                        type="monotone"
                        dataKey="entregues"
                        name="Entregues"
                        stroke="var(--success)"
                        strokeWidth={2}
                        fill="url(#grad-entregue)"
                      />
                      <Area
                        type="monotone"
                        dataKey="previstos"
                        name="Previstos"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        fill="url(#grad-previsto)"
                      />
                      <Bar
                        dataKey="cancelados"
                        name="Cancelados"
                        fill="var(--destructive)"
                        barSize={14}
                        radius={3}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel
                title="Carga por gerente"
                description="Quantos projetos cada um carrega e em que estado. Sem gerente aparece como linha própria."
              >
                {d.gerentes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum projeto cadastrado.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Gerente</th>
                          <th className="w-20 py-2 font-medium">Total</th>
                          <th className="w-24 py-2 font-medium">Execução</th>
                          <th className="w-24 py-2 font-medium">Atrasados</th>
                          <th className="w-32 py-2 font-medium">Sem acompanhar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.gerentes.map((g) => (
                          <tr key={g.gerenteId ?? "sem"} className="border-b border-border/60">
                            <td className="py-2 pr-3">{g.gerenteNome}</td>
                            <td className="py-2 font-mono">{g.total}</td>
                            <td className="py-2 font-mono text-primary">{g.emExecucao}</td>
                            <td
                              className={cn(
                                "py-2 font-mono",
                                g.atrasados > 0 ? "text-destructive" : "text-muted-foreground",
                              )}
                            >
                              {g.atrasados}
                            </td>
                            <td
                              className={cn(
                                "py-2 font-mono",
                                g.semAcompanhamento > 0 ? "text-warning" : "text-muted-foreground",
                              )}
                            >
                              {g.semAcompanhamento}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

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

            {/* ------------------------------------------------ portfólio */}
            <TabsContent value="portfolio" className="mt-4 space-y-4">
              <div className="panel flex flex-wrap items-end gap-3 p-4">
                <div className="min-w-56 flex-1 space-y-1.5">
                  <label className="text-xs text-muted-foreground" htmlFor="f-nome">
                    Nome do projeto
                  </label>
                  <Input
                    id="f-nome"
                    value={filtroNome}
                    onChange={(e) => setFiltroNome(e.target.value)}
                    placeholder="Buscar por parte do nome"
                  />
                </div>
                <div className="w-56 space-y-1.5">
                  <span className="block text-xs text-muted-foreground">Gerente</span>
                  <Select value={filtroGerente} onValueChange={setFiltroGerente}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {/* A lista sai da carga por gerente: só aparece quem
                          de fato tem projeto. */}
                      {d.gerentes
                        .filter((g) => g.gerenteId !== null)
                        .map((g) => (
                          <SelectItem key={g.gerenteId} value={g.gerenteId as string}>
                            {g.gerenteNome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48 space-y-1.5">
                  <span className="block text-xs text-muted-foreground">Situação</span>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todas</SelectItem>
                      {(
                        [
                          "planejamento",
                          "execucao",
                          "paralisado",
                          "cancelado",
                          "concluido",
                        ] as ProjectStatus[]
                      ).map((st) => (
                        <SelectItem key={st} value={st}>
                          {PROJECT_STATUS_LABEL[st]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {portfolio.isPending ? (
                <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando portfólio...
                </p>
              ) : (portfolio.data ?? []).length === 0 ? (
                <div className="panel p-6 text-center text-sm text-muted-foreground">
                  Nenhum projeto com esses filtros.
                </div>
              ) : (
                <div className="panel overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Projeto</th>
                        <th className="w-32 px-4 py-2 font-medium">Situação</th>
                        <th className="w-28 px-4 py-2 font-medium">Término</th>
                        <th className="w-32 px-4 py-2 font-medium">Progresso</th>
                        <th className="w-36 px-4 py-2 font-medium">Acompanhamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(portfolio.data ?? []).map((p) => (
                        <tr key={p.id} className="border-b border-border/60">
                          <td className="px-4 py-2">
                            <Link
                              to="/projetos/$projectId"
                              params={{ projectId: p.id }}
                              className="hover:underline"
                            >
                              {p.nome}
                            </Link>
                            <span className="block text-[11px] text-muted-foreground">
                              {p.gerenteNome ?? "Sem gerente"}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-[10px]">
                              {PROJECT_STATUS_LABEL[p.status as ProjectStatus]}
                            </Badge>
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2 font-mono text-xs",
                              p.atrasado ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {new Date(p.fim).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs">{p.progresso}%</span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                                <span
                                  className="block h-full rounded-full bg-primary/70"
                                  style={{ width: `${p.progresso}%` }}
                                />
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {p.diasSemAtualizar === null ? (
                              <span className="text-destructive">nunca atualizado</span>
                            ) : p.diasSemAtualizar > 14 ? (
                              <span className="text-destructive">{p.diasSemAtualizar} dias</span>
                            ) : p.diasSemAtualizar > 7 ? (
                              <span className="text-warning">{p.diasSemAtualizar} dias</span>
                            ) : (
                              <span className="text-muted-foreground">
                                {p.diasSemAtualizar} dias
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
