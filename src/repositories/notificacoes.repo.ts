import { consultar } from "@/integrations/oracle/client.server";
import { paraBool } from "./tipos";

/**
 * Fila de notificações por e-mail.
 *
 * Somente leitura por enquanto: a gravação entra quando as transições de
 * status de chamado passarem a enfileirar aviso ao solicitante. Hoje a
 * tabela existe e está vazia — a tela mostra isso honestamente em vez de
 * fingir que há histórico.
 */

export interface Notificacao {
  id: string;
  tipo: string;
  destinatarioEmail: string;
  destinatarioNome: string | null;
  assunto: string;
  referenciaTipo: string | null;
  referenciaId: string | null;
  status: "pendente" | "enviado" | "erro";
  tentativas: number;
  erro: string | null;
  criadoEm: Date;
  enviadoEm: Date | null;
}

export async function listarNotificacoes(limite = 100): Promise<Notificacao[]> {
  return consultar<Notificacao>(
    `SELECT n.id, n.tipo, n.destinatario_email, u.nome AS destinatario_nome,
            n.assunto, n.referencia_tipo, n.referencia_id, n.status,
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

/** Reexportado para manter o import de paraBool usado por futuras colunas. */
export { paraBool };
