import type { Project, ProjectTask, Resource } from "./itsm-types";
import { DAY, parseDate, taskDurationDays } from "./project-utils";

/** Percentual da capacidade de projetos que a tarefa consome de cada responsável. */
export function taskAllocation(t: ProjectTask): number {
  const v = t.alocacaoPct ?? 100;
  return Math.max(5, Math.min(100, v));
}

export function taskResponsibles(t: ProjectTask): string[] {
  const list = t.responsaveis?.length ? t.responsaveis : [t.responsavel];
  return list.map((n) => n.trim()).filter(Boolean);
}

const norm = (s: string) => s.trim().toLowerCase();

export function findResource(resources: Resource[], nome: string): Resource | undefined {
  return resources.find((r) => norm(r.nome) === norm(nome));
}

/** Horas por dia realmente disponíveis para projetos. */
export function capacityHours(r: Resource): number {
  return (r.horasDia * r.disponibilidadeProjetos) / 100;
}

const ACTIVE_PROJECT = (p: Project) => p.status !== "cancelado" && p.status !== "concluido";

function taskActive(t: ProjectTask, at: number): boolean {
  if (t.progresso >= 100) return false;
  return parseDate(t.inicio) - DAY <= at && parseDate(t.fim) + DAY >= at;
}

export interface Assignment {
  projectId: string;
  projectNome: string;
  taskId: string;
  taskNome: string;
  alocacaoPct: number;
  inicio: string;
  fim: string;
}

/** Tarefas ativas de um recurso em `at`, em todos os projetos do portfólio. */
export function assignmentsAt(
  nome: string,
  projects: Project[],
  at: number = Date.now(),
): Assignment[] {
  const out: Assignment[] = [];
  for (const p of projects.filter(ACTIVE_PROJECT)) {
    for (const t of p.tarefas) {
      if (!taskActive(t, at)) continue;
      if (!taskResponsibles(t).some((r) => norm(r) === norm(nome))) continue;
      out.push({
        projectId: p.id,
        projectNome: p.nome,
        taskId: t.id,
        taskNome: t.nome,
        alocacaoPct: taskAllocation(t),
        inicio: t.inicio,
        fim: t.fim,
      });
    }
  }
  return out;
}

/** Demanda total (%) sobre a capacidade de projetos do recurso em `at`. */
export function demandAt(nome: string, projects: Project[], at: number = Date.now()): number {
  return assignmentsAt(nome, projects, at).reduce((acc, a) => acc + a.alocacaoPct, 0);
}

export interface ResourceLoad {
  recurso: Resource;
  capacidadeHoras: number;
  demandaPct: number;
  horasComprometidas: number;
  conflito: boolean;
  projetos: string[];
  atribuicoes: Assignment[];
}

export function resourceLoad(
  resource: Resource,
  projects: Project[],
  at: number = Date.now(),
): ResourceLoad {
  const atribuicoes = assignmentsAt(resource.nome, projects, at);
  const demandaPct = atribuicoes.reduce((acc, a) => acc + a.alocacaoPct, 0);
  const capacidadeHoras = capacityHours(resource);
  return {
    recurso: resource,
    capacidadeHoras,
    demandaPct,
    horasComprometidas: (capacidadeHoras * demandaPct) / 100,
    conflito: demandaPct > 100,
    projetos: Array.from(new Set(atribuicoes.map((a) => a.projectNome))),
    atribuicoes,
  };
}

export function portfolioLoad(
  resources: Resource[],
  projects: Project[],
  at: number = Date.now(),
): ResourceLoad[] {
  return resources
    .map((r) => resourceLoad(r, projects, at))
    .sort((a, b) => b.demandaPct - a.demandaPct);
}

/**
 * Fator de produtividade da tarefa: combina a disponibilidade diária do recurso
 * para projetos, o percentual alocado na tarefa e a concorrência com outros
 * projetos. 1 = uma jornada integral por dia; 0,25 = um quarto do ritmo.
 */
export function taskFactor(
  task: ProjectTask,
  resources: Resource[],
  projects: Project[],
): number {
  const nomes = taskResponsibles(task);
  if (!nomes.length) return 1;
  const meio = (parseDate(task.inicio) + parseDate(task.fim)) / 2;
  const aloc = taskAllocation(task) / 100;
  const fatores = nomes.map((nome) => {
    const r = findResource(resources, nome);
    const disp = r ? r.disponibilidadeProjetos / 100 : 1;
    const demanda = demandAt(nome, projects, meio);
    // Sobrealocação dilui proporcionalmente o ritmo de cada tarefa.
    const concorrencia = demanda > 100 ? 100 / demanda : 1;
    return disp * aloc * concorrencia;
  });
  const media = fatores.reduce((a, b) => a + b, 0) / fatores.length;
  return Math.max(media, 0.05);
}

/** Duração real da tarefa em dias corridos, já descontada a disponibilidade. */
export function effectiveDurationDays(
  task: ProjectTask,
  resources: Resource[],
  projects: Project[],
): number {
  return taskDurationDays(task) / taskFactor(task, resources, projects);
}

/** Gera a função de duração usada pelo CPM considerando recursos. */
export function durationWithResources(resources: Resource[], projects: Project[]) {
  return (t: ProjectTask) => effectiveDurationDays(t, resources, projects);
}
