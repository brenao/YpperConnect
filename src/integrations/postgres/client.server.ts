import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

/**
 * Adaptador de SQL para o Postgres do Supabase. SOMENTE SERVIDOR.
 *
 * O módulo de Projetos (e as partes de Recursos e Indicadores que leem
 * projetos) mantém o SQL do legado, com a mesma interface de antes:
 * `consultar`, `consultarUm`, `executar` e `emTransacao`. A diferença é
 * onde e como roda:
 *
 *   - Conexão direta ao Postgres do Supabase (SUPABASE_DB_URL, pooler
 *     em modo transação). Só no servidor; nunca vai para o navegador.
 *   - TODA operação roda numa transação que primeiro veste a identidade
 *     de quem chamou: papel `authenticated`, auth.uid() e a empresa
 *     ativa (`app.tenant_id`). Assim o RLS vale exatamente como no
 *     restante do sistema — o adaptador não tem caminho sem contexto.
 *   - O fuso da sessão é o da empresa: CURRENT_DATE e LOCALTIMESTAMP do
 *     SQL legado continuam significando "hoje" e "agora" para ela.
 */

pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
// DATE como Date à meia-noite local, como o legado entregava.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => new Date(`${v}T00:00:00`));

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env["SUPABASE_DB_URL"];
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL não configurada. Veja o .env.example (conexão do pooler do Supabase).",
    );
  }
  pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env["SUPABASE_DB_POOL"] ?? 5),
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
  });
  pool.on("error", (erro: Error) => {
    console.error("[postgres] erro em conexão ociosa do pool:", erro.message);
  });
  return pool;
}

export async function fecharPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

// ------------------------------------------------------------ contexto

/** Quem está agindo: define o que o RLS deixa ver e gravar. */
export interface ContextoBanco {
  usuarioId: string;
  tenantId: string;
  fuso: string;
}

const contextoExplicito = new AsyncLocalStorage<ContextoBanco>();

/**
 * Executa `fn` com um contexto definido à mão. Para rotinas sem sessão
 * de navegador (agendador, testes) que agem em nome de alguém.
 */
export function executarComo<T>(ctx: ContextoBanco, fn: () => Promise<T>): Promise<T> {
  return contextoExplicito.run(ctx, fn);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUSO = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;

/**
 * Fuso por empresa, em cache: muda quase nunca, e buscá-lo a cada
 * operação acrescentaria uma chamada ao Supabase em toda consulta.
 */
const fusoPorEmpresa = new Map<string, { fuso: string; expiraEm: number }>();
const FUSO_TTL_MS = 10 * 60_000;

async function fusoDaEmpresa(tenantId: string): Promise<string> {
  const agora = Date.now();
  const emCache = fusoPorEmpresa.get(tenantId);
  if (emCache && emCache.expiraEm > agora) return emCache.fuso;

  const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
  const { data } = await getSupabaseServerClient()
    .from("tenants")
    .select("fuso_horario")
    .eq("id", tenantId)
    .maybeSingle();
  const fuso = (data?.fuso_horario as string | undefined) ?? "America/Sao_Paulo";
  fusoPorEmpresa.set(tenantId, { fuso, expiraEm: agora + FUSO_TTL_MS });
  return fuso;
}

/**
 * Quem está agindo agora: o contexto definido por `executarComo` (rotinas
 * e testes) ou a sessão do navegador.
 */
export async function contextoDoBanco(): Promise<ContextoBanco> {
  const explicito = contextoExplicito.getStore();
  if (explicito) return explicito;

  // Sessão do navegador: a mesma leitura (uma por requisição) do resto do app.
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  const u = await getUsuarioAtual();
  return { usuarioId: u.id, tenantId: u.tenantId, fuso: await fusoDaEmpresa(u.tenantId) };
}

/**
 * Comandos que vestem a identidade, numa ida só ao banco. Os valores vêm
 * do servidor (IDs do Supabase e fuso do cadastro) e ainda assim são
 * validados antes de entrar no texto: nada aqui vem do que o usuário digita.
 */
function comandosDeSessao(c: ContextoBanco): string {
  if (!UUID.test(c.usuarioId) || !UUID.test(c.tenantId)) {
    throw new Error("Contexto de banco inválido (identificador fora do formato).");
  }
  const fuso = FUSO.test(c.fuso) ? c.fuso : "America/Sao_Paulo";
  const claims = JSON.stringify({ sub: c.usuarioId, role: "authenticated" });
  return [
    "BEGIN",
    "SET LOCAL ROLE authenticated",
    `SELECT set_config('request.jwt.claims', '${claims}', true), set_config('app.tenant_id', '${c.tenantId}', true)`,
    `SET LOCAL TIME ZONE '${fuso}'`,
  ].join("; ");
}

function normalizarValor(v: unknown): unknown {
  return v === "" ? null : v;
}

/** Converte nome_da_coluna (como o Postgres devolve) para camelCase. */
function paraCamelCase(nome: string): string {
  return nome.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function mapearLinha<T>(linha: Record<string, unknown>): T {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    saida[paraCamelCase(k)] = v;
  }
  return saida as T;
}

/**
 * Violação de regra do banco que o usuário consegue entender e resolver.
 *
 * São poucas, e todas têm a mesma natureza: o dado que a pessoa digitou
 * esbarrou numa restrição declarada no schema. Dizer "já existe" ou
 * "este registro está em uso" resolve; dizer
 * "duplicate key value violates unique constraint ux_fornecedores_nome"
 * manda a pessoa procurar a TI para traduzir o próprio erro dela.
 *
 * O código vem do Postgres e é estável entre versões.
 */
const ERROS_CONHECIDOS: Record<string, string> = {
  // unique_violation
  "23505": "Já existe um registro com esses dados. Confira e tente de novo.",
  // foreign_key_violation
  "23503":
    "Este registro está ligado a outro e não pode ser alterado ou removido enquanto o vínculo existir.",
  // not_null_violation
  "23502": "Falta preencher um campo obrigatório.",
  // check_violation
  "23514": "Um dos valores informados não é aceito neste campo.",
  // string_data_right_truncation
  "22001": "Um dos textos informados é longo demais para o campo.",
};

/**
 * Falha do banco vira mensagem em português.
 *
 * O driver devolve o texto do Postgres cru e em inglês. O usuário já
 * viu "inconsistent types deduced for parameter $2" numa caixa de
 * erro — frase que não diz nada a quem está trabalhando e ainda expõe
 * a estrutura interna do banco para quem souber ler.
 *
 * O detalhe não se perde: vai inteiro para o log do servidor, com o SQL
 * que o provocou, que é onde ele serve para diagnóstico. Na tela fica a
 * parte acionável.
 *
 * `ErroDominio`, lançado pelos repositórios, não passa por aqui: aquelas
 * mensagens foram escritas para serem lidas.
 */
function traduzirErro(erro: unknown, sql: string): never {
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  const codigo =
    typeof erro === "object" && erro !== null && "code" in erro
      ? String((erro as { code: unknown }).code)
      : "";

  console.error(
    `[postgres] falha ao executar consulta${codigo ? ` (${codigo})` : ""}: ${detalhe}\nSQL: ${sql}`,
  );

  const conhecido = ERROS_CONHECIDOS[codigo];
  if (conhecido) throw new Error(conhecido);

  // O resto é defeito nosso — SQL mal formado, tipo divergente, coluna
  // que não existe. A pessoa não tem o que fazer com o texto técnico, e
  // esconder a culpa seria pior: a mensagem diz que é problema do
  // sistema e aponta para quem resolve.
  throw new Error(
    "Não foi possível concluir a operação no banco de dados. " +
      "Isso é uma falha do sistema, não do que você digitou — avise a TI.",
  );
}

/**
 * Traducao dos binds nomeados (:nome, estilo Oracle) para posicionais
 * ($1, $2..., estilo Postgres).
 *
 * Por que traduzir em vez de reescrever as centenas de consultas: o
 * bind nomeado e legivel e resistente a erro de ordem. Reescrever tudo
 * para $1..$18 na mao, num INSERT de 19 colunas, e onde a migracao
 * quebraria sem ninguem perceber.
 *
 * O parser ignora ':' que nao e bind:
 *   - dentro de texto entre aspas simples ('as 10:30');
 *   - dentro de identificador entre aspas duplas;
 *   - em comentario -- de linha e comentario de bloco;
 *   - no cast do Postgres (numero::text), que sao dois ':' seguidos.
 *
 * O mesmo :nome usado duas vezes reaproveita o mesmo $n — o que é
 * cômodo, mas exige cuidado: se os dois usos ficarem em posições onde o
 * Postgres deduz tipos diferentes, ele recusa a consulta inteira com
 * "inconsistent types deduced for parameter". Nesse caso, use dois
 * binds distintos para o mesmo valor.
 */
interface SqlAnalisado {
  texto: string;
  nomes: string[];
}

const cacheAnalise = new Map<string, SqlAnalisado>();

/** Exportada para o db/check-postgres.mjs conseguir testar a traducao. */
export function analisar(sql: string): SqlAnalisado {
  const emCache = cacheAnalise.get(sql);
  if (emCache) return emCache;

  const nomes: string[] = [];
  const posicaoDoNome = new Map<string, number>();
  let saida = "";
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];
    const prox = sql[i + 1];

    if (c === "'" || c === '"') {
      // Copia o literal inteiro sem interpretar nada dentro dele.
      // No SQL, a aspa e escapada dobrando ('não' -> 'não''s').
      const aspa = c;
      saida += c;
      i++;
      while (i < sql.length) {
        saida += sql[i];
        if (sql[i] === aspa) {
          if (sql[i + 1] === aspa) {
            saida += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === "-" && prox === "-") {
      while (i < sql.length && sql[i] !== "\n") saida += sql[i++];
      continue;
    }

    if (c === "/" && prox === "*") {
      saida += "/*";
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) saida += sql[i++];
      saida += "*/";
      i += 2;
      continue;
    }

    if (c === ":" && prox === ":") {
      saida += "::";
      i += 2;
      continue;
    }

    if (c === ":" && prox !== undefined && /[A-Za-z_]/.test(prox)) {
      let nome = "";
      i++;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i] as string)) nome += sql[i++];

      let pos = posicaoDoNome.get(nome);
      if (pos === undefined) {
        nomes.push(nome);
        pos = nomes.length;
        posicaoDoNome.set(nome, pos);
      }
      saida += `$${pos}`;
      continue;
    }

    saida += c;
    i++;
  }

  const analisado: SqlAnalisado = { texto: saida, nomes };
  cacheAnalise.set(sql, analisado);
  return analisado;
}

function preparar(
  sql: string,
  binds: Record<string, unknown>,
): { texto: string; valores: unknown[] } {
  const { texto, nomes } = analisar(sql);
  const valores = nomes.map((nome) => {
    if (!(nome in binds)) {
      throw new Error(`Bind :${nome} usado no SQL mas não informado`);
    }
    return normalizarValor(binds[nome]);
  });
  return { texto, valores };
}

/** SELECT. Devolve linhas já em camelCase. */
// --------------------------------------------------------- operações

export interface Transacao {
  consultar<T = Record<string, unknown>>(
    sql: string,
    binds?: Record<string, unknown>,
  ): Promise<T[]>;
  executar(sql: string, binds?: Record<string, unknown>): Promise<number>;
}

/**
 * Transação com a identidade de quem chamou. Tudo dentro dela vê e grava
 * só o que o RLS permite a essa pessoa, na empresa ativa.
 */
export async function emTransacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
  const contexto = await contextoDoBanco();
  const conn = await getPool().connect();

  const tx: Transacao = {
    async consultar<R>(sql: string, binds: Record<string, unknown> = {}) {
      const { texto, valores } = preparar(sql, binds);
      try {
        const r = await conn.query<Record<string, unknown>>(texto, valores);
        return r.rows.map((l) => mapearLinha<R>(l));
      } catch (erro) {
        traduzirErro(erro, sql);
      }
    },
    async executar(sql: string, binds: Record<string, unknown> = {}) {
      const { texto, valores } = preparar(sql, binds);
      try {
        const r = await conn.query(texto, valores);
        return r.rowCount ?? 0;
      } catch (erro) {
        traduzirErro(erro, sql);
      }
    },
  };

  try {
    await conn.query(comandosDeSessao(contexto));
    const resultado = await fn(tx);
    await conn.query("COMMIT");
    return resultado;
  } catch (erro) {
    try {
      await conn.query("ROLLBACK");
    } catch {
      /* vazio de propósito: o erro original é o que importa */
    }
    throw erro;
  } finally {
    conn.release();
  }
}

/** Uma consulta = uma transação curta com a identidade de quem chamou. */
export async function consultar<T = Record<string, unknown>>(
  sql: string,
  binds: Record<string, unknown> = {},
): Promise<T[]> {
  return emTransacao((tx) => tx.consultar<T>(sql, binds));
}

export async function consultarUm<T = Record<string, unknown>>(
  sql: string,
  binds: Record<string, unknown> = {},
): Promise<T | null> {
  const linhas = await consultar<T>(sql, binds);
  return linhas[0] ?? null;
}

export async function executar(sql: string, binds: Record<string, unknown> = {}): Promise<number> {
  return emTransacao((tx) => tx.executar(sql, binds));
}