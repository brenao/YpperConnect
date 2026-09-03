/**
 * Diagnóstico do banco: calendário, agendador e cadastro de recursos.
 *
 * Conecta como `ypper` mesmo. Consultar `pg_available_extensions` e
 * `SHOW` não exige superusuário — só o `CREATE EXTENSION` exigiria, e é
 * exatamente essa decisão que este script existe para informar.
 *
 * Rodar:  node --env-file=.env db/diagnostico.mjs
 */

import pg from "pg";

const cliente = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

await cliente.connect();

// O fuso é fixado por sessão, como no client.server.ts: sem isso o
// LOCALTIMESTAMP abaixo sairia no fuso do servidor e a conferência não
// diria nada sobre como a aplicação enxerga as datas.
await cliente.query(`SET TIME ZONE '${process.env.PG_TIMEZONE ?? "America/Sao_Paulo"}'`);

const banco = await cliente.query(
  "SELECT current_database() AS db, current_user AS usuario, version() AS versao",
);
const info = banco.rows[0];
console.log(`Conectado a ${info.db} em ${process.env.PG_HOST} como ${info.usuario}`);
console.log(info.versao.split(",")[0]);
console.log();

const extensoes = await cliente.query(
  `SELECT name, default_version, installed_version
     FROM pg_available_extensions
    WHERE name IN ('pg_cron', 'pg_net')
    ORDER BY name`,
);

if (extensoes.rows.length === 0) {
  console.log("pg_cron / pg_net: NAO disponiveis neste servidor.");
  console.log("  O binario nao esta instalado; CREATE EXTENSION vai falhar.");
  console.log("  Caminho recomendado: cron do sistema chamando /api/rotinas.");
} else {
  console.log("Extensoes:");
  for (const e of extensoes.rows) {
    const estado =
      e.installed_version === null
        ? `disponivel (v${e.default_version}), NAO instalada`
        : `INSTALADA (v${e.installed_version})`;
    console.log(`  ${e.name}: ${estado}`);
  }
}
console.log();

const fuso = await cliente.query("SHOW timezone");
const agora = await cliente.query("SELECT LOCALTIMESTAMP AS local, CURRENT_DATE AS hoje");

console.log("timezone da sessao:", fuso.rows[0].TimeZone);
console.log("LOCALTIMESTAMP:", agora.rows[0].local, "| CURRENT_DATE:", agora.rows[0].hoje);
console.log();

// Calendário: confirma que o 07 entrou e que o cálculo de dias úteis tem
// com o que trabalhar. Expediente vazio faz o SLA lançar exceção em vez
// de calcular errado — melhor descobrir agora que no meio do teste.
const feriados = await cliente.query(
  `SELECT COUNT(*)::int AS total,
          COUNT(CASE WHEN recorrente = 1 THEN 1 END)::int AS recorrentes,
          COUNT(CASE WHEN ativo = 1 THEN 1 END)::int AS ativos
     FROM feriados`,
);
const expediente = await cliente.query(
  `SELECT dia_semana, COUNT(*)::int AS faixas
     FROM expediente WHERE ativo = 1
    GROUP BY dia_semana ORDER BY dia_semana`,
);

console.log("feriados:", feriados.rows[0]);
console.log(
  "expediente ativo (1=seg .. 7=dom):",
  expediente.rows.map((r) => `${r.dia_semana}:${r.faixas}`).join("  ") || "(VAZIO)",
);

// A coluna `tipo` é o que o feriado municipal vai precisar distinguir.
const tipos = await cliente.query(
  `SELECT COALESCE(tipo, '(nulo)') AS tipo, COUNT(*)::int AS total
     FROM feriados GROUP BY tipo ORDER BY total DESC`,
);
console.log("feriados por tipo:", tipos.rows.map((t) => `${t.tipo}=${t.total}`).join("  "));
console.log();

// -------------------------------------------------------------------
// Recursos sem usuário vinculado.
//
// O controle de acesso a projetos descobre "tenho tarefa atribuída
// aqui" por `recursos.usuario_id`. Recurso sem esse vínculo nunca casa
// com ninguém: a pessoa deixa de ver o projeto em que trabalha, e o
// sintoma aparece como "sumiu o projeto", não como erro.
// -------------------------------------------------------------------
const recursos = await cliente.query(
  `SELECT COUNT(*) FILTER (WHERE usuario_id IS NULL)::int AS sem_usuario,
          COUNT(*)::int AS total
     FROM recursos WHERE ativo = 1`,
);
console.log("recursos ativos:", recursos.rows[0]);

const semVinculo = await cliente.query(
  `SELECT r.nome, r.papel, e.nome AS equipe
     FROM recursos r
     LEFT JOIN equipes e ON e.id = r.equipe_id
    WHERE r.ativo = 1 AND r.usuario_id IS NULL
    ORDER BY r.nome`,
);

if (semVinculo.rows.length === 0) {
  console.log("  todos os recursos ativos tem usuario vinculado.");
} else {
  console.log("  SEM usuario vinculado (nao verao os proprios projetos):");
  for (const r of semVinculo.rows) {
    console.log(
      `    - ${r.nome}${r.papel ? ` (${r.papel})` : ""}${r.equipe ? ` · ${r.equipe}` : ""}`,
    );
  }
}
console.log();

// -------------------------------------------------------------------
// Usuários sem equipe.
//
// O gestor de portfólio enxerga "os projetos do seu time", e o time sai
// de `usuarios.equipe_id`. Gestor sem equipe cai na visão de
// colaborador comum, sem aviso nenhum.
// -------------------------------------------------------------------
const semEquipe = await cliente.query(
  `SELECT COUNT(*)::int AS total FROM usuarios WHERE ativo = 1 AND equipe_id IS NULL`,
);
console.log("usuarios ativos sem equipe:", semEquipe.rows[0].total);

// Quem já tem os papéis novos de projeto atribuídos.
const papeis = await cliente.query(
  `SELECT pf.feature_key, COUNT(u.id)::int AS usuarios
     FROM perfil_features pf
     LEFT JOIN usuarios u ON u.perfil_id = pf.perfil_id AND u.ativo = 1
    WHERE pf.feature_key IN ('projetos.visao_diretoria', 'projetos.portfolio')
    GROUP BY pf.feature_key`,
);
console.log(
  "papeis de projeto:",
  papeis.rows.length === 0
    ? "(nenhum perfil tem as chaves novas ainda)"
    : papeis.rows.map((p) => `${p.feature_key}=${p.usuarios}`).join("  "),
);

await cliente.end();
