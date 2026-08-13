import pg from "pg";

/**
 * Camada de acesso ao PostgreSQL. SOMENTE SERVIDOR.
 * Nunca importar de componente cliente — o bundle quebra e as
 * credenciais vazariam para o navegador.
 *
 * A interface publica (consultar / consultarUm / executar / emTransacao)
 * e identica a que existia para o Oracle, de proposito: os repositorios
 * trocam so o caminho do import.
 */

/**
 * O driver `pg` devolve alguns tipos como STRING por padrao, para nao
 * perder precisao. Sem os dois parsers abaixo:
 *
 *   - COUNT(*) e a coluna `numero` do chamado (BIGINT) chegariam como
 *     "42" em vez de 42, e `total > 0` viraria comparacao de texto;
 *   - horas_dia e duracao (NUMERIC) chegariam como "8.00", e somar
 *     horas daria concatenacao.
 *
 * Convertemos para number, que e o que o Oracle entregava. O limite e
 * 2^53 (~9 quatrilhoes); nenhuma coluna nossa chega perto.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));

/**
 * Fuso da sessao.
 *
 * As colunas de data sao TIMESTAMP sem fuso, iguais as do Oracle. O que
 * o banco grava em `LOCALTIMESTAMP` depende do fuso da SESSAO: se ela
 * abrir em UTC, todo prazo de SLA nasce 3 horas adiantado. Por isso o
 * fuso e fixado na conexao, e nao herdado do servidor.
 *
 * Aceita nome de zona (America/Sao_Paulo), nao deslocamento fixo, para
 * o horario de verao continuar correto se um dia voltar.
 */
const FUSO_SESSAO = process.env["PG_TIMEZONE"] ?? "America/Sao_Paulo";

let pool: pg.Pool | undefined;

function obrigatorio(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não configurada`);
  return v;
}

function getPool(): pg.Pool {
  if (pool) return pool;
  // new Pool() nao abre conexao nenhuma: as conexoes nascem sob demanda.
  // Por isso aqui nao ha a corrida que o Oracle tinha no boot.
  pool = new pg.Pool({
    host: obrigatorio("PG_HOST"),
    port: Number(process.env["PG_PORT"] ?? 5432),
    user: obrigatorio("PG_USER"),
    password: obrigatorio("PG_PASSWORD"),
    database: obrigatorio("PG_DATABASE"),
    max: Number(process.env["PG_POOL_LIMIT"] ?? 10),
    // Derruba conexao ociosa que o firewall corporativo ja matou
    // silenciosamente — o equivalente ao poolPingInterval do Oracle.
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    connectionTimeoutMillis: 30_000,
    options: `-c timezone=${FUSO_SESSAO}`,
  });

  // Sem este handler, um erro numa conexao ociosa derruba o processo
  // Node inteiro (o 'error' do Pool e um EventEmitter sem listener).
  pool.on("error", (erro: Error) => {
    console.error("[postgres] erro em conexão ociosa do pool:", erro.message);
  });

  return pool;
}

/** Fecha o pool. Chamar no shutdown do servidor. */
export async function fecharPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

/**
 * ORACLE: string vazia e NULL. O Postgres NAO faz isso — '' e um valor.
 * Mantemos a conversao para que o dado gravado continue igual ao que
 * era: sem ela, uma coluna NOT NULL passaria a aceitar '' calada, e um
 * CHECK de enum recusaria o insert com mensagem confusa.
 */
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
 * O mesmo :nome usado duas vezes reaproveita o mesmo $n.
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
export async function consultar<T = Record<string, unknown>>(
  sql: string,
  binds: Record<string, unknown> = {},
): Promise<T[]> {
  const { texto, valores } = preparar(sql, binds);
  const r = await getPool().query<Record<string, unknown>>(texto, valores);
  return r.rows.map((l) => mapearLinha<T>(l));
}

/** SELECT de uma linha só. Devolve null se não achar. */
export async function consultarUm<T = Record<string, unknown>>(
  sql: string,
  binds: Record<string, unknown> = {},
): Promise<T | null> {
  const linhas = await consultar<T>(sql, binds);
  return linhas[0] ?? null;
}

/**
 * INSERT/UPDATE/DELETE isolado. Cada comando solto no Postgres ja e uma
 * transacao propria, entao nao existe o autoCommit do Oracle aqui.
 */
export async function executar(sql: string, binds: Record<string, unknown> = {}): Promise<number> {
  const { texto, valores } = preparar(sql, binds);
  const r = await getPool().query(texto, valores);
  return r.rowCount ?? 0;
}

export interface Transacao {
  consultar<T = Record<string, unknown>>(
    sql: string,
    binds?: Record<string, unknown>,
  ): Promise<T[]>;
  executar(sql: string, binds?: Record<string, unknown>): Promise<number>;
}

/**
 * Executa várias operações numa transação. Commit no fim, rollback em
 * qualquer erro. Obrigatório sempre que gravar em chamados e
 * chamado_historico juntos — a auditoria não pode ficar órfã.
 *
 * A conexão é reservada do pool e devolvida no finally. Diferente do
 * Oracle, aqui o BEGIN/COMMIT é comando SQL explícito.
 */
export async function emTransacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
  const conn = await getPool().connect();

  const tx: Transacao = {
    async consultar<R>(sql: string, binds: Record<string, unknown> = {}) {
      const { texto, valores } = preparar(sql, binds);
      const r = await conn.query<Record<string, unknown>>(texto, valores);
      return r.rows.map((l) => mapearLinha<R>(l));
    },
    async executar(sql: string, binds: Record<string, unknown> = {}) {
      const { texto, valores } = preparar(sql, binds);
      const r = await conn.query(texto, valores);
      return r.rowCount ?? 0;
    },
  };

  try {
    await conn.query("BEGIN");
    const resultado = await fn(tx);
    await conn.query("COMMIT");
    return resultado;
  } catch (erro) {
    // Se o próprio ROLLBACK falhar (conexão já morta), o erro original
    // é o que interessa — ele é relançado abaixo de qualquer jeito.
    try {
      await conn.query("ROLLBACK");
    } catch {
      /* vazio de propósito */
    }
    throw erro;
  } finally {
    conn.release();
  }
}
