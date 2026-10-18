// Lista os usuarios de cada empresa ou torna um usuario administrador.
//
// Uso (na raiz do projeto):
//   node --env-file=.env scripts/administradores.mjs
//       -> lista empresas, usuarios e quem e administrador
//   node --env-file=.env scripts/administradores.mjs promover breno.ferreira@gmail.com ypper-tech
//       -> torna administrador na empresa do slug informado
//   node --env-file=.env scripts/administradores.mjs remover fulano@x.com ypper-tech
//       -> tira o administrador
import pg from "pg";

const [acao, email, slug] = process.argv.slice(2);

if (!process.env.SUPABASE_DB_URL) {
  console.error("Falta SUPABASE_DB_URL no .env");
  process.exit(1);
}
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function listar() {
  const { rows } = await db.query(
    `select t.slug, t.nome as empresa, u.email, u.nome,
            case when m.admin then 'SIM' else '' end as admin,
            coalesce(p.nome, '') as perfil,
            case when m.ativo then '' else 'inativo' end as situacao
       from public.tenant_membros m
       join public.tenants t  on t.id = m.tenant_id and t.excluido_em is null
       join public.usuarios u on u.id = m.usuario_id
       left join public.perfis_acesso p on p.id = m.perfil_id
      order by t.nome, m.admin desc, u.email`,
  );
  console.table(rows);
}

async function definirAdmin(valor) {
  if (!email || !slug) {
    console.error(`Uso: ${acao} <email> <slug-da-empresa>`);
    process.exitCode = 1;
    return;
  }
  const r = await db.query(
    `update public.tenant_membros m
        set admin = $3, ativo = true
       from public.tenants t, public.usuarios u
      where t.id = m.tenant_id and u.id = m.usuario_id
        and t.slug = lower($2) and t.excluido_em is null
        and lower(u.email) = lower($1)
      returning t.nome as empresa`,
    [email, slug, valor],
  );
  if (r.rowCount === 0) {
    console.error(`✘ ${email} nao e membro da empresa "${slug}". Rode sem argumentos para ver a lista.`);
    process.exitCode = 1;
    return;
  }
  console.log(`✔ ${email} ${valor ? "agora e" : "deixou de ser"} administrador de ${r.rows[0].empresa}`);
  console.log("  Saia e entre de novo no BeagleOne para o menu atualizar.");
}

try {
  await db.connect();
  if (!acao) await listar();
  else if (acao === "promover") await definirAdmin(true);
  else if (acao === "remover") await definirAdmin(false);
  else {
    console.error('Acao desconhecida. Use "promover" ou "remover", ou nada para listar.');
    process.exitCode = 1;
  }
} catch (e) {
  // Ex.: limite de usuarios pagantes do plano atingido (administrador conta como pagante).
  console.error("✘", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
