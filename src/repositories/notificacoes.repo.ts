import { consultar, executar } from "@/integrations/oracle/client.server";

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

export async function listarNotificacoes(limite = 100): Promise<Notificacao[]> {
  return consultar<Notificacao>(
    `SELECT n.id, n.tipo, n.destinatario_id, n.destinatario_email,
            u.nome AS destinatario_nome, n.assunto, n.corpo,
            n.referencia_tipo, n.referencia_id, n.status,
            n.tentativas, n.erro, n.criado_em, n.enviado_em
       FROM notificacoes n
       LEFT JOIN usuarios u ON u.id = n.destinatario_id
      ORDER BY n.criado_em DESC
      FETCH FIRST :limite ROWS ONLY`,
    { limite },
  );
}

export async function contarPorStatus(): Promise<Record<string, number>> {
  const linhas = await consultar<{ status: string; total: number }>(
    `SELECT status, COUNT(*) AS total FROM notificacoes GROUP BY status`,
  );
  const mapa: Record<string, number> = { pendente: 0, enviado: 0, erro: 0 };
  for (const l of linhas) mapa[l.status] = l.total;
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
  await executar(
    `INSERT INTO notificacoes
       (id, tipo, destinatario_id, destinatario_email, assunto, corpo,
        referencia_tipo, referencia_id, status, tentativas, criado_em)
     VALUES
       (:id, :tipo, :destinatarioId, :destinatarioEmail, :assunto, :corpo,
        :referenciaTipo, :referenciaId, 'pendente', 0, SYSTIMESTAMP)`,
    {
      id,
      tipo: n.tipo,
      destinatarioId: n.destinatarioId ?? null,
      destinatarioEmail: n.destinatarioEmail,
      assunto: n.assunto.slice(0, 300),
      corpo: n.corpo ?? null,
      referenciaTipo: n.referenciaTipo ?? null,
      referenciaId: n.referenciaId ?? null,
    },
  );
  return id;
}

/**
 * Pendentes com menos de 5 tentativas. O limite evita que um endereço
 * inválido fique sendo reprocessado para sempre.
 */
export async function listarPendentes(limite = 25): Promise<Notificacao[]> {
  return consultar<Notificacao>(
    `SELECT n.id, n.tipo, n.destinatario_id, n.destinatario_email,
            NULL AS destinatario_nome, n.assunto, n.corpo,
            n.referencia_tipo, n.referencia_id, n.status,
            n.tentativas, n.erro, n.criado_em, n.enviado_em
       FROM notificacoes n
      WHERE n.status IN ('pendente','erro') AND n.tentativas < 5
      ORDER BY n.criado_em
      FETCH FIRST :limite ROWS ONLY`,
    { limite },
  );
}

export async function marcarEnviada(id: string): Promise<void> {
  await executar(
    `UPDATE notificacoes
        SET status = 'enviado', enviado_em = SYSTIMESTAMP,
            tentativas = tentativas + 1, erro = NULL
      WHERE id = :id`,
    { id },
  );
}

export async function marcarErro(id: string, erro: string): Promise<void> {
  await executar(
    `UPDATE notificacoes
        SET status = 'erro', tentativas = tentativas + 1, erro = :erro
      WHERE id = :id`,
    { id, erro: erro.slice(0, 1000) },
  );
}
