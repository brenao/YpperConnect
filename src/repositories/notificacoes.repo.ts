import { getSupabaseServerClient } from "@/integrations/supabase/server";

/**
 * Fila de notificações por e-mail, por empresa.
 *
 * O envio é assíncrono de propósito: gravar na fila e disparar o SMTP
 * depois evita que um relay lento ou fora do ar trave a abertura de um
 * chamado. Se o envio falhar, o chamado continua registrado e a
 * notificação fica com status 'erro' para nova tentativa.
 *
 * Gravar e listar usam a sessão de quem está no sistema (RLS). Despachar
 * a fila (pendentes, enviada, erro) é rotina do servidor e roda com a
 * chave de serviço, para todas as empresas.
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

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

async function admin() {
  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  return getSupabaseAdmin();
}

function paraNotificacao(n: Record<string, unknown>, nome: string | null = null): Notificacao {
  return {
    id: n["id"] as string,
    tipo: n["tipo"] as string,
    destinatarioId: (n["destinatario_id"] as string | null) ?? null,
    destinatarioEmail: n["destinatario_email"] as string,
    destinatarioNome: nome,
    assunto: n["assunto"] as string,
    corpo: (n["corpo"] as string | null) ?? null,
    referenciaTipo: (n["referencia_tipo"] as string | null) ?? null,
    referenciaId: (n["referencia_id"] as string | null) ?? null,
    status: n["status"] as StatusNotificacao,
    tentativas: Number(n["tentativas"] ?? 0),
    erro: (n["erro"] as string | null) ?? null,
    criadoEm: new Date(n["criado_em"] as string),
    enviadoEm: n["enviado_em"] ? new Date(n["enviado_em"] as string) : null,
  };
}

/** Últimas notificações da empresa (tela de Notificações, só admin). */
export async function listarNotificacoes(limite = 100): Promise<Notificacao[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("notificacoes")
    .select("*")
    .eq("tenant_id", await tenantAtual())
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);

  const linhas = data ?? [];
  const ids = [...new Set(linhas.map((n) => n.destinatario_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const u = await sb.from("usuarios").select("id, nome").in("id", ids);
    for (const p of u.data ?? []) nomes.set(p.id as string, p.nome as string);
  }
  return linhas.map((n) => paraNotificacao(n, nomes.get(n.destinatario_id as string) ?? null));
}

export async function contarPorStatus(): Promise<Record<string, number>> {
  const { data, error } = await getSupabaseServerClient()
    .from("notificacoes")
    .select("status")
    .eq("tenant_id", await tenantAtual());
  if (error) throw new Error(error.message);
  const mapa: Record<string, number> = { pendente: 0, enviado: 0, erro: 0 };
  for (const l of data ?? []) mapa[l.status as string] = (mapa[l.status as string] ?? 0) + 1;
  return mapa;
}

/**
 * Tipos aceitos na fila. A união espelha o `CHECK` da tabela: o banco é a
 * fonte da verdade; isto é a cópia que o TypeScript enxerga.
 */
export type TipoNotificacao =
  | "chamado_criado"
  | "chamado_aberto_confirmacao"
  | "chamado_atribuido"
  | "chamado_atividade"
  | "chamado_resolvido"
  | "chamado_reaberto"
  | "chamado_status"
  | "projeto_lembrete"
  /** Pedido de acesso a projeto, endereçado a quem decide. */
  | "acesso_solicitado"
  /** Resposta do gerente ao pedido, endereçada a quem pediu. */
  | "acesso_decidido";

/** A que registro a notificação se refere. */
export type ReferenciaNotificacao = "chamado" | "projeto" | "solicitacao_acesso";

export interface NovaNotificacao {
  tipo: TipoNotificacao;
  destinatarioId?: string | null | undefined;
  destinatarioEmail: string;
  assunto: string;
  corpo?: string | null | undefined;
  referenciaTipo?: ReferenciaNotificacao | undefined;
  referenciaId?: string | undefined;
}

/**
 * Grava na fila da empresa atual. Nunca envia — quem envia é processarFila().
 *
 * Pelo adaptador de SQL: funciona na tela e nas rotinas sem navegador
 * (executarComo). A empresa vem da sessão (tenant_id padrão no banco).
 */
export async function enfileirar(n: NovaNotificacao): Promise<string> {
  const { consultarUm } = await import("@/integrations/postgres/client.server");
  const linha = await consultarUm<{ id: string }>(
    `INSERT INTO notificacoes
       (tipo, destinatario_id, destinatario_email, assunto, corpo, referencia_tipo, referencia_id)
     VALUES (:tipo, :destinatarioId, :destinatarioEmail, :assunto, :corpo, :referenciaTipo, :referenciaId)
     RETURNING id`,
    {
      tipo: n.tipo,
      destinatarioId: n.destinatarioId ?? null,
      destinatarioEmail: n.destinatarioEmail,
      assunto: n.assunto.slice(0, 300),
      corpo: n.corpo ?? null,
      referenciaTipo: n.referenciaTipo ?? null,
      referenciaId: n.referenciaId ?? null,
    },
  );
  if (!linha) throw new Error("Falha ao gravar a notificação na fila.");
  return linha.id;
}

/**
 * Pendentes com menos de 5 tentativas, de todas as empresas. O limite
 * evita que um endereço inválido fique sendo reprocessado para sempre.
 */
export async function listarPendentes(limite = 25): Promise<Notificacao[]> {
  const { data, error } = await (
    await admin()
  )
    .from("notificacoes")
    .select("*")
    .in("status", ["pendente", "erro"])
    .lt("tentativas", 5)
    .order("criado_em")
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []).map((n) => paraNotificacao(n));
}

export async function marcarEnviada(id: string): Promise<void> {
  const sb = await admin();
  const atual = await sb.from("notificacoes").select("tentativas").eq("id", id).single();
  const { error } = await sb
    .from("notificacoes")
    .update({
      status: "enviado",
      enviado_em: new Date().toISOString(),
      tentativas: Number(atual.data?.tentativas ?? 0) + 1,
      erro: null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function marcarErro(id: string, erro: string): Promise<void> {
  const sb = await admin();
  const atual = await sb.from("notificacoes").select("tentativas").eq("id", id).single();
  const { error } = await sb
    .from("notificacoes")
    .update({
      status: "erro",
      tentativas: Number(atual.data?.tentativas ?? 0) + 1,
      erro: erro.slice(0, 1000),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}