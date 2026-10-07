import { createServerFn } from "@tanstack/react-start";

/** Portal do afiliado: os próprios números (o banco confere quem é). */

export interface PortalAfiliado {
  codigo: string;
  nome: string;
  tipo: "afiliado" | "parceiro";
  comissaoPct: number;
  mesesRecorrencia: number;
  cliques30d: number;
  cliquesTotal: number;
  clientes: { empresa: string; status: string; desde: string | null }[];
  totais: { prevista: number; liberada: number; paga: number };
  comissoes: {
    empresa: string;
    valorCentavos: number;
    status: string;
    competencia: string;
    liberarEm: string | null;
    pagoEm: string | null;
  }[];
}

export const meuPortalFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PortalAfiliado> => {
    const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
    const { data, error } = await getSupabaseServerClient().rpc("meu_portal_afiliado");
    if (error) throw new Error(error.code === "42501" ? "Você não é afiliado." : error.message);
    const j = data as Record<string, unknown>;
    const totais = (j["totais"] ?? {}) as Record<string, number>;
    return {
      codigo: j["codigo"] as string,
      nome: j["nome"] as string,
      tipo: j["tipo"] as PortalAfiliado["tipo"],
      comissaoPct: Number(j["comissao_pct"]),
      mesesRecorrencia: Number(j["meses_recorrencia"]),
      cliques30d: Number(j["cliques_30d"] ?? 0),
      cliquesTotal: Number(j["cliques_total"] ?? 0),
      clientes: ((j["clientes"] ?? []) as Record<string, unknown>[]).map((c) => ({
        empresa: c["empresa"] as string,
        status: c["status"] as string,
        desde: (c["desde"] as string | null) ?? null,
      })),
      totais: {
        prevista: Number(totais["prevista"] ?? 0),
        liberada: Number(totais["liberada"] ?? 0),
        paga: Number(totais["paga"] ?? 0),
      },
      comissoes: ((j["comissoes"] ?? []) as Record<string, unknown>[]).map((c) => ({
        empresa: c["empresa"] as string,
        valorCentavos: Number(c["valor_centavos"]),
        status: c["status"] as string,
        competencia: c["competencia"] as string,
        liberarEm: (c["liberar_em"] as string | null) ?? null,
        pagoEm: (c["pago_em"] as string | null) ?? null,
      })),
    };
  },
);