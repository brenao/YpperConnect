import type { RecordType } from "@/models/itsm-types";

/**
 * Prefixo do código do chamado por tipo de registro.
 *
 * Gravado em chamados.prefixo na abertura e imutável a partir daí:
 * o código circula por e-mail e é citado pelo solicitante, então não
 * pode mudar se o chamado for reclassificado depois.
 */
export const PREFIXO_TIPO: Record<RecordType, string> = {
  incidente: "INC",
  requisicao: "REQ",
  melhoria: "DEM",
  problema: "PRO",
  tarefa: "TAR",
};
