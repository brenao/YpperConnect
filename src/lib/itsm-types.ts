export type RecordType = "incidente" | "requisicao" | "melhoria" | "problema" | "tarefa";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type Impact = "alto" | "medio" | "baixo";
export type Urgency = "alta" | "media" | "baixa";
export type TicketStatus =
  | "novo"
  | "triagem"
  | "em_andamento"
  | "aguardando"
  | "resolvido"
  | "fechado";

export interface Ticket {
  id: string;
  titulo: string;
  descricao: string;
  tipo: RecordType;
  categoria: string;
  servico: string;
  /** Nome do sistema afetado — obrigatório para incidente, melhoria e tarefa. */
  sistema?: string | undefined;
  impacto: Impact;
  urgencia: Urgency;
  prioridade: Priority;
  status: TicketStatus;
  solicitante: string;
  responsavel: string;
  equipe: string;
  criadoEm: string;
  prazoSla: string;
  problemaVinculado?: string;
  origem: "portal" | "ia" | "email" | "telefone";
}

export interface ServiceItem {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
  tipoPadrao: RecordType;
  slaHoras: number;
  equipe: string;
  geradoPorIA?: boolean;
}

export interface Article {
  id: string;
  titulo: string;
  categoria: string;
  resumo: string;
  conteudo: string;
  atualizadoEm: string;
  visualizacoes: number;
  status: "publicado" | "revisar" | "rascunho";
  geradoPorIA?: boolean;
}

export interface ProjectTask {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
  progresso: number;
  responsavel: string;
  marco?: boolean;
}

export interface Project {
  id: string;
  nome: string;
  objetivo: string;
  sponsor: string;
  gerente: string;
  status: "planejamento" | "execucao" | "risco" | "concluido";
  inicio: string;
  fim: string;
  tarefas: ProjectTask[];
}

export const PRIORITY_MATRIX: Record<Impact, Record<Urgency, Priority>> = {
  alto: { alta: "P1", media: "P2", baixa: "P3" },
  medio: { alta: "P2", media: "P3", baixa: "P3" },
  baixo: { alta: "P3", media: "P3", baixa: "P4" },
};

export const SLA_HORAS: Record<Priority, { resposta: number; solucao: number }> = {
  P1: { resposta: 0.25, solucao: 4 },
  P2: { resposta: 1, solucao: 8 },
  P3: { resposta: 4, solucao: 24 },
  P4: { resposta: 8, solucao: 72 },
};

export const TYPE_LABEL: Record<RecordType, string> = {
  incidente: "Incidente",
  requisicao: "Requisição de serviço",
  melhoria: "Demanda de melhoria",
  problema: "Problema",
  tarefa: "Tarefa",
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  novo: "Novo",
  triagem: "Em triagem",
  em_andamento: "Em andamento",
  aguardando: "Aguardando terceiros",
  resolvido: "Resolvido",
  fechado: "Fechado",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: "P1 · Crítica",
  P2: "P2 · Alta",
  P3: "P3 · Média",
  P4: "P4 · Baixa",
};

export function resolvePriority(impacto: Impact, urgencia: Urgency): Priority {
  return PRIORITY_MATRIX[impacto][urgencia];
}

/** Classificações que exigem o nome do sistema. */
export const TYPES_REQUIRING_SYSTEM: RecordType[] = ["incidente", "melhoria", "tarefa"];

export function requiresSystem(tipo: RecordType): boolean {
  return TYPES_REQUIRING_SYSTEM.includes(tipo);
}