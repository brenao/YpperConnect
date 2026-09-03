import * as React from "react";
import type { ComponentType } from "react";
import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { TEMPLATES, type DadosTemplate } from "./registry";

// Somente servidor: lê as variáveis SMTP_*. Nunca importar de componente cliente.

export type SendTemplateEmailResult =
  { sent: true } | { sent: false; reason: "recipient_suppressed" };

export interface SendTemplateEmailOptions {
  templateData?: DadosTemplate;
  /** Mantido por compatibilidade de assinatura; SMTP não deduplica. */
  idempotencyKey?: string;
  replyTo?: string;
}

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

/**
 * Renderiza um template registrado e envia pelo relay SMTP da empresa.
 * Diferente do serviço gerenciado anterior, não há supressão de
 * destinatário nem retentativa automática — se precisar, a fila fica na
 * tabela `notificacoes`.
 */
export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {},
): Promise<SendTemplateEmailResult> {
  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(
      `Template '${templateName}' não encontrado. Disponíveis: ${Object.keys(TEMPLATES).join(", ")}`,
    );
  }

  const recipient = template.to || to;
  if (!recipient) {
    throw new Error("Destinatário é obrigatório (o template não define endereço fixo)");
  }

  const templateData = options.templateData ?? {};

  // A única conversão do módulo. O registro é heterogêneo — cada
  // template tem props próprias — e o TypeScript não consegue expressar
  // isso num Record. Quem registra um template é responsável por
  // alimentar as props certas.
  const Componente = template.component as ComponentType<DadosTemplate>;
  const element = React.createElement(Componente, templateData);

  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject =
    typeof template.subject === "function" ? template.subject(templateData) : template.subject;

  await getTransporter().sendMail({
    from: process.env["SMTP_FROM"] ?? "YpperConnect <noreply@localhost>",
    to: recipient,
    subject,
    html,
    text,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
  });

  return { sent: true };
}
