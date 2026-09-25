/**
 * Roda uma consulta avulsa e imprime o resultado em tabela.
 *
 * Existe para a pergunta rápida — "quais colunas essa tabela tem?" —
 * sem abrir cliente gráfico nem depender do psql, que não está no PATH
 * das máquinas de desenvolvimento.
 *
 * Rodar:
 *   node --env-file=.env db/consultar.mjs "SELECT * FROM localidades"
 *   node --env-file=.env db/consultar.mjs -f caminho/consulta.sql
 *
 * Só leitura: recusa qualquer coisa que não comece com SELECT ou WITH.
 * Quem precisa escrever usa uma migration, que fica versionada — script
 * solto alterando dado é o que ninguém consegue auditar depois.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);

let sql;
if (args[0] === "-f") {
  if (!args[1]) {
    console.error("Uso: node --env-file=.env db/consultar.mjs -f <arquivo.sql>");
    process.exit(1);
  }
  sql = await readFile(resolve(process.cwd(), args[1]), "utf8");
} else {
  sql = args.join(" ");
}

if (!sql || sql.trim() === "") {
  console.error('Uso: node --env-file=.env db/consultar.mjs "SELECT ..."');
  process.exit(1);
}

const inicio = sql
  .trim()
  .replace(/^--.*$/gm, "")
  .trim()
  .slice(0, 6)
  .toUpperCase();
if (!inicio.startsWith("SELECT") && !inicio.startsWith("WITH")) {
  console.error("Este script é só de leitura: use SELECT ou WITH.");
  console.error("Para alterar dados, crie uma migration em db/postgres/.");
  process.exit(1);
}

const cliente = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

await cliente.connect();
await cliente.query(`SET TIME ZONE '${process.env.PG_TIMEZONE ?? "America/Sao_Paulo"}'`);

try {
  const r = await cliente.query(sql);

  if (r.rows.length === 0) {
    console.log("(nenhuma linha)");
  } else {
    // console.table alinha as colunas sozinho e já lida com nulo.
    console.table(r.rows);
    console.log(`${r.rows.length} linha(s)`);
  }
} catch (e) {
  console.error(`FALHOU: ${e.message}`);
  if (e.detail) console.error(`detalhe: ${e.detail}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
