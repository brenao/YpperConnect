import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Esqueci minha senha. SOMENTE SERVIDOR.
 *
 * - O link é de uso único e expira (padrão do Supabase: 1 hora). Leva
 *   token_hash, trocado por sessão no servidor (/auth/confirm), que
 *   manda para /definir-senha.
 * - Nada revela se o e-mail tem conta: a resposta e o tempo são os
 *   mesmos nos dois casos.
 * - Limite de 3 pedidos por e-mail e 10 por IP por hora (no banco,
 *   guardando só hashes).
 * - Ao salvar a senha nova, as outras sessões da pessoa são encerradas.
 */

const TEMPO_MINIMO_MS = 800;

function hash(valor: string): string {
  const sal = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  return createHash("sha256").update(`${sal}:${valor}`).digest("hex");
}

function ipDaRequisicao(): string | null {
  try {
    const h = getRequest().headers;
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip");
    return ip || null;
  } catch {
    return null;
  }
}

export async function solicitarRecuperacao(emailInformado: string): Promise<void> {
  const inicio = Date.now();
  try {
    await enviarSePuder(emailInformado.trim().toLowerCase());
  } catch (e) {
    // Falha não aparece para quem pediu (não revela nada); fica no log.
    console.error("Recuperação de senha não enviada:", e);
  }
  // Tempo parecido com e sem conta, para não dar pista pela demora.
  const resta = TEMPO_MINIMO_MS - (Date.now() - inicio);
  if (resta > 0) await new Promise((r) => setTimeout(r, resta));
}

async function enviarSePuder(email: string): Promise<void> {
  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const admin = getSupabaseAdmin();

  const ip = ipDaRequisicao();
  const { data: pode, error } = await admin.rpc("registrar_recuperacao_senha", {
    p_email_hash: hash(email),
    p_ip_hash: ip ? hash(ip) : null,
  });
  if (error) throw new Error(error.message);
  if (pode !== true) return;

  const conta = await admin.from("usuarios").select("id, nome").eq("email", email).maybeSingle();
  if (conta.error) throw new Error(conta.error.message);
  if (!conta.data) return;

  const gerado = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (gerado.error) throw new Error(gerado.error.message);

  const { montarLink } = await import("@/repositories/usuarios.repo");
  const link = montarLink(gerado.data.properties.hashed_token, "recovery");
  const nome = String(conta.data.nome ?? "").trim();
  const primeiroNome = nome.split(/\s+/)[0] || "olá";

  const { provedorEmail } = await import("@/services/notificacoes.server");
  await provedorEmail().enviar({
    id: `recuperacao-${conta.data.id as string}-${Date.now()}`,
    para: email,
    assunto: "Redefinir sua senha do BeagleOne",
    texto:
      `Olá, ${primeiroNome}!\n\n` +
      `Recebemos um pedido para redefinir a senha da sua conta no BeagleOne.\n\n` +
      `Para criar uma senha nova, abra o link abaixo. Ele vale uma única vez e expira em 1 hora:\n` +
      `${link}\n\n` +
      `Se não foi você, ignore este e-mail: sua senha atual continua valendo.\n\n—\nBeagleOne`,
  });
}
