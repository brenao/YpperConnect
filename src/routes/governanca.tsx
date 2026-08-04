import { createFileRoute } from "@tanstack/react-router";
import { AlertOctagon, ShieldCheck, Timer } from "lucide-react";
import { AppShell } from "@/components/itsm/app-shell";
import { PriorityBadge, TypeBadge } from "@/components/itsm/badges";
import {
  PRIORITY_MATRIX,
  PRIORITY_LABEL,
  SLA_MATRIX,
  TYPE_LABEL,
  formatSlaHoras,
  type Impact,
  type Priority,
  type RecordType,
  type Urgency,
} from "@/lib/itsm-types";

export const Route = createFileRoute("/governanca")({
  head: () => ({
    meta: [
      { title: "Governança ITIL · YpperConnect" },
      {
        name: "description",
        content:
          "Matriz de prioridade por impacto e urgência, definições de classificação, SLAs e fluxo de incidentes críticos.",
      },
      { property: "og:title", content: "Governança ITIL · YpperConnect" },
      {
        property: "og:description",
        content: "Matriz de prioridade, classificações padronizadas e fluxo de incidentes críticos.",
      },
    ],
  }),
  component: Governanca,
});

const impactos: { key: Impact; label: string }[] = [
  { key: "alto", label: "Alto · operação essencial" },
  { key: "medio", label: "Médio · área ou processo" },
  { key: "baixo", label: "Baixo · poucos usuários" },
];

const urgencias: { key: Urgency; label: string }[] = [
  { key: "alta", label: "Alta" },
  { key: "media", label: "Média" },
  { key: "baixa", label: "Baixa" },
];

const definicoes: Record<RecordType, string> = {
  incidente:
    "Falha, erro, degradação ou indisponibilidade que afete um serviço, sistema ou processo.",
  requisicao:
    "Solicitação operacional padronizada: acessos, instalação de softwares, configuração de equipamentos, redes ou estações.",
  melhoria: "Solicitação de evolução pontual em sistemas, processos ou serviços.",
  problema:
    "Causa conhecida ou em investigação de um ou mais incidentes, especialmente com recorrência ou impacto relevante. Criação exclusiva da equipe de TI.",
  tarefa:
    "Atividade interna necessária para a execução de um incidente, requisição, problema, demanda ou projeto.",
};

const prioridadeDescricao: Record<Priority, string> = {
  P1: "Indisponibilidade total ou impacto severo em operação essencial, sem alternativa de continuidade.",
  P2: "Impacto relevante em área, unidade, sistema ou processo, com operação parcial ou alternativa limitada.",
  P3: "Impacto restrito a poucos usuários ou atividade não crítica, sem comprometimento relevante da operação.",
  P4: "Solicitação planejável, dúvida, ajuste ou atividade sem impacto imediato na operação.",
};

const praticas = [
  {
    nome: "Gestão de Incidentes",
    descricao: "Restabelecer o serviço no menor tempo possível, com comunicação e SLA controlados.",
    itens: ["Triagem em canal único", "Matriz de prioridade", "Fluxo P1 com ponte de crise"],
  },
  {
    nome: "Requisições de Serviço",
    descricao: "Executar solicitações padronizadas com fluxo previsível e aprovações claras.",
    itens: ["Catálogo de serviços", "Aprovação do gestor", "SLA por tipo de serviço"],
  },
  {
    nome: "Gestão de Problemas",
    descricao: "Investigar causa raiz de recorrências e definir solução definitiva.",
    itens: ["Detecção de recorrência por IA", "Criação restrita à TI", "RCA documentado"],
  },
  {
    nome: "Melhoria Contínua",
    descricao: "Transformar indicadores e recorrências em evoluções planejadas.",
    itens: ["Backlog de melhorias", "Ritual mensal", "Indicadores de atendimento"],
  },
];

const fluxoP1 = [
  "Detecção e registro imediato como Incidente P1",
  "Acionamento da ponte de crise e do gestor de plantão",
  "Comunicação às áreas impactadas a cada 30 minutos",
  "Aplicação de contorno e restabelecimento do serviço",
  "Encerramento com validação do solicitante",
  "Abertura obrigatória de Problema e RCA em até 5 dias úteis",
];

function Governanca() {
  return (
    <AppShell
      title="Governança ITIL"
      subtitle="Classificações, matriz de prioridade, níveis de serviço, responsabilidades e fluxo de incidentes críticos"
    >
      <div className="space-y-6">
        <section className="panel p-5">
          <h2 className="text-sm font-semibold">Matriz de prioridade · impacto × urgência</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th className="w-56 text-left text-xs font-normal text-muted-foreground">
                    Impacto \ Urgência
                  </th>
                  {urgencias.map((u) => (
                    <th key={u.key} className="text-xs font-normal text-muted-foreground">
                      {u.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {impactos.map((i) => (
                  <tr key={i.key}>
                    <td className="rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground">
                      {i.label}
                    </td>
                    {urgencias.map((u) => (
                      <td
                        key={u.key}
                        className="rounded-lg border border-border bg-card px-3 py-3 text-center"
                      >
                        <PriorityBadge value={PRIORITY_MATRIX[i.key][u.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {(Object.keys(prioridadeDescricao) as Priority[]).map((p) => (
              <div key={p} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <PriorityBadge value={p} full />
                  <span className="font-mono text-xs text-muted-foreground">
                    incidente: {formatSlaHoras(SLA_MATRIX.incidente[p].resposta)} resposta ·{" "}
                    {formatSlaHoras(SLA_MATRIX.incidente[p].solucao)} solução
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{prioridadeDescricao[p]}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Timer className="size-4 text-primary" /> Acordo de nível de serviço (SLA) por
            classificação
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tempo de <strong>resposta</strong> = primeiro retorno da TI ao solicitante. Tempo de{" "}
            <strong>solução</strong> = restabelecimento ou entrega. Horas corridas contadas a partir
            do registro do chamado; P1 é atendido em regime 24×7.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">Classificação</th>
                  {slaPrioridades.map((p) => (
                    <th key={p} className="py-2 pr-4 font-normal">
                      {PRIORITY_LABEL[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slaTipos.map((t) => (
                  <tr key={t} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4">
                      <TypeBadge value={t} />
                    </td>
                    {slaPrioridades.map((p) => (
                      <td key={p} className="py-3 pr-4 font-mono text-xs">
                        <span className="text-foreground">
                          {formatSlaHoras(SLA_MATRIX[t][p].resposta)}
                        </span>
                        <span className="text-muted-foreground"> resp.</span>
                        <span className="mx-1 text-muted-foreground">/</span>
                        <span className="text-foreground">
                          {formatSlaHoras(SLA_MATRIX[t][p].solucao)}
                        </span>
                        <span className="text-muted-foreground"> sol.</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            {regrasSla.map((r) => (
              <li key={r} className="rounded-lg border border-border bg-surface p-3">
                {r}
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-5">
            <h2 className="text-sm font-semibold">Classificação dos registros</h2>
            <ul className="mt-4 space-y-3">
              {(Object.keys(definicoes) as RecordType[]).map((t) => (
                <li key={t} className="rounded-lg border border-border bg-surface p-3">
                  <TypeBadge value={t} />
                  <p className="mt-2 text-sm text-muted-foreground">{definicoes[t]}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
              Usuários finais não podem criar registros do tipo{" "}
              <strong>{TYPE_LABEL.problema}</strong>. A criação e a gestão são exclusivas da equipe
              de TI, após avaliação de recorrência, impacto e evidências.
            </p>
          </div>

          <div className="space-y-4">
            <div className="panel p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <AlertOctagon className="size-4 text-destructive" /> Fluxo de incidentes críticos
                (P1)
              </h2>
              <ol className="mt-4 space-y-2">
                {fluxoP1.map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-destructive/40 bg-destructive/10 font-mono text-xs text-destructive">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="panel p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" /> Práticas estruturadas
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {praticas.map((p) => (
                  <div key={p.nome} className="rounded-lg border border-border bg-surface p-3">
                    <p className="text-sm font-medium">{p.nome}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{p.descricao}</p>
                    <ul className="mt-2 space-y-1">
                      {p.itens.map((i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          · {i}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}