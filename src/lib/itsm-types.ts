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
  /** Prazo máximo para o primeiro retorno da TI ao solicitante. */
  prazoResposta?: string | undefined;
  /** Momento do primeiro atendimento (saída de Novo/Triagem ou atribuição). */
  respondidoEm?: string | undefined;
  problemaVinculado?: string;
  /** Obrigatória ao resolver/fechar o chamado. */
  descricaoEncerramento?: string | undefined;
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

/** Colunas do quadro kanban de tarefas de projeto. */
export type KanbanStatus = "backlog" | "todo" | "doing" | "done";

export const KANBAN_LABEL: Record<KanbanStatus, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluído",
};

export interface ProjectTask {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
  progresso: number;
  responsavel: string;
  marco?: boolean;
  /** Coluna no quadro kanban do projeto. */
  quadro?: KanbanStatus | undefined;
  /** Data em que o card foi movido para "Concluído". */
  concluidoEm?: string | undefined;
  /** Responsáveis adicionais (1 ou vários). */
  responsaveis?: string[] | undefined;
  /** IDs de tarefas predecessoras dentro do mesmo projeto. */
  predecessoras?: string[] | undefined;
  /** ID da tarefa pai (tarefas filhas / WBS). */
  paiId?: string | undefined;
  duracao?: number | undefined;
  duracaoUnidade?: "dias" | "horas" | undefined;
  atividade?: string | undefined;
  /**
   * Percentual da capacidade de projetos do(s) responsável(is) dedicada a esta
   * tarefa (100 = dedicação integral da parcela disponível para projetos).
   */
  alocacaoPct?: number | undefined;
}

/** Recurso (pessoa) disponível para atuar em projetos. */
export interface Resource {
  id: string;
  nome: string;
  papel: string;
  equipe: string;
  /** Jornada diária em horas. */
  horasDia: number;
  /** Percentual do dia disponível para projetos (o restante é operação/chamados). */
  disponibilidadeProjetos: number;
}

export type ProjectStatus =
  | "planejamento"
  | "execucao"
  | "paralisado"
  | "cancelado"
  | "concluido";

export interface ProjectUpdate {
  id: string;
  data: string;
  autor: string;
  descricao: string;
  ultimasEntregas: string;
  proximasEntregas: string;
}

export interface ProjectRisk {
  id: string;
  descricao: string;
  probabilidade: "alta" | "media" | "baixa";
  impacto: "alto" | "medio" | "baixo";
  mitigacao: string;
  status: "aberto" | "monitorado" | "mitigado";
}

export interface ProjectAttention {
  id: string;
  titulo: string;
  descricao: string;
  decisaoNecessaria: string;
  responsavelDecisao: string;
  criadoEm: string;
  status: "aberto" | "resolvido";
}

export interface Project {
  id: string;
  nome: string;
  objetivo: string;
  sponsor: string;
  gerente: string;
  status: ProjectStatus;
  inicio: string;
  fim: string;
  tarefas: ProjectTask[];
  atualizacoes?: ProjectUpdate[] | undefined;
  riscos?: ProjectRisk[] | undefined;
  atencoes?: ProjectAttention[] | undefined;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planejamento: "Planejamento",
  execucao: "Em execução",
  paralisado: "Paralisado",
  cancelado: "Cancelado",
  concluido: "Concluído",
};

export type UserRole = "ti" | "nao_ti";

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

export interface SlaTarget {
  /** Horas para o primeiro retorno ao solicitante. */
  resposta: number;
  /** Horas para solução / entrega. */
  solucao: number;
}

/**
 * Acordo de nível de serviço por classificação e prioridade (horas corridas).
 * Incidentes têm o relógio mais agressivo; problemas seguem prazos de
 * investigação de causa raiz; tarefas e melhorias seguem prazos planejáveis.
 */
export const SLA_MATRIX: Record<RecordType, Record<Priority, SlaTarget>> = {
  incidente: {
    P1: { resposta: 0.25, solucao: 4 },
    P2: { resposta: 1, solucao: 8 },
    P3: { resposta: 4, solucao: 24 },
    P4: { resposta: 8, solucao: 72 },
  },
  requisicao: {
    P1: { resposta: 1, solucao: 8 },
    P2: { resposta: 4, solucao: 24 },
    P3: { resposta: 8, solucao: 72 },
    P4: { resposta: 16, solucao: 120 },
  },
  tarefa: {
    P1: { resposta: 1, solucao: 12 },
    P2: { resposta: 4, solucao: 40 },
    P3: { resposta: 8, solucao: 80 },
    P4: { resposta: 24, solucao: 160 },
  },
  problema: {
    P1: { resposta: 2, solucao: 120 },
    P2: { resposta: 8, solucao: 240 },
    P3: { resposta: 24, solucao: 480 },
    P4: { resposta: 40, solucao: 720 },
  },
  melhoria: {
    P1: { resposta: 8, solucao: 120 },
    P2: { resposta: 16, solucao: 240 },
    P3: { resposta: 40, solucao: 480 },
    P4: { resposta: 80, solucao: 720 },
  },
};

/** Meta de SLA aplicável a uma classificação + prioridade. */
export function slaFor(tipo: RecordType, prioridade: Priority): SlaTarget {
  return SLA_MATRIX[tipo][prioridade];
}

/** Formata horas em h / d para exibição. */
export function formatSlaHoras(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)}min`;
  if (horas < 24) return `${horas}h`;
  const dias = horas / 24;
  return `${Number.isInteger(dias) ? dias : dias.toFixed(1)}d`;
}

export type SlaState = "atendido" | "no_prazo" | "em_risco" | "estourado";

export interface SlaEvaluation {
  estado: SlaState;
  /** Percentual do prazo já consumido (0-100+). */
  consumo: number;
  /** Horas restantes (negativo quando vencido). */
  restanteHoras: number;
  meta: SlaTarget;
  respostaAtrasada: boolean;
}

/** Avalia o SLA de solução de um chamado em relação a `agora`. */
export function evaluateSla(ticket: Ticket, agora: number = Date.now()): SlaEvaluation {
  const meta = slaFor(ticket.tipo, ticket.prioridade);
  const inicio = new Date(ticket.criadoEm).getTime();
  const prazo = new Date(ticket.prazoSla).getTime();
  const encerrado = ticket.status === "resolvido" || ticket.status === "fechado";
  const referencia = encerrado ? Math.min(agora, prazo) : agora;
  const total = Math.max(prazo - inicio, 1);
  const consumo = ((referencia - inicio) / total) * 100;
  const restanteHoras = (prazo - agora) / 3600_000;
  const respostaAtrasada = Boolean(
    ticket.prazoResposta &&
      !ticket.respondidoEm &&
      new Date(ticket.prazoResposta).getTime() < agora,
  );
  const estado: SlaState = encerrado
    ? "atendido"
    : restanteHoras < 0
      ? "estourado"
      : consumo >= 75 || respostaAtrasada
        ? "em_risco"
        : "no_prazo";
  return { estado, consumo, restanteHoras, meta, respostaAtrasada };
}

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