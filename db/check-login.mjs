import oracledb from "oracledb";
import { readFileSync } from "node:fs";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
});

const r = await conn.execute("SELECT id, nome, login, perfil_id, admin FROM usuarios");
await conn.close();

console.log("Usuários no banco:");
for (const u of r.rows) {
  console.log(`  ${u.ID} | ${u.NOME} | login=[${u.LOGIN}] | ${u.PERFIL_ID} | admin=${u.ADMIN}`);
}

// Extrai a constante do código e compara com o banco
const src = readFileSync("src/services/current-user.server.ts", "utf8");
const m = src.match(/LOGIN_PROVISORIO\s*=\s*"([^"]*)"/);
const noCodigo = m ? m[1].replace(/\\\\/g, "\\") : null;

console.log(`\nLOGIN_PROVISORIO no código: [${noCodigo}]`);

const bate = r.rows.some((u) => u.LOGIN === noCodigo);
console.log(
  bate
    ? "\nOK: o login casa. A aplicação vai encontrar o usuário."
    : "\nERRO: nenhum usuário com esse login. getUsuarioAtual() vai falhar.",
);
