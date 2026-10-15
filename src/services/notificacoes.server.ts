import nodemailer from "nodemailer";
import { listarPendentes, marcarEnviada, marcarErro } from "@/repositories/notificacoes.repo";

/**
 * Processador da fila de e-mails. SOMENTE SERVIDOR.
 *
 * Dois provedores, escolhidos pelo ambiente:
 *   - RESEND_API_KEY definida: Resend (API HTTP). Recomendado para o SaaS.
 *   - senão: SMTP (SMTP_HOST etc.), como no legado.
 *
 * Uma passada por vez, sem concorrência: o volume não justifica worker
 * dedicado, e serializar evita estourar limite do provedor.
 */

interface Mensagem {
  id: string;
  para: string;
  assunto: string;
  texto: string;
}

interface Provedor {
  nome: "resend" | "smtp";
  enviar(m: Mensagem): Promise<void>;
  testar(): Promise<void>;
}

function remetente(): string {
  return process.env["EMAIL_FROM"] ?? process.env["SMTP_FROM"] ?? "BeagleOne <noreply@localhost>";
}

// ------------------------------------------------------------------ Resend

const RESEND_URL = "https://api.resend.com";

const resend: Provedor = {
  nome: "resend",

  async enviar(m) {
    const r = await fetch(`${RESEND_URL}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env["RESEND_API_KEY"]}`,
        "content-type": "application/json",
        // Reenvio da mesma notificação (falha de rede, nova tentativa) não
        // gera e-mail duplicado: o Resend ignora a chave repetida por 24h.
        "idempotency-key": `notificacao-${m.id}`,
      },
      body: JSON.stringify({ from: remetente(), to: [m.para], subject: m.assunto, text: m.texto }),
    });
    if (!r.ok) {
      const corpo = await r.text();
      throw new Error(`Resend ${r.status}: ${corpo.slice(0, 300)}`);
    }
  },

  async testar() {
    const r = await fetch(`${RESEND_URL}/domains`, {
      headers: { authorization: `Bearer ${process.env["RESEND_API_KEY"]}` },
    });
    if (r.ok) return;
    const corpo = await r.text();
    // Chave "só envio" (a recomendada) não lista domínios, mas é válida.
    if (r.status === 401 && corpo.includes("restricted_api_key")) return;
    throw new Error(`Resend ${r.status}: ${corpo.slice(0, 300)}`);
  },
};

// -------------------------------------------------------------------- SMTP

let transporter: nodemailer.Transporter | undefined;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env["SMTP_HOST"];
  if (!host) throw new Error("E-mail não configurado: defina RESEND_API_KEY ou SMTP_HOST");

  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASSWORD"];

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env["SMTP_PORT"] ?? 587),
    secure: process.env["SMTP_SECURE"] === "true",
    // Relay interno costuma ser anônimo; só autentica se houver usuário.
    ...(user && pass ? { auth: { user, pass } } : {}),
    tls: {
      rejectUnauthorized: process.env["SMTP_REJECT_UNAUTHORIZED"] !== "false",
    },
  });

  return transporter;
}

const smtp: Provedor = {
  nome: "smtp",
  async enviar(m) {
    await getTransporter().sendMail({
      from: remetente(),
      to: m.para,
      subject: m.assunto,
      text: m.texto,
    });
  },
  async testar() {
    await getTransporter().verify();
  },
};

/** Provedor ativo: Resend se houver chave, senão SMTP. */
export function provedorEmail(): Provedor {
  return process.env["RESEND_API_KEY"] ? resend : smtp;
}

// -------------------------------------------------------------------- fila

export interface ResultadoFila {
  processadas: number;
  enviadas: number;
  falhas: number;
  erros: string[];
}

export async function processarFila(): Promise<ResultadoFila> {
  const pendentes = await listarPendentes(25);
  const r: ResultadoFila = { processadas: pendentes.length, enviadas: 0, falhas: 0, erros: [] };
  if (pendentes.length === 0) return r;

  const p = provedorEmail();
  for (const n of pendentes) {
    try {
      await p.enviar({
        id: n.id,
        para: n.destinatarioEmail,
        assunto: n.assunto,
        texto: n.corpo ?? n.assunto,
      });
      await marcarEnviada(n.id);
      r.enviadas++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await marcarErro(n.id, msg);
      r.falhas++;
      if (r.erros.length < 3) r.erros.push(msg);
    }
  }

  return r;
}

/** Testa o provedor sem enviar nada (botão "Testar conexão"). */
export async function testarConexao(): Promise<void> {
  await provedorEmail().testar();
}