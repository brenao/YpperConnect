import oracledb from "oracledb";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

console.log("--- Ambiente ---");
console.log("ORA_SDTZ:", process.env.ORA_SDTZ ?? "(não definido)");
console.log("Fuso do Node:", Intl.DateTimeFormat().resolvedOptions().timeZone);
console.log("Offset do Node (min):", new Date().getTimezoneOffset());

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
});

const tz = await conn.execute("SELECT DBTIMEZONE, SESSIONTIMEZONE FROM dual");
console.log("DBTIMEZONE:", tz.rows[0].DBTIMEZONE);
console.log("SESSIONTIMEZONE:", tz.rows[0].SESSIONTIMEZONE);

// Tabela descartável com os dois tipos, para comparar comportamento.
try {
  await conn.execute("DROP TABLE t_fuso PURGE");
} catch {
  /* não existia */
}
await conn.execute(`CREATE TABLE t_fuso (
  rotulo VARCHAR2(20),
  com_tz TIMESTAMP WITH LOCAL TIME ZONE,
  sem_tz TIMESTAMP
)`);

// Data conhecida: 12/08/2026 08:40 no fuso LOCAL da máquina.
const alvo = new Date(2026, 7, 12, 8, 40, 0);

console.log("\n--- O que estamos gravando ---");
console.log("Date local :", alvo.toLocaleString("pt-BR"));
console.log("Date ISO   :", alvo.toISOString());

await conn.execute(
  "INSERT INTO t_fuso (rotulo, com_tz, sem_tz) VALUES ('teste', :d1, :d2)",
  { d1: alvo, d2: alvo },
  { autoCommit: true },
);

const lido = await conn.execute(`
  SELECT TO_CHAR(com_tz, 'DD/MM/YYYY HH24:MI') AS txt_com_tz,
         TO_CHAR(sem_tz, 'DD/MM/YYYY HH24:MI') AS txt_sem_tz,
         com_tz AS obj_com_tz,
         sem_tz AS obj_sem_tz
    FROM t_fuso`);

const r = lido.rows[0];

console.log("\n--- O que o Oracle ARMAZENOU (TO_CHAR, texto puro) ---");
console.log("TIMESTAMP WITH LOCAL TIME ZONE:", r.TXT_COM_TZ);
console.log("TIMESTAMP (sem fuso)          :", r.TXT_SEM_TZ);

console.log("\n--- O que o driver DEVOLVE como Date ---");
console.log(
  "com_tz local:",
  r.OBJ_COM_TZ.toLocaleString("pt-BR"),
  "| ISO:",
  r.OBJ_COM_TZ.toISOString(),
);
console.log(
  "sem_tz local:",
  r.OBJ_SEM_TZ.toLocaleString("pt-BR"),
  "| ISO:",
  r.OBJ_SEM_TZ.toISOString(),
);

console.log("\n--- Veredito ---");
console.log("Alvo era 12/08/2026 08:40 em horário local.");
console.log("Se TO_CHAR mostrar 08:40, a gravação está certa.");
console.log("Se o Date devolvido mostrar 08:40 local, a leitura está certa.");

await conn.execute("DROP TABLE t_fuso PURGE");
await conn.close();
