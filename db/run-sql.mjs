import pg from "pg";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/**
 * Aplica um script SQL no Postgres.
 *
 * Substitui o `run-sql.mjs` do Oracle, que sumiu na migração. A
 * diferença principal: lá era preciso quebrar o arquivo por `;` porque
 * o driver executava um comando por vez. O `pg` aceita o arquivo
 * inteiro numa chamada só — o que além de mais simples é mais correto,
 * já que quebrar por `;` estraga corpo de função com `$$ ... $$` e
 * qualquer `;` dentro de string.
 *
 * Uso:
 *   node --env-file=.env db/run-sql.mjs db/postgres/05-tarefa-ativo.sql
 *   node --env-file=.env db/run-sql.mjs db/postgres/06-agendador.sql --sem-transacao
 */

const arquivo = process.argv[2];
const semTransacao = process.argv.includes("--sem-transacao");

if (!arquivo) {
  console.error("Uso: node --env-file=.env db/run-sql.mjs db/postgres/00-migrations.sql");
  console.error("     --sem-transacao   para scripts que nao podem rodar em transacao");
  process.exit(1);
}

/**
 * `node --env-file` tira as aspas do valor; `docker --env-file` nao.
 * A mesma linha funciona aqui e falha no container, com erro de
 * autenticacao que nao diz o motivo. Avisar cedo evita a cacada.
 */
function variavel(nome, obrigatoria = true) {
  const valor = process.env[nome];
  if (!valor) {
    if (!obrigatoria) return undefined;
    console.error(`Variavel de ambiente ${nome} nao configurada.`);
    process.exit(1);
  }
  if (/^["'].*["']$/.test(valor)) {
    console.warn(`Aviso: ${nome} esta entre aspas no .env. Remova-as.`);
  }
  return valor;
}

const cliente = new pg.Client({
  host: variavel("PG_HOST"),
  port: Number(variavel("PG_PORT", false) ?? 5432),
  user: variavel("PG_USER"),
  password: variavel("PG_PASSWORD"),
  database: variavel("PG_DATABASE"),
});

const sql = readFileSync(arquivo, "utf8");
const nome = basename(arquivo);

try {
  await cliente.connect();
  console.log(`Conectado a ${process.env["PG_DATABASE"]} em ${process.env["PG_HOST"]}`);

  // DDL no Postgres e transacional: se o script falhar no meio, nada
  // fica aplicado pela metade. E a diferenca que mais doi quando se
  // vem do Oracle, onde cada DDL faz commit implicito.
  if (!semTransacao) await cliente.query("BEGIN");

  console.log(`Aplicando ${nome}...`);
  await cliente.query(sql);

  if (!semTransacao) await cliente.query("COMMIT");
  console.log(`${nome} aplicado com sucesso.`);

  // Se o script registra a si mesmo em db_migrations, mostra o estado
  // resultante — e a confirmacao que interessa a quem aplicou.
  const r = await cliente.query(`SELECT arquivo, aplicado_em FROM db_migrations ORDER BY arquivo`);
  if (r.rows.length > 0) {
    console.log("\nScripts registrados:");
    for (const linha of r.rows) {
      console.log(`  ${linha.arquivo}  ${linha.aplicado_em.toISOString().slice(0, 19)}`);
    }
  }
} catch (e) {
  if (!semTransacao) {
    try {
      await cliente.query("ROLLBACK");
      console.error("Transacao desfeita: nada foi aplicado.");
    } catch {
      // Conexao ja pode ter caido; o erro original e o que importa.
    }
  }
  console.error(`\nFalha ao aplicar ${nome}:`);
  console.error(e.message);
  if (e.position) console.error(`Posicao no arquivo: caractere ${e.position}`);
  if (e.hint) console.error(`Dica do Postgres: ${e.hint}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
