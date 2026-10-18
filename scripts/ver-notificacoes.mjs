// Mostra as ultimas notificacoes da fila de e-mail.
// Uso (na raiz do projeto):
//   node --env-file=.env scripts/ver-notificacoes.mjs              -> boas_vindas
//   node --env-file=.env scripts/ver-notificacoes.mjs todas        -> qualquer tipo
//   node --env-file=.env scripts/ver-notificacoes.mjs chamado_criado 20
import pg from "pg";

const tipo = process.argv[2] ?? "boas_vindas";
const limite = Number(process.argv[3] ?? 5);

if (!process.env.SUPABASE_DB_URL) {
  console.error("Falta SUPABASE_DB_URL no .env");
  process.exit(1);
}

const cliente = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await cliente.connect();
  const { rows } = await cliente.query(
    `select to_char(n.criado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as criado,
            n.tipo, n.destinatario_email as para, n.status, n.tentativas, n.erro,
            t.nome as empresa
       from public.notificacoes n
       join public.tenants t on t.id = n.tenant_id
      where $1 = 'todas' or n.tipo = $1
      order by n.criado_em desc
      limit $2`,
    [tipo, limite],
  );
  if (rows.length === 0) console.log(`Nenhuma notificacao do tipo "${tipo}".`);
  else console.table(rows);
} catch (e) {
  console.error("Erro:", e.message);
  process.exitCode = 1;
} finally {
  await cliente.end();
}