import oracledb from "oracledb";

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
});

const eu = await conn.execute("SELECT USER FROM dual");
console.log("Conectado como:", eu.rows[0][0]);

const minhas = await conn.execute("SELECT table_name FROM user_tables ORDER BY table_name");
console.log("Tabelas no meu schema:", minhas.rows.flat());

await conn.close();
