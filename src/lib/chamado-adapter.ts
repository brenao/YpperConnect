import type { Chamado } from "@/repositories/chamados.repo";
import type { Ticket } from "@/models/itsm-types";

/**
 * Converte o registro do banco para o tipo Ticket legado.
 *
 * Existe para que SlaPill, SlaPanel e os badges continuem funcionando
 * sem alteração durante a migração. Quando todas as telas estiverem no
 * banco, esses componentes passam a receber Chamado direto e este
 * arquivo é excluído.
 */

/**
 * As datas chegam como Date ou string dependendo da serialização da
 * server function. Normaliza para ISO, que é o que o Ticket espera.
 */
function paraIso(v: Date | string | null | undefined): string | undefined {
  if (!v) return undefined;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function paraTicket(c: Chamado): Ticket {
  const prazoResposta = paraIso(c.prazoResposta);
  const respondidoEm = paraIso(c.respondidoEm);

  // exactOptionalPropertyTypes: campo opcional não aceita `undefined`
  // explícito. A chave precisa ser omitida, daí o spread condicional.
  return {
    id: c.codigo,
    titulo: c.titulo,
    descricao: c.descricao,
    tipo: c.tipo,
    categoria: c.categoriaId ?? "",
    servico: c.servicoNome ?? "",
    impacto: c.impacto,
    urgencia: c.urgencia,
    prioridade: c.prioridade,
    status: c.status,
    solicitante: c.solicitanteNome ?? "",
    responsavel: c.responsavelNome ?? "",
    equipe: c.equipeNome ?? "",
    criadoEm: paraIso(c.criadoEm)!,
    prazoSla: paraIso(c.prazoSla)!,
    origem: c.origem,
    ...(c.sistemaNome ? { sistema: c.sistemaNome } : {}),
    ...(prazoResposta ? { prazoResposta } : {}),
    ...(respondidoEm ? { respondidoEm } : {}),
    ...(c.problemaVinculadoId ? { problemaVinculado: c.problemaVinculadoId } : {}),
    ...(c.descricaoEncerramento ? { descricaoEncerramento: c.descricaoEncerramento } : {}),
  };
}

/** Formata data curta para as colunas da lista. */
export function fmtDataHora(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
