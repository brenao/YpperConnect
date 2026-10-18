// Reenvia ao afiliado o cupom e o acesso ao portal, com link novo.
// Uso (na raiz do projeto):
//   node --env-file=.env scripts/reenviar-convite-afiliado.mjs LUCIANA20
import pg from "pg";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://beagleone.vercel.app";
const codigo = (process.argv[2] ?? "").trim().toUpperCase();
if (!codigo) {
  console.error("Informe o cupom. Ex.: scripts/reenviar-convite-afiliado.mjs LUCIANA20");
  process.exit(1);
}

const e = process.env;
for (const v of ["SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SMTP_HOST", "SMTP_FROM"]) {
  if (!e[v]) {
    console.error(`Falta ${v} no .env`);
    process.exit(1);
  }
}

const db = new pg.Client({ connectionString: e.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const { rows } = await db.query(
    `select f.codigo, f.nome, f.email, coalesce(f.desconto_pct, 0) as desconto,
            u.last_sign_in_at is not null as ja_entrou
       from public.afiliados f
       left join auth.users u on u.id = f.usuario_id
      where upper(f.codigo) = $1`,
    [codigo],
  );
  const f = rows[0];
  if (!f) throw new Error(`Afiliado com cupom ${codigo} não encontrado.`);

  let acesso = `Acesse o portal com a sua conta de sempre:\n${APP_URL}/afiliado`;
  if (!f.ja_entrou) {
    const admin = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const g = await admin.auth.admin.generateLink({ type: "magiclink", email: f.email });
    if (g.error) throw new Error(g.error.message);
    const link =
      `${APP_URL}/auth/confirm?token_hash=` +
      `${encodeURIComponent(g.data.properties.hashed_token)}&type=email`;
    acesso = `Defina sua senha e acesse o portal (o link vale uma vez e expira em 1 hora):\n${link}`;
  }

  const desconto = Number(f.desconto);
  const beneficio = desconto > 0 ? ` Quem usar o cupom ganha ${desconto}% de desconto na assinatura.` : "";
  const primeiroNome = String(f.nome).trim().split(/\s+/)[0];

  await nodemailer
    .createTransport({
      host: e.SMTP_HOST,
      port: Number(e.SMTP_PORT ?? 465),
      secure: (e.SMTP_SECURE ?? "true") === "true",
      auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
    })
    .sendMail({
      from: e.SMTP_FROM,
      to: f.email,
      subject: "Seu cupom de parceiro BeagleOne",
      text:
        `Olá, ${primeiroNome}!\n\n` +
        `Você agora é parceiro do BeagleOne. Seu cupom de indicação é ${f.codigo}: ` +
        `peça para o cliente informá-lo na contratação.${beneficio}\n\n` +
        `Link direto, que já preenche o cupom:\n${APP_URL}/contratar?cupom=${f.codigo}\n\n` +
        `${acesso}\n\n—\nBeagleOne`,
    });
  console.log(`✔ Convite enviado para ${f.email} (${f.codigo})`);
} catch (err) {
  console.error("✘", err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
