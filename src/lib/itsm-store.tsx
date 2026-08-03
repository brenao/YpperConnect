import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SEED_ARTICLES, SEED_PROJECTS, SEED_SERVICES, SEED_TICKETS } from "./itsm-seed";
import type { Article, Project, ServiceItem, Ticket } from "./itsm-types";
import { SLA_HORAS, resolvePriority } from "./itsm-types";

const KEY = "govti.state.v1";

interface State {
  tickets: Ticket[];
  services: ServiceItem[];
  articles: Article[];
  projects: Project[];
}

const initial: State = {
  tickets: SEED_TICKETS,
  services: SEED_SERVICES,
  articles: SEED_ARTICLES,
  projects: SEED_PROJECTS,
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
> &
  Pick<Partial<Ticket>, "sistema">;

interface Store extends State {
  createTicket: (t: NewTicket) => Ticket;
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  addArticle: (a: Omit<Article, "id" | "visualizacoes">) => void;
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
    const ticket: Ticket = {
      ...input,
      id: `${PREFIX[input.tipo]}-${Math.floor(1000 + Math.random() * 8999)}`,
      prioridade,
      status: "novo",
      responsavel: "Não atribuído",
      equipe: input.tipo === "incidente" ? "Service Desk" : "Service Desk",
      criadoEm,
      prazoSla: new Date(
        Date.now() + SLA_HORAS[prioridade].solucao * 3600_000,
      ).toISOString(),
    };
    setState((s) => ({ ...s, tickets: [ticket, ...s.tickets] }));
    return ticket;
  }, []);

  const updateTicket = useCallback((id: string, patch: Partial<Ticket>) => {
    setState((s) => ({
      ...s,
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
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

  const reset = useCallback(() => setState(initial), []);

  const value = useMemo<Store>(
    () => ({ ...state, createTicket, updateTicket, addArticle, reset }),
    [state, createTicket, updateTicket, addArticle, reset],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useItsm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useItsm precisa estar dentro de ItsmProvider");
  return ctx;
}