import { asaas } from "@/integrations/gateway/asaas.server";
import type { SplitGateway } from "@/integrations/gateway/tipos";

/**
 * Sincronização diária com o gateway. SOMENTE SERVIDOR.
 *
 * O banco diz como cada assinatura deve estar (valor do ciclo e split);
 * aqui só se aplica a diferença: fim do desconto do cupom, fim dos meses
 * de comissão (sai o split), carteira que o afiliado cadastrou depois da
 * venda (entra o split). Rodar de novo não faz nada se já está igual.
 */

const GATEWAY = asaas;

export interface ResultadoSincronizacao {
  verificadas: number;
  atualizadas: number;
  falhas: number;
  erros: string[];
}

interface EstadoDesejado {
  assinatura_id: string;
  gateway_assinatura_id: string;
  valor_ciclo_centavos: number;
  split_carteira: string | null;
  split_pct: number | null;
  mudou: boolean;
}

export async function sincronizarGateway(): Promise<ResultadoSincronizacao> {
  const r: ResultadoSincronizacao = { verificadas: 0, atualizadas: 0, falhas: 0, erros: [] };
  if (!GATEWAY.configurado()) return r;

  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("estado_gateway_desejado");
  if (error) throw new Error(error.message);

  const estados = (data ?? []) as EstadoDesejado[];
  r.verificadas = estados.length;

  for (const e of estados.filter((x) => x.mudou)) {
    let split: SplitGateway | null = e.split_carteira
      ? { carteira: e.split_carteira, pct: Number(e.split_pct) }
      : null;
    try {
      try {
        await GATEWAY.atualizarAssinatura(e.gateway_assinatura_id, {
          valorCentavos: e.valor_ciclo_centavos,
          split,
        });
      } catch (erro) {
        // Carteira recusada: ajusta só o valor; amanhã tenta o split de novo.
        if (!split) throw erro;
        console.error(`Split recusado na assinatura ${e.gateway_assinatura_id}:`, erro);
        split = null;
        await GATEWAY.atualizarAssinatura(e.gateway_assinatura_id, {
          valorCentavos: e.valor_ciclo_centavos,
          split: null,
        });
      }
      const reg = await sb.rpc("registrar_estado_gateway", {
        p_assinatura: e.assinatura_id,
        p_valor: e.valor_ciclo_centavos,
        p_carteira: split?.carteira ?? null,
        p_pct: split?.pct ?? null,
      });
      if (reg.error) throw new Error(reg.error.message);
      r.atualizadas++;
    } catch (erro) {
      r.falhas++;
      if (r.erros.length < 5) r.erros.push(erro instanceof Error ? erro.message : String(erro));
    }
  }
  return r;
}