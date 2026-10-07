/**
 * Contrato do gateway de pagamento. SOMENTE SERVIDOR.
 *
 * O checkout e o webhook falam com esta interface, não com um gateway
 * específico: trocar Asaas por Pagar.me ou Stripe é escrever outro
 * adaptador, sem mexer no resto.
 */

export type TipoEventoPagamento =
  | "pagamento_criado"
  | "pagamento_confirmado"
  | "pagamento_vencido"
  | "pagamento_estornado"
  | "assinatura_cancelada";

/** Evento já normalizado, no formato que o banco entende. */
export interface EventoPagamento {
  eventoId: string;
  tipo: TipoEventoPagamento;
  payload: {
    assinatura: string;
    fatura?: string | undefined;
    valor_centavos?: number | undefined;
    vencimento?: string | undefined;
    pago_em?: string | undefined;
    metodo?: "pix" | "boleto" | "cartao" | undefined;
    link?: string | undefined;
  };
}

export interface GatewayPagamento {
  nome: "asaas" | "pagarme" | "stripe";
  /** Gateway configurado no ambiente? Sem chave, o checkout cria só o teste. */
  configurado(): boolean;
  criarCliente(d: { nome: string; email: string; cpfCnpj: string }): Promise<string>;
  criarAssinatura(d: {
    cliente: string;
    valorCentavos: number;
    ciclo: "mensal" | "anual";
    primeiroVencimento: string;
    descricao: string;
    referencia: string;
  }): Promise<string>;
  cancelarAssinatura(id: string): Promise<void>;
  /** A requisição veio mesmo do gateway? */
  webhookAutentico(headers: Headers): boolean;
  /** Evento do gateway no formato comum, ou null se não interessa. */
  normalizarEvento(corpo: unknown): EventoPagamento | null;
}