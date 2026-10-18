// Apaga DE VERDADE empresas de teste: dados no banco, assinatura e
// cliente no Asaas e contas de login que nao tem outro vinculo.
// Excecao consciente a regra de exclusao logica: so para dados de teste.
//
// Uso (na raiz do projeto):
//   node --env-file=.env scripts/apagar-empresas.mjs bfa-digital luciana-westin
//       -> SIMULACAO: mostra o que seria apagado, nao muda nada
//   node --env-file=.env scripts/apagar-empresas.mjs bfa-digital luciana-westin --executar
//       -> apaga
//
// Tudo no banco roda numa transacao so: se qualquer passo falhar, nada muda.
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const executar = args.includes("--executar");
const slugs = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());

const e = process.env;
if (slugs.length === 0) {
  console.error("Informe os slugs. Ex.: scripts/apagar-empresas.mjs bfa-digital luciana-westin");
  process.exit(1);
}
for (const v of ["SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!e[v]) {
    console.error(`Falta ${v} no .env`);
    process.exit(1);
  }
}

const db = new pg.Client({ connectionString: e.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const admin = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function asaas(metodo, caminho) {
  if (!e.ASAAS_URL || !e.ASAAS_API_KEY) return "sem ASAAS_URL/ASAAS_API_KEY";
  const r = await fetch(`${e.ASAAS_URL}${caminho}`, {
    method: metodo,
    headers: { access_token: e.ASAAS_API_KEY, "User-Agent": "BeagleOne" },
  });
  return r.ok || r.status === 404 ? null : `${r.status} ${(await r.text()).slice(0, 200)}`;
}

await db.connect();
let bancoAlterado = false;
try {
  // ---------------------------------------------------------------- alvo
  const { rows: empresas } = await db.query(
    `select id, slug, nome from public.tenants where slug = any($1)`,
    [slugs],
  );
  const faltando = slugs.filter((s) => !empresas.some((t) => t.slug === s));
  if (faltando.length) throw new Error(`Slug nao encontrado: ${faltando.join(", ")}`);
  const ids = empresas.map((t) => t.id);
  console.log("Empresas:", empresas.map((t) => `${t.nome} (${t.slug})`).join(", "));

  // Tabelas com tenant_id (schemas do app), com a contagem de linhas.
  const { rows: tabelas } = await db.query(
    `select c.table_schema as s, c.table_name as t
       from information_schema.columns c
       join information_schema.tables tb
         on tb.table_schema = c.table_schema and tb.table_name = c.table_name
      where c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
        and c.table_schema in ('public', 'app')
      order by 1, 2`,
  );
  const contagem = [];
  for (const { s, t } of tabelas) {
    const r = await db.query(`select count(*)::int as n from "${s}"."${t}" where tenant_id = any($1)`, [ids]);
    if (r.rows[0].n > 0) contagem.push({ tabela: `${s}.${t}`, linhas: r.rows[0].n });
  }
  console.table(contagem);

  // Assinaturas no gateway.
  const { rows: assinaturas } = await db.query(
    `select id, gateway, gateway_cliente_id, gateway_assinatura_id
       from public.assinaturas where tenant_id = any($1)`,
    [ids],
  );

  // Contas de login so destas empresas (sem outra empresa, nao operador
  // da plataforma, nao afiliado): saem junto.
  const { rows: contas } = await db.query(
    `select distinct u.id, u.email
       from public.tenant_membros m
       join public.usuarios u on u.id = m.usuario_id
      where m.tenant_id = any($1)
        and not exists (select 1 from public.tenant_membros o
                         where o.usuario_id = m.usuario_id and not (o.tenant_id = any($1)))
        and not exists (select 1 from public.plataforma_admins p where p.usuario_id = m.usuario_id)
        and not exists (select 1 from public.afiliados a where a.usuario_id = m.usuario_id)`,
    [ids],
  );
  console.log("Contas de login a apagar:", contas.map((c) => c.email).join(", ") || "nenhuma");
  console.log(
    "Asaas:",
    assinaturas.filter((a) => a.gateway_assinatura_id).length,
    "assinatura(s) a cancelar e cliente(s) a remover",
  );

  if (!executar) {
    console.log("\nSIMULACAO: nada foi alterado. Para apagar, repita com --executar");
    process.exit(0);
  }

  // --------------------------------------------------------------- banco
  // replica: desliga os gatilhos (inclusive o que barra exclusao fisica)
  // so nesta transacao.
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query(
    `delete from public.comissoes
      where assinatura_id in (select id from public.assinaturas where tenant_id = any($1))`,
    [ids],
  );
  for (const { s, t } of tabelas) {
    await db.query(`delete from "${s}"."${t}" where tenant_id = any($1)`, [ids]);
  }
  await db.query(`delete from public.tenants where id = any($1)`, [ids]);
  await db.query("commit");
  bancoAlterado = true;
  console.log("✔ Banco: empresas e dados apagados");

  // --------------------------------------------------------------- Asaas
  for (const a of assinaturas) {
    if (a.gateway !== "asaas") continue;
    if (a.gateway_assinatura_id) {
      const erro = await asaas("DELETE", `/subscriptions/${a.gateway_assinatura_id}`);
      console.log(erro ? `✘ Asaas assinatura: ${erro}` : "✔ Asaas: assinatura cancelada");
    }
    if (a.gateway_cliente_id) {
      const erro = await asaas("DELETE", `/customers/${a.gateway_cliente_id}`);
      console.log(erro ? `✘ Asaas cliente: ${erro}` : "✔ Asaas: cliente removido");
    }
  }

  // --------------------------------------------------------- contas login
  for (const c of contas) {
    try {
      const { error } = await admin.auth.admin.deleteUser(c.id);
      if (error) throw error;
      console.log(`✔ Login apagado: ${c.email}`);
    } catch (err) {
      console.log(`✘ Login ${c.email}: ${err.message}`);
    }
  }
  console.log("Pronto.");
} catch (err) {
  if (!bancoAlterado) await db.query("rollback").catch(() => {});
  console.error("✘", err.message, bancoAlterado ? "" : "\nNada foi alterado no banco.");
  process.exitCode = 1;
} finally {
  await db.end();
}
