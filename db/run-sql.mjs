import oracledb from "oracledb";
import { readFileSync } from "node:fs";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("Uso: node --env-file=.env db/run-sql.mjs db/oracle/01-schema.sql");
  process.exit(1);
}

/**
 * Divide um script SQL em comandos individuais.
 * node-oracledb executa um comando por vez e NÃO aceita o ";" final.
 * Remove comentários de linha antes de dividir, para não cortar errado.
 */
function separarComandos(sql) {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const sql = readFileSync(arquivo, "utf8");
const comandos = separarComandos(sql);

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
});

console.log(`${arquivo}: ${comandos.length} comandos\n`);

let ok = 0;
const falhas = [];

for (const [i, cmd] of comandos.entries()) {
  const rotulo = cmd.replace(/\s+/g, " ").slice(0, 70);
  try {
    await conn.execute(cmd, [], { autoCommit: true });
    console.log(`  [${i + 1}] OK   ${rotulo}`);
    ok++;
  } catch (e) {
    console.log(`  [${i + 1}] ERRO ${rotulo}`);
    console.log(`       ${e.message}`);
    falhas.push({ i: i + 1, msg: e.message });
  }
}

console.log(`\n${ok} de ${comandos.length} executados.`);
if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  falhas.forEach((f) => console.log(`  [${f.i}] ${f.msg}`));
}

await conn.close();
