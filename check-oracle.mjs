import oracledb from "oracledb";

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
});

const r = await conn.execute("SELECT banner FROM v$version");
console.log(r.rows);

const c = await conn.execute(
  "SELECT parameter, value FROM nls_database_parameters WHERE parameter IN ('NLS_CHARACTERSET','NLS_NCHAR_CHARACTERSET')",
);
console.log(c.rows);

await conn.close();
