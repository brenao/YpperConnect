import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  SEED_ARTICLES,
  SEED_PROFILES,
  SEED_PROJECTS,
  SEED_RESOURCES,
  SEED_SERVICES,
  SEED_SYSTEMS,
  SEED_TICKETS,
  SEED_USERS,
} from "@/models/itsm-seed";
import {
  buildCreatedEmail,
  buildProjectReminders,
  buildStatusEmail,
} from "@/services/notifications";
import type {
  AccessProfile,
  Article,
  DirectoryUser,
  EmailNotification,
  Project,
  ProjectAttention,
  ProjectRisk,
  ProjectTask,
  ProjectUpdate,
  Resource,
  ServiceItem,
  SystemRegistry,
  Ticket,
  UserRole,
} from "@/models/itsm-types";
import { APP_FEATURES, APP_MODULES, resolvePriority, slaFor } from "@/models/itsm-types";

const KEY = "govti.state.v4";

interface State {
  tickets: Ticket[];
  services: ServiceItem[];
  articles: Article[];
  projects: Project[];
  resources: Resource[];
  users: DirectoryUser[];
  systems: SystemRegistry[];
  profiles: AccessProfile[];
  notifications: EmailNotification[];
  /** Usuário logado (simulação da sessão vinda do AD). */
  currentUserId: string;
  role: UserRole;
}

const initial: State = {
  tickets: SEED_TICKETS,
  services: SEED_SERVICES,
  articles: SEED_ARTICLES,
  projects: SEED_PROJECTS,
  resources: SEED_RESOURCES,
  users: SEED_USERS,
  systems: SEED_SYSTEMS,
  profiles: SEED_PROFILES,
  notifications: [],
  currentUserId: "USR-01",
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
  /** Usuário da sessão atual. */
  currentUser: DirectoryUser | undefined;
  isAdmin: boolean;
  /** Perfil de acesso da sessão atual. */
  currentProfile: AccessProfile | undefined;
  /** Módulos (menus) liberados para a sessão atual. */
  allowedModules: string[];
  /** Verifica se a sessão pode usar uma funcionalidade. */
  can: (feature: string) => boolean;
  /** Verifica se a sessão pode acessar um menu. */
  canAccess: (moduleKey: string) => boolean;
  addProfile: (p: Omit<AccessProfile, "id">) => void;
  updateProfile: (id: string, patch: Partial<AccessProfile>) => void;
  removeProfile: (id: string) => void;
  assignProfile: (userId: string, profileId: string) => void;
  createTicket: (t: NewTicket) => Ticket;
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  addArticle: (a: Omit<Article, "id" | "visualizacoes">) => void;
  addService: (s: Omit<ServiceItem, "id">) => void;
  updateService: (id: string, patch: Partial<ServiceItem>) => void;
  removeService: (id: string) => void;
  addUser: (u: Omit<DirectoryUser, "id">) => void;
  updateUser: (id: string, patch: Partial<DirectoryUser>) => void;
  removeUser: (id: string) => void;
  setCurrentUser: (id: string) => void;
  syncDirectory: () => number;
  addSystem: (s: Omit<SystemRegistry, "id">) => void;
  updateSystem: (id: string, patch: Partial<SystemRegistry>) => void;
  removeSystem: (id: string) => void;
  setRole: (r: UserRole) => void;
  createProject: (
    p: Omit<Project, "id" | "tarefas" | "atualizacoes" | "riscos" | "atencoes">,
  ) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  addTask: (projectId: string, t: Omit<ProjectTask, "id">, afterTaskId?: string) => void;
  updateTask: (projectId: string, taskId: string, patch: Partial<ProjectTask>) => void;
  removeTask: (projectId: string, taskId: string) => void;
  addProjectUpdate: (projectId: string, u: Omit<ProjectUpdate, "id">) => void;
  addRisk: (projectId: string, r: Omit<ProjectRisk, "id">) => void;
  addAttention: (
    projectId: string,
    a: Omit<ProjectAttention, "id" | "criadoEm" | "status">,
  ) => void;
  resolveAttention: (projectId: string, attentionId: string) => void;
  addResource: (r: Omit<Resource, "id">) => void;
  updateResource: (id: string, patch: Partial<Resource>) => void;
  removeResource: (id: string) => void;
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
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const notify = useCallback((mensagens: EmailNotification[]) => {
    if (!mensagens.length) return;
    setState((s) => ({ ...s, notifications: [...mensagens, ...s.notifications].slice(0, 200) }));
    void (async () => {
      const { enviarNotificacaoEmail } = await import("@/services/email.functions");
      for (const m of mensagens) {
        try {
          await enviarNotificacaoEmail({
            data: {
              id: m.id,
              assunto: m.assunto,
              corpo: m.corpo,
              destinatarios: m.destinatarios,
            },
          });
        } catch (error) {
          console.error("Não foi possível enviar o e-mail da notificação", error);
        }
      }
    })();
  }, []);

  // Lembretes de atualização de projeto (6 dias; diário após 7).
  useEffect(() => {
    const rodar = () => {
      const s = stateRef.current;
      notify(buildProjectReminders(s.projects, s.users, s.notifications));
    };
    const t = window.setTimeout(rodar, 1200);
    const i = window.setInterval(rodar, 3600_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, [notify]);

  const createTicket = useCallback(
    (input: NewTicket) => {
      const prioridade = resolvePriority(input.impacto, input.urgencia);
      const criadoEm = new Date().toISOString();
      const meta = slaFor(input.tipo, prioridade);
      const base = new Date(criadoEm).getTime();
      const s0 = stateRef.current;
      // Atribuição automática pelo cadastro de sistemas; fallback no catálogo.
      const sistemaCad = input.sistema
        ? s0.systems.find(
            (x) => x.ativo && x.nome.toLowerCase() === input.sistema!.trim().toLowerCase(),
          )
        : undefined;
      const servicoCad = s0.services.find((x) => x.nome === input.servico);
      const responsavelUser = sistemaCad
        ? s0.users.find((u) => u.id === sistemaCad.atribuicaoId)
        : undefined;
      const ticket: Ticket = {
        ...input,
        id: `${PREFIX[input.tipo]}-${Math.floor(1000 + Math.random() * 8999)}`,
        prioridade,
        status: "novo",
        responsavel: responsavelUser?.nome ?? "Não atribuído",
        equipe: sistemaCad?.equipe ?? servicoCad?.equipe ?? "Service Desk",
        criadoEm,
        prazoSla: new Date(base + meta.solucao * 3600_000).toISOString(),
        prazoResposta: new Date(base + meta.resposta * 3600_000).toISOString(),
      };
      setState((s) => ({ ...s, tickets: [ticket, ...s.tickets] }));
      const email = buildCreatedEmail(ticket, s0.users);
      if (email) notify([email]);
      return ticket;
    },
    [notify],
  );

  const updateTicket = useCallback(
    (id: string, patch: Partial<Ticket>) => {
      const anterior = stateRef.current.tickets.find((t) => t.id === id);
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
      if (anterior && patch.status && patch.status !== anterior.status) {
        const email = buildStatusEmail(
          { ...anterior, ...patch },
          anterior.status,
          stateRef.current.users,
        );
        if (email) notify([email]);
      }
    },
    [notify],
  );

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
      services: [...s.services, { ...item, id: `SVC-${Math.floor(100 + Math.random() * 899)}` }],
    }));
  }, []);

  const updateService = useCallback<Store["updateService"]>((id, patch) => {
    setState((s) => ({
      ...s,
      services: s.services.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  }, []);

  const removeService = useCallback<Store["removeService"]>((id) => {
    setState((s) => ({ ...s, services: s.services.filter((x) => x.id !== id) }));
  }, []);

  const addUser = useCallback<Store["addUser"]>((u) => {
    setState((s) => ({
      ...s,
      users: [...s.users, { ...u, id: `USR-${Math.floor(100 + Math.random() * 899)}` }],
    }));
  }, []);

  const updateUser = useCallback<Store["updateUser"]>((id, patch) => {
    setState((s) => ({
      ...s,
      users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    }));
  }, []);

  const removeUser = useCallback<Store["removeUser"]>((id) => {
    setState((s) => ({ ...s, users: s.users.filter((u) => u.id !== id) }));
  }, []);

  const setCurrentUser = useCallback<Store["setCurrentUser"]>((id) => {
    setState((s) => ({ ...s, currentUserId: id }));
  }, []);

  /** Simula a sincronização com o Active Directory (carimba data em todos). */
  const syncDirectory = useCallback<Store["syncDirectory"]>(() => {
    const agora = new Date().toISOString();
    setState((s) => ({
      ...s,
      users: s.users.map((u) => (u.origem === "ad" ? { ...u, sincronizadoEm: agora } : u)),
    }));
    return stateRef.current.users.filter((u) => u.origem === "ad").length;
  }, []);

  const addSystem = useCallback<Store["addSystem"]>((sys) => {
    setState((s) => ({
      ...s,
      systems: [...s.systems, { ...sys, id: `SYS-${Math.floor(100 + Math.random() * 899)}` }],
    }));
  }, []);

  const updateSystem = useCallback<Store["updateSystem"]>((id, patch) => {
    setState((s) => ({
      ...s,
      systems: s.systems.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  }, []);

  const removeSystem = useCallback<Store["removeSystem"]>((id) => {
    setState((s) => ({ ...s, systems: s.systems.filter((x) => x.id !== id) }));
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
    (projectId, t, afterTaskId) =>
      patchProject(projectId, (p) => {
        const nova: ProjectTask = {
          ...t,
          id: `T${p.tarefas.length + 1}-${Math.floor(Math.random() * 900 + 100)}`,
        };
        const idx = afterTaskId ? p.tarefas.findIndex((x) => x.id === afterTaskId) : -1;
        if (idx < 0) return { ...p, tarefas: [...p.tarefas, nova] };
        const tarefas = [...p.tarefas];
        tarefas.splice(idx + 1, 0, nova);
        return { ...p, tarefas };
      }),
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

  const addResource = useCallback<Store["addResource"]>((r) => {
    setState((s) => ({
      ...s,
      resources: [
        ...s.resources,
        { ...r, id: `RES-${Math.floor(10 + Math.random() * 89)}${s.resources.length}` },
      ],
    }));
  }, []);

  const updateResource = useCallback<Store["updateResource"]>((id, patch) => {
    setState((s) => ({
      ...s,
      resources: s.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }, []);

  const removeResource = useCallback<Store["removeResource"]>((id) => {
    setState((s) => ({ ...s, resources: s.resources.filter((r) => r.id !== id) }));
  }, []);

  const reset = useCallback(() => setState(initial), []);

  const addProfile = useCallback<Store["addProfile"]>((p) => {
    setState((s) => ({
      ...s,
      profiles: [...s.profiles, { ...p, id: `PRF-${Date.now().toString(36).toUpperCase()}` }],
    }));
  }, []);

  const updateProfile = useCallback<Store["updateProfile"]>((id, patch) => {
    setState((s) => ({
      ...s,
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  const removeProfile = useCallback<Store["removeProfile"]>((id) => {
    setState((s) => ({
      ...s,
      profiles: s.profiles.filter((p) => (p.id === id ? Boolean(p.sistema) : true)),
      users: s.users.map((u) => (u.perfilId === id ? { ...u, perfilId: undefined } : u)),
    }));
  }, []);

  const assignProfile = useCallback<Store["assignProfile"]>((userId, profileId) => {
    setState((s) => ({
      ...s,
      users: s.users.map((u) => (u.id === userId ? { ...u, perfilId: profileId } : u)),
    }));
  }, []);

  const value = useMemo<Store>(
    () => {
      const currentUser = state.users.find((u) => u.id === state.currentUserId);
      const isAdmin = Boolean(currentUser?.admin);
      const currentProfile = state.profiles.find((p) => p.id === currentUser?.perfilId && p.ativo);
      const allowedModules = isAdmin
        ? APP_MODULES.map((m) => m.key)
        : Array.from(new Set(["/", ...(currentProfile?.modulos ?? [])]));
      const allowedFeatures = isAdmin
        ? APP_FEATURES.map((f) => f.key)
        : (currentProfile?.funcionalidades ?? []);
      return {
        ...state,
        currentUser,
        isAdmin,
        currentProfile,
        allowedModules,
        can: (feature: string) => allowedFeatures.includes(feature),
        canAccess: (moduleKey: string) => allowedModules.includes(moduleKey),
        addProfile,
        updateProfile,
        removeProfile,
        assignProfile,
        createTicket,
        updateTicket,
        addArticle,
        setRole,
        updateService,
        removeService,
        addUser,
        updateUser,
        removeUser,
        setCurrentUser,
        syncDirectory,
        addSystem,
        updateSystem,
        removeSystem,
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
        addResource,
        updateResource,
        removeResource,
        reset,
      };
    },
    // deps
    [
      state,
      addProfile,
      updateProfile,
      removeProfile,
      assignProfile,
      createTicket,
      updateTicket,
      addArticle,
      setRole,
      addService,
      updateService,
      removeService,
      addUser,
      updateUser,
      removeUser,
      setCurrentUser,
      syncDirectory,
      addSystem,
      updateSystem,
      removeSystem,
      createProject,
      updateProject,
      addTask,
      updateTask,
      removeTask,
      addProjectUpdate,
      addRisk,
      addAttention,
      resolveAttention,
      addResource,
      updateResource,
      removeResource,
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
