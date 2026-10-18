import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Portal do afiliado: os próprios números (o banco confere quem é). */

export interface PortalAfiliado {
  codigo: string;
  nome: string;
  tipo: "afiliado" | "parceiro";
  comissaoPct: number;
  descontoPct: number;
  mesesRecorrencia: number;
  /** walletId da conta Asaas (split); null = recebe por pagamento manual. */
  carteira: string | null;
  cliques30d: number;
  cliquesTotal: number;
  vendas: { emTeste: number; ativas: number; canceladas: number; receitaMensalCentavos: number };
  clientes: {
    empresa: string;
    plano: string;
    usuarios: number;
    ciclo: string;
    status: string;
    cupom: string | null;
    desde: string | null;
    valorMensalCentavos: number;
    comissaoAte: string | null;
    comissoesCentavos: number;
  }[];
  totais: { prevista: number; liberada: number; paga: number; mes: number };
  comissoes: {
    empresa: string;
    valorCentavos: number;
    status: string;
    viaSplit: boolean;
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
    const vendas = (j["vendas"] ?? {}) as Record<string, number>;
    return {
      codigo: j["codigo"] as string,
      nome: j["nome"] as string,
      tipo: j["tipo"] as PortalAfiliado["tipo"],
      comissaoPct: Number(j["comissao_pct"]),
      descontoPct: Number(j["desconto_pct"] ?? 0),
      mesesRecorrencia: Number(j["meses_recorrencia"]),
      carteira: (j["carteira"] as string | null) ?? null,
      cliques30d: Number(j["cliques_30d"] ?? 0),
      cliquesTotal: Number(j["cliques_total"] ?? 0),
      vendas: {
        emTeste: Number(vendas["em_teste"] ?? 0),
        ativas: Number(vendas["ativas"] ?? 0),
        canceladas: Number(vendas["canceladas"] ?? 0),
        receitaMensalCentavos: Number(vendas["receita_mensal_centavos"] ?? 0),
      },
      clientes: ((j["clientes"] ?? []) as Record<string, unknown>[]).map((c) => ({
        empresa: c["empresa"] as string,
        plano: (c["plano"] as string) ?? "—",
        usuarios: Number(c["usuarios"] ?? 0),
        ciclo: (c["ciclo"] as string) ?? "",
        status: c["status"] as string,
        cupom: (c["cupom"] as string | null) ?? null,
        desde: (c["desde"] as string | null) ?? null,
        valorMensalCentavos: Number(c["valor_mensal_centavos"] ?? 0),
        comissaoAte: (c["comissao_ate"] as string | null) ?? null,
        comissoesCentavos: Number(c["comissoes_centavos"] ?? 0),
      })),
      totais: {
        prevista: Number(totais["prevista"] ?? 0),
        liberada: Number(totais["liberada"] ?? 0),
        paga: Number(totais["paga"] ?? 0),
        mes: Number(totais["mes"] ?? 0),
      },
      comissoes: ((j["comissoes"] ?? []) as Record<string, unknown>[]).map((c) => ({
        empresa: c["empresa"] as string,
        valorCentavos: Number(c["valor_centavos"]),
        status: c["status"] as string,
        viaSplit: c["via_split"] === true,
        competencia: c["competencia"] as string,
        liberarEm: (c["liberar_em"] as string | null) ?? null,
        pagoEm: (c["pago_em"] as string | null) ?? null,
      })),
    };
  },
);
/** O afiliado informa (ou remove) o walletId da conta Asaas dele. */
export const salvarCarteiraFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ carteira: z.string().trim().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
    const { error } = await getSupabaseServerClient().rpc("salvar_carteira_afiliado", {
      p_carteira: data.carteira,
    });
    if (error) {
      const { ErroDominio } = await import("@/repositories/tipos");
      if (error.code === "22023" || error.code === "42501") throw new ErroDominio(error.message);
      throw new Error(error.message);
    }
    return { ok: true };
  });