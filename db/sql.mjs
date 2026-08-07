import oracledb from "oracledb";
import readline from "node:readline";

oracledb.fetchAsString = [oracledb.CLOB];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
});

// Mesmo fuso da aplicação, senão o console mostra horário diferente da tela.
await conn.execute(`ALTER SESSION SET TIME_ZONE = '${process.env.ORACLE_TIMEZONE ?? "-03:00"}'`);

console.log(`Conectado em ${process.env.ORACLE_SERVICE_NAME} como ${process.env.ORACLE_USER}`);
console.log("Digite SQL terminando com ';'. Ctrl+C para sair.\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "SQL> ",
});
let buffer = "";
rl.prompt();

rl.on("line", async (linha) => {
  buffer += linha + "\n";
  if (!linha.trimEnd().endsWith(";")) {
    rl.setPrompt("...> ");
    rl.prompt();
    return;
  }

  const sql = buffer.trim().replace(/;$/, "");
  buffer = "";
  rl.setPrompt("SQL> ");

  try {
    const r = await conn.execute(sql, [], { autoCommit: true });
    if (r.rows) {
      if (r.rows.length === 0) console.log("(nenhuma linha)");
      else console.table(r.rows);
    } else {
      console.log(`${r.rowsAffected ?? 0} linha(s) afetada(s).`);
    }
  } catch (e) {
    console.log(`ERRO: ${e.message}`);
  }
  console.log();
  rl.prompt();
});

rl.on("close", async () => {
  await conn.close();
  process.exit(0);
});
