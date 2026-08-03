import type { Project, ProjectTask } from "./itsm-types";

export const DAY = 86_400_000;

export function parseDate(d: string): number {
  return new Date(`${d}T00:00:00`).getTime();
}

export function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function fmtDateFull(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
}

/** Duração em dias corridos (horas convertidas em jornada de 8h). */
export function taskDurationDays(t: ProjectTask): number {
  if (t.duracao && t.duracao > 0) {
    return t.duracaoUnidade === "horas" ? Math.max(t.duracao / 8, 0.125) : t.duracao;
  }
  return Math.max((parseDate(t.fim) - parseDate(t.inicio)) / DAY + 1, 1);
}

export function taskDurationLabel(t: ProjectTask): string {
  if (t.duracao && t.duracao > 0) {
    return `${t.duracao} ${t.duracaoUnidade === "horas" ? "h" : "d"}`;
  }
  return `${Math.round(taskDurationDays(t))} d`;
}

export interface TaskSchedule {
  id: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  folga: number;
  critica: boolean;
}

/**
 * Método do caminho crítico (CPM) sobre as tarefas do projeto.
 * Datas iniciais vêm do cronograma informado; predecessoras empurram o início.
 */
export function criticalPath(project: Project): Map<string, TaskSchedule> {
  const tasks = project.tarefas;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = (t: ProjectTask) => (t.predecessoras ?? []).filter((p) => byId.has(p));

  // Ordenação topológica (ignora ciclos residuais mantendo a ordem original).
  const ordered: ProjectTask[] = [];
  const visitado = new Set<string>();
  const visitando = new Set<string>();
  const visit = (t: ProjectTask) => {
    if (visitado.has(t.id) || visitando.has(t.id)) return;
    visitando.add(t.id);
    for (const p of preds(t)) {
      const pt = byId.get(p);
      if (pt) visit(pt);
    }
    visitando.delete(t.id);
    visitado.add(t.id);
    ordered.push(t);
  };
  tasks.forEach(visit);

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const t of ordered) {
    const base = parseDate(t.inicio);
    const porPredecessora = preds(t).map((p) => (ef.get(p) ?? base) + DAY);
    const inicio = Math.max(base, ...(porPredecessora.length ? porPredecessora : [base]));
    const dur = taskDurationDays(t) * DAY;
    es.set(t.id, inicio);
    ef.set(t.id, inicio + Math.max(dur - DAY, 0));
  }

  const fimProjeto = Math.max(...tasks.map((t) => ef.get(t.id) ?? parseDate(t.fim)), parseDate(project.inicio));
  const sucessores = new Map<string, string[]>();
  for (const t of tasks) {
    for (const p of preds(t)) {
      sucessores.set(p, [...(sucessores.get(p) ?? []), t.id]);
    }
  }

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const t of [...ordered].reverse()) {
    const suc = sucessores.get(t.id) ?? [];
    const limite = suc.length
      ? Math.min(...suc.map((s) => (ls.get(s) ?? fimProjeto) - DAY))
      : fimProjeto;
    const dur = taskDurationDays(t) * DAY;
    lf.set(t.id, limite);
    ls.set(t.id, limite - Math.max(dur - DAY, 0));
  }

  const result = new Map<string, TaskSchedule>();
  for (const t of tasks) {
    const folga = Math.round(((ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0)) / DAY);
    result.set(t.id, {
      id: t.id,
      es: es.get(t.id) ?? parseDate(t.inicio),
      ef: ef.get(t.id) ?? parseDate(t.fim),
      ls: ls.get(t.id) ?? parseDate(t.inicio),
      lf: lf.get(t.id) ?? parseDate(t.fim),
      folga,
      critica: folga <= 0,
    });
  }
  return result;
}

export function projectProgress(project: Project): number {
  const tarefas = project.tarefas;
  if (!tarefas.length) return 0;
  const pesoTotal = tarefas.reduce((acc, t) => acc + taskDurationDays(t), 0) || tarefas.length;
  const feito = tarefas.reduce((acc, t) => acc + taskDurationDays(t) * (t.progresso / 100), 0);
  return Math.round((feito / pesoTotal) * 100);
}

/** Progresso esperado hoje pela linha de base do projeto. */
export function expectedProgress(project: Project, now = Date.now()): number {
  const ini = parseDate(project.inicio);
  const fim = parseDate(project.fim);
  if (now <= ini) return 0;
  if (now >= fim) return 100;
  return Math.round(((now - ini) / (fim - ini)) * 100);
}

export type Health = "verde" | "amarelo" | "vermelho";

export interface ProjectHealth {
  prazo: Health;
  atrasoPct: number;
  atualizacao: Health;
  diasSemAtualizacao: number | null;
  risco: Health;
  geral: Health;
  alertas: string[];
}

const pior = (a: Health, b: Health): Health => {
  const ordem: Health[] = ["verde", "amarelo", "vermelho"];
  return ordem.indexOf(a) >= ordem.indexOf(b) ? a : b;
};

export function projectHealth(project: Project, now = Date.now()): ProjectHealth {
  const alertas: string[] = [];

  // Prazo: desvio entre progresso real e esperado.
  const real = projectProgress(project);
  const esperado = expectedProgress(project, now);
  const atrasoPct = Math.max(esperado - real, 0);
  let prazo: Health = "verde";
  if (project.status === "concluido") {
    prazo = "verde";
  } else if (atrasoPct > 15) {
    prazo = "vermelho";
    alertas.push(`Atraso de ${atrasoPct}% em relação ao planejado`);
  } else if (atrasoPct > 5) {
    prazo = "amarelo";
    alertas.push(`Risco de atraso (${atrasoPct}% abaixo do planejado)`);
  }

  // Atualização semanal obrigatória.
  const ultima = (project.atualizacoes ?? [])
    .map((a) => new Date(a.data).getTime())
    .sort((a, b) => b - a)[0];
  const diasSemAtualizacao = ultima ? Math.floor((now - ultima) / DAY) : null;
  let atualizacao: Health = "verde";
  if (diasSemAtualizacao === null) {
    atualizacao = "vermelho";
    alertas.push("Projeto nunca recebeu atualização de status");
  } else if (diasSemAtualizacao >= 14) {
    atualizacao = "vermelho";
    alertas.push(`${diasSemAtualizacao} dias sem atualização semanal`);
  } else if (diasSemAtualizacao >= 7) {
    atualizacao = "amarelo";
    alertas.push(`${diasSemAtualizacao} dias sem atualização semanal`);
  }

  // Risco cadastrado é obrigatório.
  const riscos = project.riscos ?? [];
  const risco: Health = riscos.length === 0 ? "amarelo" : "verde";
  if (!riscos.length) alertas.push("Nenhum risco cadastrado");

  const atencoesAbertas = (project.atencoes ?? []).filter((a) => a.status === "aberto");
  if (atencoesAbertas.length) {
    alertas.push(`${atencoesAbertas.length} ponto(s) de atenção aguardando decisão`);
  }

  let geral = pior(pior(prazo, atualizacao), risco);
  if (project.status === "paralisado" || project.status === "cancelado") geral = "vermelho";

  return { prazo, atrasoPct, atualizacao, diasSemAtualizacao, risco, geral, alertas };
}

export function isLate(project: Project, now = Date.now()): boolean {
  if (project.status === "concluido" || project.status === "cancelado") return false;
  return parseDate(project.fim) < now || projectHealth(project, now).prazo === "vermelho";
}

export const HEALTH_LABEL: Record<Health, string> = {
  verde: "Em dia",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

export const HEALTH_CLASS: Record<Health, string> = {
  verde: "bg-success/15 text-success border-success/40",
  amarelo: "bg-warning/15 text-warning border-warning/40",
  vermelho: "bg-destructive/15 text-destructive border-destructive/40",
};

export const HEALTH_DOT: Record<Health, string> = {
  verde: "bg-success",
  amarelo: "bg-warning",
  vermelho: "bg-destructive",
};
