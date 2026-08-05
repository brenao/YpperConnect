import type {
  DirectoryUser,
  EmailNotification,
  Project,
  Ticket,
  TicketStatus,
} from "./itsm-types";
import { STATUS_LABEL } from "./itsm-types";

/** Dias sem atualização a partir dos quais o gestor recebe lembrete. */
export const LEMBRETE_DIAS = 6;
/** A partir daqui o lembrete passa a ser diário. */
export const LEMBRETE_DIARIO_DIAS = 7;

const DIA = 86_400_000;

export function emailDe(users: DirectoryUser[], nome: string | undefined): string | null {
  if (!nome) return null;
  const alvo = nome.trim().toLowerCase();
  const u = users.find((x) => x.nome.toLowerCase() === alvo || x.email.toLowerCase() === alvo);
  return u?.email ?? null;
}

function id(prefixo: string) {
  return `${prefixo}-${Date.now().toString(36)}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

/** E-mail disparado quando o status de um chamado muda. */
export function buildStatusEmail(
  ticket: Ticket,
  anterior: TicketStatus,
  users: DirectoryUser[],
): EmailNotification | null {
  const destinatarios = [
    emailDe(users, ticket.solicitante),
    emailDe(users, ticket.responsavel),
  ].filter((x): x is string => Boolean(x));
  const unicos = [...new Set(destinatarios)];
  if (!unicos.length) return null;
  return {
    id: id("MSG"),
    tipo: "chamado_status",
    referencia: ticket.id,
    criadoEm: new Date().toISOString(),
    destinatarios: unicos,
    assunto: `[${ticket.id}] Status alterado para ${STATUS_LABEL[ticket.status]}`,
    corpo: [
      `O chamado ${ticket.id} — ${ticket.titulo} mudou de "${STATUS_LABEL[anterior]}" para "${STATUS_LABEL[ticket.status]}".`,
      `Serviço: ${ticket.servico}${ticket.sistema ? ` · Sistema: ${ticket.sistema}` : ""}`,
      `Responsável: ${ticket.responsavel} · Equipe: ${ticket.equipe}`,
      ticket.descricaoEncerramento
        ? `Encerramento: ${ticket.descricaoEncerramento}`
        : `Prazo de solução: ${new Date(ticket.prazoSla).toLocaleString("pt-BR")}`,
    ].join("\n"),
  };
}

/** E-mail de confirmação de abertura para solicitante e responsável. */
export function buildCreatedEmail(
  ticket: Ticket,
  users: DirectoryUser[],
): EmailNotification | null {
  const unicos = [
    ...new Set(
      [emailDe(users, ticket.solicitante), emailDe(users, ticket.responsavel)].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  ];
  if (!unicos.length) return null;
  return {
    id: id("MSG"),
    tipo: "chamado_criado",
    referencia: ticket.id,
    criadoEm: new Date().toISOString(),
    destinatarios: unicos,
    assunto: `[${ticket.id}] Chamado registrado — ${ticket.titulo}`,
    corpo: `Chamado registrado com prioridade ${ticket.prioridade} e atribuído a ${ticket.responsavel} (${ticket.equipe}). Prazo de solução: ${new Date(ticket.prazoSla).toLocaleString("pt-BR")}.`,
  };
}

/** Data da última atualização registrada no projeto. */
export function ultimaAtualizacao(p: Project): number {
  const datas = (p.atualizacoes ?? []).map((u) => new Date(u.data).getTime());
  return datas.length ? Math.max(...datas) : new Date(p.inicio).getTime();
}

export function diasSemAtualizacao(p: Project, agora = Date.now()): number {
  return Math.floor((agora - ultimaAtualizacao(p)) / DIA);
}

/**
 * Regra: 6 dias sem atualização gera lembrete; a partir de 7 dias o lembrete
 * é diário. Evita duplicidade comparando com os lembretes já enviados hoje.
 */
export function buildProjectReminders(
  projects: Project[],
  users: DirectoryUser[],
  enviados: EmailNotification[],
  agora = Date.now(),
): EmailNotification[] {
  const hoje = new Date(agora).toDateString();
  const out: EmailNotification[] = [];
  for (const p of projects) {
    if (p.status === "concluido" || p.status === "cancelado") continue;
    const dias = diasSemAtualizacao(p, agora);
    if (dias < LEMBRETE_DIAS) continue;
    const jaHoje = enviados.some(
      (n) =>
        n.tipo === "projeto_lembrete" &&
        n.referencia === p.id &&
        new Date(n.criadoEm).toDateString() === hoje,
    );
    if (jaHoje) continue;
    if (dias < LEMBRETE_DIARIO_DIAS) {
      const jaEnviado = enviados.some(
        (n) => n.tipo === "projeto_lembrete" && n.referencia === p.id,
      );
      if (jaEnviado) continue;
    }
    const destinatarios = [...new Set(
      [emailDe(users, p.gerente), emailDe(users, p.sponsor)].filter(
        (x): x is string => Boolean(x),
      ),
    )];
    if (!destinatarios.length) continue;
    out.push({
      id: id("MSG"),
      tipo: "projeto_lembrete",
      referencia: p.id,
      criadoEm: new Date(agora).toISOString(),
      destinatarios,
      assunto: `[${p.id}] ${dias} dias sem atualização — ${p.nome}`,
      corpo:
        dias >= LEMBRETE_DIARIO_DIAS
          ? `O projeto ${p.nome} está há ${dias} dias sem status report. Lembretes passam a ser diários até o registro de uma nova atualização.`
          : `O projeto ${p.nome} completou ${dias} dias sem status report. Registre as últimas e próximas entregas.`,
    });
  }
  return out;
}