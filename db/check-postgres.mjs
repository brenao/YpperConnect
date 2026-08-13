// Diagnostico da conexao Postgres. Equivalente ao check-oracle.mjs.
//
//   node --env-file=.env db/check-postgres.mjs
//
// Faz duas coisas, nesta ordem:
//   1. testa o tradutor de binds :nome -> $1 SEM tocar no banco. Se ele
//      estiver errado, toda consulta do sistema esta errada, e o erro
//      apareceria longe daqui;
//   2. conecta e confere fuso da sessao, tabelas criadas e os tipos que
//      o driver devolve (BIGINT e NUMERIC precisam vir como number).

import {
  analisar,
  consultar,
  consultarUm,
  fecharPool,
} from "../src/integrations/postgres/client.server.ts";

let falhas = 0;

function conferir(rotulo, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${rotulo}`);
  if (!ok) {
    console.log(`      esperado: ${JSON.stringify(esperado)}`);
    console.log(`      obtido:   ${JSON.stringify(obtido)}`);
  }
}

console.log("== tradutor de binds ==");

conferir("bind simples", analisar("SELECT * FROM usuarios WHERE id = :id"), {
  texto: "SELECT * FROM usuarios WHERE id = $1",
  nomes: ["id"],
});

conferir(
  "mesmo bind duas vezes reaproveita $1",
  analisar("WHERE criado_em >= :de AND resolvido_em >= :de AND id = :id"),
  { texto: "WHERE criado_em >= $1 AND resolvido_em >= $1 AND id = $2", nomes: ["de", "id"] },
);

conferir(
  "dois-pontos dentro de texto nao vira bind",
  analisar("SELECT 'as 10:30' AS h WHERE id = :id"),
  { texto: "SELECT 'as 10:30' AS h WHERE id = $1", nomes: ["id"] },
);

conferir(
  "cast :: nao vira bind",
  analisar("SELECT prefixo || '-' || numero::text WHERE id = :id"),
  { texto: "SELECT prefixo || '-' || numero::text WHERE id = $1", nomes: ["id"] },
);

conferir(
  "comentario de linha nao vira bind",
  analisar("SELECT 1 -- olhar :depois\nWHERE id = :id"),
  { texto: "SELECT 1 -- olhar :depois\nWHERE id = $1", nomes: ["id"] },
);

conferir(
  "aspa dobrada dentro do texto nao confunde o parser",
  analisar("SELECT 'n''ao :isso' WHERE id = :id"),
  { texto: "SELECT 'n''ao :isso' WHERE id = $1", nomes: ["id"] },
);

console.log("\n== conexao ==");

try {
  const info = await consultarUm(
    `SELECT current_database() AS banco,
            current_user      AS usuario,
            current_setting('TimeZone') AS fuso,
            version()         AS versao,
            LOCALTIMESTAMP    AS agora`,
  );
  console.log(`banco:   ${info.banco}`);
  console.log(`usuario: ${info.usuario}`);
  console.log(`fuso:    ${info.fuso}`);
  console.log(`agora:   ${info.agora.toISOString()} (comparar com o relogio da tela)`);
  console.log(`versao:  ${info.versao.split(",")[0]}`);

  const tabelas = await consultar(
    `SELECT table_name AS nome
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  console.log(`\ntabelas (${tabelas.length}): ${tabelas.map((t) => t.nome).join(", ")}`);

  // BIGINT e NUMERIC voltam como string se os parsers do client nao
  // estiverem valendo. Aqui isso apareceria como "string", nao "number".
  const tipos = await consultarUm(
    `SELECT COUNT(*) AS total, 8.25::numeric AS decimal FROM usuarios`,
  );
  conferir("COUNT(*) chega como number", typeof tipos.total, "number");
  conferir("NUMERIC chega como number", typeof tipos.decimal, "number");
} catch (e) {
  falhas++;
  console.log(`FALHA na conexão: ${e.message}`);
} finally {
  await fecharPool();
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} verificação(ões) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
