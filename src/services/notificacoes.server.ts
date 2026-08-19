import nodemailer from "nodemailer";
import { listarPendentes, marcarEnviada, marcarErro } from "@/repositories/notificacoes.repo";

/**
 * Processador da fila de e-mails. SOMENTE SERVIDOR.
 *
 * Deliberadamente simples: uma passada por vez, sem concorrência. O
 * volume de um ITSM interno não justifica worker dedicado, e serializar
 * evita estourar limite de conexões do relay corporativo.
 */

let transporter: nodemailer.Transporter | undefined;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env["SMTP_HOST"];
  if (!host) throw new Error("SMTP_HOST não configurado");

  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASSWORD"];

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env["SMTP_PORT"] ?? 587),
    secure: process.env["SMTP_SECURE"] === "true",
    // Relay interno costuma ser anônimo; só autentica se houver usuário.
    ...(user && pass ? { auth: { user, pass } } : {}),
    tls: {
      // Relay corporativo frequentemente usa certificado interno.
      rejectUnauthorized: process.env["SMTP_REJECT_UNAUTHORIZED"] !== "false",
    },
  });

  return transporter;
}

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

  const t = getTransporter();
  const from = process.env["SMTP_FROM"] ?? "Beagle One <noreply@localhost>";

  for (const n of pendentes) {
    try {
      await t.sendMail({
        from,
        to: n.destinatarioEmail,
        subject: n.assunto,
        text: n.corpo ?? n.assunto,
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

/** Testa a conexão sem enviar nada. Útil para validar o relay. */
export async function testarConexao(): Promise<void> {
  await getTransporter().verify();
}
