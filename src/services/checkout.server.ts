import { getCookie, setCookie } from "@tanstack/react-start/server";
import { asaas } from "@/integrations/gateway/asaas.server";
import { ErroDominio } from "@/repositories/tipos";

/**
 * Checkout self-service. SOMENTE SERVIDOR. Sem usuário logado: tudo com
 * a chave de serviço, por funções do banco que só ela executa.
 *
 * Fluxo: conta do administrador → empresa em teste (14 dias) com o plano
 * escolhido → cliente e assinatura no gateway (1ª cobrança no fim do
 * teste) → e-mail de boas-vindas com o link para definir a senha.
 */

export const COOKIE_VISITANTE = "b1_visitante";
const GATEWAY = asaas;

/** Identificador anônimo do navegador, para atribuir a indicação. */
export function visitanteAtual(criar = false): string | null {
  const atual = getCookie(COOKIE_VISITANTE);
  if (atual || !criar) return atual ?? null;
  const novo = crypto.randomUUID();
  setCookie(COOKIE_VISITANTE, novo, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 60 * 60 * 24 * 180,
  });
  return novo;
}

async function admin() {
  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  return getSupabaseAdmin();
}

export async function registrarIndicacao(codigo: string, origem: string | null): Promise<void> {
  const visitante = visitanteAtual(true)!;
  await (
    await admin()
  ).rpc("registrar_indicacao", {
    p_codigo: codigo,
    p_visitante: visitante,
    p_origem: origem,
  });
}

export interface PlanoPublico {
  codigo: string;
  nome: string;
  modulo: string;
  nivel: string;
  anualCentavos: number;
  mensalCentavos: number;
  iaIncluida: boolean;
}

export async function planosPublicos(): Promise<{
  planos: PlanoPublico[];
  addonIa: { anualCentavos: number; mensalCentavos: number };
}> {
  const sb = await admin();
  const [p, a] = await Promise.all([
    sb.from("planos").select("*").eq("ativo", true).order("ordem"),
    sb.from("planos_addons").select("*").eq("codigo", "ia").single(),
  ]);
  if (p.error) throw new Error(p.error.message);
  return {
    planos: (p.data ?? []).map((x) => ({
      codigo: x.codigo as string,
      nome: x.nome as string,
      modulo: x.modulo as string,
      nivel: x.nivel as string,
      anualCentavos: Number(x.preco_anual_centavos),
      mensalCentavos: Number(x.preco_mensal_centavos),
      iaIncluida: x.ia_incluida as boolean,
    })),
    addonIa: {
      anualCentavos: Number(a.data?.preco_anual_centavos ?? 0),
      mensalCentavos: Number(a.data?.preco_mensal_centavos ?? 0),
    },
  };
}

export interface DadosCheckout {
  empresa: string;
  slug: string;
  nome: string;
  email: string;
  cpfCnpj: string;
  plano: string;
  ciclo: "mensal" | "anual";
  usuarios: number;
  addonIa: boolean;
}

function urlDoApp(): string {
  return (process.env["APP_URL"] ?? "http://localhost:8080").replace(/\/$/, "");
}

export async function criarCheckout(d: DadosCheckout): Promise<{ email: string }> {
  const slug = d.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    throw new ErroDominio("Endereço inválido: 3 a 50 caracteres, minúsculas, números e hífen.");
  }
  const documento = d.cpfCnpj.replace(/\D/g, "");
  if (documento.length !== 11 && documento.length !== 14) {
    throw new ErroDominio("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");
  }
  if (d.usuarios < 3) throw new ErroDominio("O mínimo é de 3 usuários pagantes.");

  const sb = await admin();
  const { prepararConta } = await import("@/repositories/usuarios.repo");
  const conta = await prepararConta(d.email, d.nome);

  const { data: tenantId, error } = await sb.rpc("checkout_criar_empresa", {
    p_nome: d.empresa.trim(),
    p_slug: slug,
    p_admin: conta.id,
    p_plano: d.plano,
    p_ciclo: d.ciclo,
    p_usuarios: d.usuarios,
    p_addon_ia: d.addonIa,
    p_visitante: visitanteAtual(),
  });
  if (error) {
    if (error.code === "23505")
      throw new ErroDominio("Esse endereço já está em uso. Escolha outro.");
    if (error.code === "P0001") throw new ErroDominio("Plano inválido.");
    throw new Error(error.message);
  }

  const assinatura = await sb
    .from("assinaturas")
    .select("id, teste_ate")
    .eq("tenant_id", tenantId as string)
    .neq("status", "cancelada")
    .single();

  // Gateway: cliente + assinatura, 1ª cobrança no fim do teste. Sem chave
  // configurada (desenvolvimento), a empresa fica só no teste.
  if (GATEWAY.configurado() && assinatura.data) {
    const { data: mensal } = await sb.rpc("valor_mensal_assinatura", {
      p_assinatura: assinatura.data.id,
    });
    const valor = Number(mensal ?? 0) * (d.ciclo === "anual" ? 12 : 1);
    const cliente = await GATEWAY.criarCliente({
      nome: d.empresa,
      email: d.email,
      cpfCnpj: documento,
    });
    const idAssinatura = await GATEWAY.criarAssinatura({
      cliente,
      valorCentavos: valor,
      ciclo: d.ciclo,
      primeiroVencimento: assinatura.data.teste_ate as string,
      descricao: `BeagleOne · ${d.plano} · ${d.usuarios} usuários`,
      referencia: tenantId as string,
    });
    await sb.rpc("vincular_gateway", {
      p_tenant: tenantId,
      p_gateway: GATEWAY.nome,
      p_cliente: cliente,
      p_assinatura: idAssinatura,
    });
  }

  // Boas-vindas por e-mail (nunca o link na tela: quem digitou o e-mail
  // pode não ser o dono dele).
  const corpo = conta.link
    ? `Sua empresa ${d.empresa} foi criada no BeagleOne, com 14 dias de teste grátis.\n\n` +
      `Defina sua senha e entre:\n${conta.link}\n\n—\nBeagleOne`
    : `Sua empresa ${d.empresa} foi criada no BeagleOne, com 14 dias de teste grátis.\n\n` +
      `Entre com a sua conta de sempre:\n${urlDoApp()}/login\n\n—\nBeagleOne`;
  await sb.from("notificacoes").insert({
    tenant_id: tenantId,
    tipo: "boas_vindas",
    destinatario_id: conta.id,
    destinatario_email: d.email.trim().toLowerCase(),
    assunto: `Bem-vindo ao BeagleOne · ${d.empresa}`,
    corpo,
  });
  try {
    const { processarFila } = await import("@/services/notificacoes.server");
    await processarFila();
  } catch (e) {
    console.error("Boas-vindas ficou na fila para nova tentativa:", e);
  }

  return { email: d.email.trim().toLowerCase() };
}

/** Webhook: autentica, normaliza e aplica (idempotente no banco). */
export async function receberWebhook(headers: Headers, corpo: unknown): Promise<number> {
  if (!GATEWAY.webhookAutentico(headers)) return 401;
  const ev = GATEWAY.normalizarEvento(corpo);
  if (!ev) return 200;
  const { error } = await (
    await admin()
  ).rpc("processar_evento_gateway", {
    p_gateway: GATEWAY.nome,
    p_evento_id: ev.eventoId,
    p_tipo: ev.tipo,
    p_payload: ev.payload,
  });
  if (error) {
    console.error("Falha ao processar evento do gateway:", error.message);
    return 500;
  }
  return 200;
}