import type { Chamado } from "@/repositories/chamados.repo";
import type { TipoNotificacao } from "@/repositories/notificacoes.repo";

/**
 * Avisos por e-mail dos chamados. SOMENTE SERVIDOR.
 *
 * Regras de produto (quem recebe o quê):
 *
 *   evento      | solicitante                         | atendimento*
 *   ------------|-------------------------------------|------------------------
 *   aberto      | confirmação de abertura             | novo chamado
 *   atribuido   | —                                   | o novo responsável
 *   atividade   | —                                   | nova atividade
 *   resolvido   | solução + pedido de confirmação     | chamado resolvido
 *   reaberto    | —                                   | reaberto, com o motivo
 *
 *   * atendimento = o responsável; sem responsável, a equipe do chamado.
 *
 * Quem fez a ação nunca recebe o e-mail dela. O fechamento (pelo
 * solicitante ou automático) não gera e-mail: fica no histórico.
 *
 * Falha de e-mail nunca desfaz a ação no chamado: tudo aqui é chamado
 * depois da gravação, dentro de try/catch, e a fila guarda o que não
 * saiu para nova tentativa.
 */

export type EventoChamado = "aberto" | "atribuido" | "atividade" | "resolvido" | "reaberto";

interface Mensagem {
  para: string[];
  tipo: TipoNotificacao;
  assunto: string;
  corpo: string;
}

const RODAPE = "\n\n—\nBeagleOne · mensagem automática, não responda este e-mail.";

/** Responsável do chamado; sem responsável, os membros ativos da equipe. */
async function atendimento(c: Chamado): Promise<string[]> {
  if (c.responsavelId) return [c.responsavelId];
  if (!c.equipeId) return [];
  const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  const { tenantId } = await getUsuarioAtual();
  const { data } = await getSupabaseServerClient()
    .from("tenant_membros")
    .select("usuario_id")
    .eq("tenant_id", tenantId)
    .eq("equipe_id", c.equipeId)
    .eq("ativo", true);
  return (data ?? []).map((m) => m.usuario_id as string);
}

function mensagens(
  evento: EventoChamado,
  c: Chamado,
  equipe: string[],
  extra: { texto?: string | undefined; autorNome?: string | undefined },
): Mensagem[] {
  const ref = `[${c.codigo}] ${c.titulo}`;
  const prazo = c.prazoSla.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  switch (evento) {
    case "aberto":
      return [
        {
          para: [c.solicitanteId],
          tipo: "chamado_aberto_confirmacao",
          assunto: `${ref} · chamado aberto`,
          corpo:
            `Recebemos o seu chamado ${c.codigo} — ${c.titulo}.\n\n` +
            `A equipe de atendimento já foi avisada. Você receberá outro e-mail quando ele for resolvido.` +
            RODAPE,
        },
        {
          para: equipe,
          tipo: "chamado_criado",
          assunto: `${ref} · novo chamado ${c.prioridade}`,
          corpo:
            `Novo chamado ${c.codigo} — ${c.titulo}\n` +
            `Prioridade: ${c.prioridade} · Prazo de solução: ${prazo}\n` +
            `Solicitante: ${c.solicitanteNome}\n\n${c.descricao}` +
            RODAPE,
        },
      ];
    case "atribuido":
      return [
        {
          para: c.responsavelId ? [c.responsavelId] : [],
          tipo: "chamado_atribuido",
          assunto: `${ref} · atribuído a você`,
          corpo:
            `O chamado ${c.codigo} — ${c.titulo} — foi atribuído a você.\n` +
            `Prioridade: ${c.prioridade} · Prazo de solução: ${prazo}\n\n${c.descricao}` +
            RODAPE,
        },
      ];
    case "atividade":
      return [
        {
          para: equipe,
          tipo: "chamado_atividade",
          assunto: `${ref} · nova atividade`,
          corpo:
            `${extra.autorNome ?? "Alguém"} registrou uma atividade no chamado ${c.codigo}:\n\n` +
            `${extra.texto ?? ""}` +
            RODAPE,
        },
      ];
    case "resolvido":
      return [
        {
          para: [c.solicitanteId],
          tipo: "chamado_resolvido",
          assunto: `${ref} · resolvido`,
          corpo:
            `O seu chamado ${c.codigo} — ${c.titulo} — foi resolvido.\n\n` +
            `Solução: ${c.descricaoEncerramento ?? "—"}\n\n` +
            `Entre no BeagleOne para confirmar a solução e fechar o chamado, ou reabri-lo se o ` +
            `problema continuar. Sem resposta em 3 dias úteis, ele será fechado automaticamente.` +
            RODAPE,
        },
        {
          para: equipe,
          tipo: "chamado_status",
          assunto: `${ref} · resolvido`,
          corpo:
            `O chamado ${c.codigo} — ${c.titulo} — foi resolvido e aguarda a confirmação do ` +
            `solicitante.\n\nSolução: ${c.descricaoEncerramento ?? "—"}` +
            RODAPE,
        },
      ];
    case "reaberto":
      return [
        {
          para: equipe,
          tipo: "chamado_reaberto",
          assunto: `${ref} · reaberto pelo solicitante`,
          corpo:
            `O solicitante reabriu o chamado ${c.codigo} — ${c.titulo}.\n\n` +
            `Motivo: ${extra.texto ?? "—"}` +
            RODAPE,
        },
      ];
  }
}

/**
 * Enfileira e tenta enviar na hora os avisos de um evento do chamado.
 * Nunca lança erro: falha de e-mail não pode desfazer a ação.
 */
export async function avisarChamado(
  evento: EventoChamado,
  chamadoId: string,
  autorId: string,
  extra: { texto?: string | undefined; autorNome?: string | undefined } = {},
): Promise<void> {
  try {
    const { buscarChamado } = await import("@/repositories/chamados.repo");
    const c = await buscarChamado(chamadoId);
    if (!c) return;

    const equipe = await atendimento(c);
    const lista = mensagens(evento, c, equipe, extra)
      .map((m) => ({ ...m, para: [...new Set(m.para)].filter((id) => id && id !== autorId) }))
      .filter((m) => m.para.length > 0);
    if (lista.length === 0) return;

    // E-mail é dado de contato: lido com a chave de serviço, mas só de
    // quem já foi escolhido acima (membros da própria empresa).
    const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const ids = [...new Set(lista.flatMap((m) => m.para))];
    const { data: pessoas } = await getSupabaseAdmin()
      .from("usuarios")
      .select("id, email")
      .in("id", ids)
      .eq("ativo", true);
    const emailDe = new Map((pessoas ?? []).map((p) => [p.id as string, p.email as string | null]));

    const { enfileirar } = await import("@/repositories/notificacoes.repo");
    for (const m of lista) {
      for (const id of m.para) {
        const email = emailDe.get(id);
        if (!email) continue;
        await enfileirar({
          tipo: m.tipo,
          destinatarioId: id,
          destinatarioEmail: email,
          assunto: m.assunto,
          corpo: m.corpo,
          referenciaTipo: "chamado",
          referenciaId: c.id,
        });
      }
    }

    // Envia na hora. Se o SMTP falhar, a fila guarda para nova tentativa.
    const { processarFila } = await import("@/services/notificacoes.server");
    await processarFila();
  } catch (e) {
    console.error(`Falha ao avisar evento "${evento}" do chamado ${chamadoId}`, e);
  }
}