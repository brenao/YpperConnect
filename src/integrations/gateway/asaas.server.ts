import type { EventoPagamento, GatewayPagamento, TipoEventoPagamento } from "./tipos";

/**
 * Adaptador do Asaas (API v3). SOMENTE SERVIDOR.
 *
 * Ambiente: ASAAS_URL (padrão: sandbox), ASAAS_API_KEY e
 * ASAAS_WEBHOOK_TOKEN (o mesmo token configurado no webhook do Asaas,
 * que ele envia no cabeçalho asaas-access-token).
 */

const URL_PADRAO = "https://api-sandbox.asaas.com/v3";

function config() {
  return {
    url: (process.env["ASAAS_URL"] ?? URL_PADRAO).replace(/\/$/, ""),
    chave: process.env["ASAAS_API_KEY"] ?? "",
    tokenWebhook: process.env["ASAAS_WEBHOOK_TOKEN"] ?? "",
  };
}

async function chamar<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown) {
  const { url, chave } = config();
  const r = await fetch(`${url}${caminho}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      access_token: chave,
      "user-agent": "BeagleOne",
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Asaas ${metodo} ${caminho}: ${r.status} ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : {}) as T;
}

const EVENTOS: Record<string, TipoEventoPagamento> = {
  PAYMENT_CREATED: "pagamento_criado",
  PAYMENT_CONFIRMED: "pagamento_confirmado",
  PAYMENT_RECEIVED: "pagamento_confirmado",
  PAYMENT_OVERDUE: "pagamento_vencido",
  PAYMENT_REFUNDED: "pagamento_estornado",
  SUBSCRIPTION_DELETED: "assinatura_cancelada",
  SUBSCRIPTION_INACTIVATED: "assinatura_cancelada",
};

const METODOS: Record<string, "pix" | "boleto" | "cartao"> = {
  PIX: "pix",
  BOLETO: "boleto",
  CREDIT_CARD: "cartao",
};

/** Comparação em tempo constante: não vaza o token por tempo de resposta. */
function iguais(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export const asaas: GatewayPagamento = {
  nome: "asaas",

  configurado: () => config().chave !== "",

  async criarCliente(d) {
    const r = await chamar<{ id: string }>("POST", "/customers", {
      name: d.nome,
      email: d.email,
      cpfCnpj: d.cpfCnpj.replace(/\D/g, ""),
    });
    return r.id;
  },

  async criarAssinatura(d) {
    const r = await chamar<{ id: string }>("POST", "/subscriptions", {
      customer: d.cliente,
      // O cliente escolhe Pix, boleto ou cartão na página da cobrança.
      billingType: "UNDEFINED",
      value: Math.round(d.valorCentavos) / 100,
      nextDueDate: d.primeiroVencimento,
      cycle: d.ciclo === "anual" ? "YEARLY" : "MONTHLY",
      description: d.descricao,
      externalReference: d.referencia,
    });
    return r.id;
  },

  async cancelarAssinatura(id) {
    await chamar("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
  },

  webhookAutentico(headers) {
    const esperado = config().tokenWebhook;
    return esperado !== "" && iguais(headers.get("asaas-access-token") ?? "", esperado);
  },

  normalizarEvento(corpo) {
    const c = corpo as Record<string, unknown>;
    const evento = String(c["event"] ?? "");
    const tipo = EVENTOS[evento];
    if (!tipo) return null;

    if (tipo === "assinatura_cancelada") {
      const s = (c["subscription"] ?? {}) as Record<string, unknown>;
      if (!s["id"]) return null;
      return {
        eventoId: String(c["id"] ?? `${evento}:${String(s["id"])}`),
        tipo,
        payload: { assinatura: String(s["id"]) },
      };
    }

    const p = (c["payment"] ?? {}) as Record<string, unknown>;
    if (!p["subscription"] || !p["id"]) return null;
    const pagoEm = (p["confirmedDate"] ?? p["paymentDate"]) as string | undefined;
    const ev: EventoPagamento = {
      eventoId: String(c["id"] ?? `${evento}:${String(p["id"])}`),
      tipo,
      payload: {
        assinatura: String(p["subscription"]),
        fatura: String(p["id"]),
        valor_centavos: Math.round(Number(p["value"] ?? 0) * 100),
        vencimento: String(p["dueDate"] ?? ""),
        pago_em: pagoEm ? `${pagoEm}T12:00:00-03:00` : undefined,
        metodo: METODOS[String(p["billingType"] ?? "")],
        link: (p["invoiceUrl"] as string | undefined) ?? undefined,
      },
    };
    return ev;
  },
};