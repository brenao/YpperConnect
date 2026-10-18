// Testa o login no SMTP com as credenciais do .env (nao envia e-mail).
// Uso: node --env-file=.env scripts/testar-smtp.mjs
import nodemailer from "nodemailer";

const e = process.env;
const senha = e.SMTP_PASSWORD ?? "";
console.log(`host=${e.SMTP_HOST} porta=${e.SMTP_PORT} usuario=${e.SMTP_USER}`);
console.log(`senha: ${senha.length} caracteres, termina em "${senha.slice(-2)}"`);

const t = nodemailer.createTransport({
  host: e.SMTP_HOST,
  port: Number(e.SMTP_PORT ?? 465),
  secure: (e.SMTP_SECURE ?? "true") === "true",
  auth: { user: e.SMTP_USER, pass: senha },
});

try {
  await t.verify();
  console.log("✔ Login no SMTP aceito");
} catch (err) {
  console.error("✘", err.message);
  process.exitCode = 1;
}
