// Roda os testes pgTAP de supabase/tests/database direto no banco, sem Docker.
//
// Uso (na raiz do projeto):
//   node --env-file=.env scripts/testar-banco.mjs
//       -> todos os testes
//   node --env-file=.env scripts/testar-banco.mjs 26
//       -> só os arquivos cujo nome começa com 26
//
// Cada arquivo de teste abre uma transação (begin) e desfaz tudo no fim
// (rollback): nada fica gravado. Mesmo assim, rode só no projeto de
// desenvolvimento, nunca no de produção.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const PASTA = "supabase/tests/database";
const filtro = process.argv[2] ?? "";

if (!process.env.SUPABASE_DB_URL) {
  console.error("Falta SUPABASE_DB_URL no .env");
  process.exit(1);
}

const arquivos = readdirSync(PASTA)
  .filter((f) => f.endsWith(".test.sql") && f.startsWith(filtro))
  .sort();
if (arquivos.length === 0) {
  console.error(`Nenhum teste encontrado em ${PASTA} começando com "${filtro}".`);
  process.exit(1);
}

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

let falhas = 0;
for (const arquivo of arquivos) {
  const sql = readFileSync(`${PASTA}/${arquivo}`, "utf8");
  const linhas = [];
  try {
    const resultados = [].concat(await db.query(sql));
    for (const r of resultados) {
      for (const row of r.rows ?? []) {
        for (const v of Object.values(row)) if (typeof v === "string") linhas.push(v);
      }
    }
  } catch (e) {
    linhas.push(`not ok - erro ao executar: ${e.message}`);
  } finally {
    // Garante que nada fica gravado, mesmo se o arquivo falhar no meio.
    await db.query("rollback").catch(() => {});
  }

  const saida = linhas.join("\n");
  const falhou = /(^|\n)not ok/.test(saida) || /Looks like you (failed|planned)/.test(saida);
  if (falhou) falhas++;
  console.log(`${falhou ? "✗" : "✓"} ${arquivo}`);
  if (falhou) console.log(saida.replace(/^/gm, "    "));
}

await db.end();
console.log(`\n${arquivos.length - falhas} de ${arquivos.length} arquivos de teste passaram.`);
process.exit(falhas ? 1 : 0);
