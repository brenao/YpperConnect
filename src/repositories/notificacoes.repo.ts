import { checar, data, db, linhas, paraData } from "@/integrations/db/client.server";

/**
 * Fila de notificações por e-mail.
 *
 * O envio é assíncrono de propósito: gravar na fila dentro da transação
 * do chamado e disparar o SMTP depois evita que um relay lento ou fora
 * do ar trave a abertura de um chamado. Se o envio falhar, o chamado
 * continua registrado e a notificação fica com status 'erro' para nova
 * tentativa.
 */

export type StatusNotificacao = "pendente" | "enviado" | "erro";

export interface Notificacao {
  id: string;
  tipo: string;
  destinatarioId: string | null;
  destinatarioEmail: string;
  destinatarioNome: string | null;
  assunto: string;
  corpo: string | null;
  referenciaTipo: string | null;
  referenciaId: string | null;
  status: StatusNotificacao;
  tentativas: number;
  erro: string | null;
  criadoEm: Date;
  enviadoEm: Date | null;
}

interface LinhaNotificacao {
  id: string;
  tipo: string;
  destinatario_id: string | null;
  destinatario_email: string;
  assunto: string;
  corpo: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  status: string;
  tentativas: number;
  erro: string | null;
  criado_em: string;
  enviado_em: string | null;
  usuarios: { nome: string } | null;
}

const mapear = (l: LinhaNotificacao): Notificacao => ({
  id: l.id,
  tipo: l.tipo,
  destinatarioId: l.destinatario_id,
  destinatarioEmail: l.destinatario_email,
  destinatarioNome: l.usuarios?.nome ?? null,
  assunto: l.assunto,
  corpo: l.corpo,
  referenciaTipo: l.referencia_tipo,
  referenciaId: l.referencia_id,
  status: l.status as StatusNotificacao,
  tentativas: l.tentativas,
  erro: l.erro,
  criadoEm: data(l.criado_em),
  enviadoEm: paraData(l.enviado_em),
});

export async function listarNotificacoes(limite = 100): Promise<Notificacao[]> {
  const l = linhas(
    await db
      .from("notificacoes")
      .select(
        `id, tipo, destinatario_id, destinatario_email, assunto, corpo,
         referencia_tipo, referencia_id, status, tentativas, erro, criado_em, enviado_em,
         usuarios ( nome )`,
      )
      .order("criado_em", { ascending: false })
      .limit(limite),
  );
  return (l as unknown as LinhaNotificacao[]).map(mapear);
}

/**
 * A contagem era feita com GROUP BY no Oracle; aqui buscamos os status
 * e agregamos em TypeScript.
 */
export async function contarPorStatus(): Promise<Record<string, number>> {
  const l = linhas(await db.from("notificacoes").select("status"));
  const mapa: Record<string, number> = { pendente: 0, enviado: 0, erro: 0 };
  for (const { status } of l as Array<{ status: string }>) {
    mapa[status] = (mapa[status] ?? 0) + 1;
  }
  return mapa;
}

export interface NovaNotificacao {
  tipo: "chamado_criado" | "chamado_status" | "projeto_lembrete";
  destinatarioId?: string | null | undefined;
  destinatarioEmail: string;
  assunto: string;
  corpo?: string | null | undefined;
  referenciaTipo?: "chamado" | "projeto" | undefined;
  referenciaId?: string | undefined;
}

/** Grava na fila. Nunca envia — quem envia é processarFila(). */
export async function enfileirar(n: NovaNotificacao): Promise<string> {
  const id = crypto.randomUUID();
  checar(
    await db.from("notificacoes").insert({
      id,
      tipo: n.tipo,
      destinatario_id: n.destinatarioId ?? null,
      destinatario_email: n.destinatarioEmail,
      assunto: n.assunto.slice(0, 300),
      corpo: n.corpo ?? null,
      referencia_tipo: n.referenciaTipo ?? null,
      referencia_id: n.referenciaId ?? null,
      status: "pendente",
      tentativas: 0,
      criado_em: new Date().toISOString(),
    }),
  );
  return id;
}

/**
 * Pendentes com menos de 5 tentativas. O limite evita que um endereço
 * inválido fique sendo reprocessado para sempre.
 */
export async function listarPendentes(limite = 25): Promise<Notificacao[]> {
  const l = linhas(
    await db
      .from("notificacoes")
      .select(
        `id, tipo, destinatario_id, destinatario_email, assunto, corpo,
         referencia_tipo, referencia_id, status, tentativas, erro, criado_em, enviado_em`,
      )
      .in("status", ["pendente", "erro"])
      .lt("tentativas", 5)
      .order("criado_em")
      .limit(limite),
  );
  return (l as unknown as Array<Omit<LinhaNotificacao, "usuarios">>).map((r) =>
    mapear({ ...r, usuarios: null }),
  );
}

export async function marcarEnviada(id: string): Promise<void> {
  const r = await db.from("notificacoes").select("tentativas").eq("id", id).maybeSingle();
  const atual = checar(r);
  checar(
    await db
      .from("notificacoes")
      .update({
        status: "enviado",
        enviado_em: new Date().toISOString(),
        tentativas: (atual?.tentativas ?? 0) + 1,
        erro: null,
      })
      .eq("id", id),
  );
}

export async function marcarErro(id: string, erro: string): Promise<void> {
  const r = await db.from("notificacoes").select("tentativas").eq("id", id).maybeSingle();
  const atual = checar(r);
  checar(
    await db
      .from("notificacoes")
      .update({
        status: "erro",
        tentativas: (atual?.tentativas ?? 0) + 1,
        erro: erro.slice(0, 1000),
      })
      .eq("id", id),
  );
}
