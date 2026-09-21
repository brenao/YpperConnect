import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const caminho = process.argv[2];
if (!caminho) {
  console.error("Uso: node --env-file=.env db/aplicar-migration.mjs <arquivo.sql>");
  process.exit(1);
}

const arquivo = resolve(process.cwd(), caminho);
const sql = await readFile(arquivo, "utf8");

const cliente = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

await cliente.connect();
await cliente.query(`SET TIME ZONE '${process.env.PG_TIMEZONE ?? "America/Sao_Paulo"}'`);

const banco = await cliente.query("SELECT current_database() AS db, current_user AS usuario");
console.log(`Aplicando ${caminho} em ${banco.rows[0].db} como ${banco.rows[0].usuario}`);

const inicio = Date.now();
try {
  await cliente.query(sql);
  console.log(`OK em ${Date.now() - inicio}ms`);
} catch (e) {
  const pos = Number(e.position ?? 0);
  const linha = pos > 0 ? sql.slice(0, pos).split("\n").length : null;
  console.error(`FALHOU${linha ? ` na linha ${linha}` : ""}: ${e.message}`);
  if (e.detail) console.error(`detalhe: ${e.detail}`);
  if (e.hint) console.error(`dica: ${e.hint}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
