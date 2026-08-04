import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SEED_ARTICLES, SEED_PROJECTS, SEED_SERVICES, SEED_TICKETS } from "./itsm-seed";
import type {
  Article,
  Project,
  ProjectAttention,
  ProjectRisk,
  ProjectTask,
  ProjectUpdate,
  ServiceItem,
  Ticket,
  UserRole,
} from "./itsm-types";
import { resolvePriority, slaFor } from "./itsm-types";

const KEY = "govti.state.v2";

interface State {
  tickets: Ticket[];
  services: ServiceItem[];
  articles: Article[];
  projects: Project[];
  role: UserRole;
}

const initial: State = {
  tickets: SEED_TICKETS,
  services: SEED_SERVICES,
  articles: SEED_ARTICLES,
  projects: SEED_PROJECTS,
  role: "ti",
};

type NewTicket = Pick<
  Ticket,
  | "titulo"
  | "descricao"
  | "tipo"
  | "categoria"
  | "servico"
  | "impacto"
  | "urgencia"
  | "solicitante"
  | "origem"
> & { sistema?: string | undefined };

interface Store extends State {
  createTicket: (t: NewTicket) => Ticket;
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  addArticle: (a: Omit<Article, "id" | "visualizacoes">) => void;
  addService: (s: Omit<ServiceItem, "id">) => void;
  setRole: (r: UserRole) => void;
  createProject: (p: Omit<Project, "id" | "tarefas" | "atualizacoes" | "riscos" | "atencoes">) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  addTask: (projectId: string, t: Omit<ProjectTask, "id">) => void;
  updateTask: (projectId: string, taskId: string, patch: Partial<ProjectTask>) => void;
  removeTask: (projectId: string, taskId: string) => void;
  addProjectUpdate: (projectId: string, u: Omit<ProjectUpdate, "id">) => void;
  addRisk: (projectId: string, r: Omit<ProjectRisk, "id">) => void;
  addAttention: (projectId: string, a: Omit<ProjectAttention, "id" | "criadoEm" | "status">) => void;
  resolveAttention: (projectId: string, attentionId: string) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

const PREFIX: Record<Ticket["tipo"], string> = {
  incidente: "INC",
  requisicao: "REQ",
  melhoria: "MEL",
  problema: "PRB",
  tarefa: "TSK",
};

export function ItsmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setState({ ...initial, ...(JSON.parse(raw) as State) });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const createTicket = useCallback((input: NewTicket) => {
    const prioridade = resolvePriority(input.impacto, input.urgencia);
    const criadoEm = new Date().toISOString();
    const meta = slaFor(input.tipo, prioridade);
    const base = new Date(criadoEm).getTime();
    const ticket: Ticket = {
      ...input,
      id: `${PREFIX[input.tipo]}-${Math.floor(1000 + Math.random() * 8999)}`,
      prioridade,
      status: "novo",
      responsavel: "Não atribuído",
      equipe: input.tipo === "incidente" ? "Service Desk" : "Service Desk",
      criadoEm,
      prazoSla: new Date(base + meta.solucao * 3600_000).toISOString(),
      prazoResposta: new Date(base + meta.resposta * 3600_000).toISOString(),
    };
    setState((s) => ({ ...s, tickets: [ticket, ...s.tickets] }));
    return ticket;
  }, []);

  const updateTicket = useCallback((id: string, patch: Partial<Ticket>) => {
    setState((s) => ({
      ...s,
      tickets: s.tickets.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        // Primeiro atendimento: registra o cumprimento do SLA de resposta.
        const atendeu =
          (patch.status && patch.status !== "novo" && patch.status !== "triagem") ||
          (patch.responsavel && patch.responsavel !== "Não atribuído");
        if (atendeu && !next.respondidoEm) next.respondidoEm = new Date().toISOString();
        return next;
      }),
    }));
  }, []);

  const addArticle = useCallback((a: Omit<Article, "id" | "visualizacoes">) => {
    setState((s) => ({
      ...s,
      articles: [
        { ...a, id: `KB-${Math.floor(100 + Math.random() * 899)}`, visualizacoes: 0 },
        ...s.articles,
      ],
    }));
  }, []);

  const setRole = useCallback((role: UserRole) => setState((s) => ({ ...s, role })), []);

  const addService = useCallback((item: Omit<ServiceItem, "id">) => {
    setState((s) => ({
      ...s,
      services: [
        ...s.services,
        { ...item, id: `SVC-${Math.floor(100 + Math.random() * 899)}` },
      ],
    }));
  }, []);

  const patchProject = useCallback((id: string, fn: (p: Project) => Project) => {
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === id ? fn(p) : p)),
    }));
  }, []);

  const createProject = useCallback<Store["createProject"]>((input) => {
    const project: Project = {
      ...input,
      id: `PRJ-${Math.floor(10 + Math.random() * 89)}`,
      tarefas: [],
      atualizacoes: [],
      riscos: [],
      atencoes: [],
    };
    setState((s) => ({ ...s, projects: [project, ...s.projects] }));
    return project;
  }, []);

  const updateProject = useCallback<Store["updateProject"]>(
    (id, patch) => patchProject(id, (p) => ({ ...p, ...patch })),
    [patchProject],
  );

  const addTask = useCallback<Store["addTask"]>(
    (projectId, t) =>
      patchProject(projectId, (p) => ({
        ...p,
        tarefas: [...p.tarefas, { ...t, id: `T${p.tarefas.length + 1}-${Math.floor(Math.random() * 900 + 100)}` }],
      })),
    [patchProject],
  );

  const updateTask = useCallback<Store["updateTask"]>(
    (projectId, taskId, patch) =>
      patchProject(projectId, (p) => ({
        ...p,
        tarefas: p.tarefas.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    [patchProject],
  );

  const removeTask = useCallback<Store["removeTask"]>(
    (projectId, taskId) =>
      patchProject(projectId, (p) => ({
        ...p,
        tarefas: p.tarefas
          .filter((t) => t.id !== taskId && t.paiId !== taskId)
          .map((t) => ({
            ...t,
            predecessoras: (t.predecessoras ?? []).filter((x) => x !== taskId),
          })),
      })),
    [patchProject],
  );

  const addProjectUpdate = useCallback<Store["addProjectUpdate"]>(
    (projectId, u) =>
      patchProject(projectId, (p) => ({
        ...p,
        atualizacoes: [
          { ...u, id: `UPD-${Math.floor(1000 + Math.random() * 8999)}` },
          ...(p.atualizacoes ?? []),
        ],
      })),
    [patchProject],
  );

  const addRisk = useCallback<Store["addRisk"]>(
    (projectId, r) =>
      patchProject(projectId, (p) => ({
        ...p,
        riscos: [{ ...r, id: `RSK-${Math.floor(100 + Math.random() * 899)}` }, ...(p.riscos ?? [])],
      })),
    [patchProject],
  );

  const addAttention = useCallback<Store["addAttention"]>(
    (projectId, a) =>
      patchProject(projectId, (p) => ({
        ...p,
        atencoes: [
          {
            ...a,
            id: `ATN-${Math.floor(100 + Math.random() * 899)}`,
            criadoEm: new Date().toISOString(),
            status: "aberto",
          },
          ...(p.atencoes ?? []),
        ],
      })),
    [patchProject],
  );

  const resolveAttention = useCallback<Store["resolveAttention"]>(
    (projectId, attentionId) =>
      patchProject(projectId, (p) => ({
        ...p,
        atencoes: (p.atencoes ?? []).map((a) =>
          a.id === attentionId ? { ...a, status: "resolvido" as const } : a,
        ),
      })),
    [patchProject],
  );

  const reset = useCallback(() => setState(initial), []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      createTicket,
      updateTicket,
      addArticle,
      setRole,
      createProject,
      updateProject,
      addTask,
      updateTask,
      addService,
      removeTask,
      addProjectUpdate,
      addRisk,
      addAttention,
      resolveAttention,
      reset,
    }),
    // deps
    [
      state,
      createTicket,
      updateTicket,
      addArticle,
      setRole,
      addService,
      createProject,
      updateProject,
      addTask,
      updateTask,
      removeTask,
      addProjectUpdate,
      addRisk,
      addAttention,
      resolveAttention,
      reset,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useItsm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useItsm precisa estar dentro de ItsmProvider");
  return ctx;
}