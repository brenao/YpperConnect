import oracledb from "oracledb";

/**
 * Camada de acesso ao Oracle. SOMENTE SERVIDOR.
 * Nunca importar de componente cliente — o bundle quebra e as
 * credenciais vazariam para o navegador.
 *
 * Usa o modo "thin" do node-oracledb 6+: não exige Oracle Instant
 * Client instalado no servidor. Por isso initOracleClient() não é
 * chamado em lugar nenhum.
 */

// CLOB como string em vez de stream. Sem isso, toda descrição de
// chamado voltaria como um objeto Lob que precisa ser lido à mão.
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

/**
 * Fuso da sessão Oracle.
 *
 * As colunas de data usam TIMESTAMP puro, não TIMESTAMP WITH LOCAL TIME
 * ZONE: o modo thin do node-oracledb ignora o fuso da sessão ao ler esse
 * segundo tipo e devolve o valor rotulado como UTC, deslocando o prazo
 * de SLA em 3 horas. Com TIMESTAMP puro a ida e volta é exata.
 *
 * ORA_SDTZ permanece como rede de segurança para o caso de o servidor de
 * aplicação rodar em fuso diferente do servidor de banco.
 */
const FUSO_APLICACAO = process.env["ORACLE_TIMEZONE"] ?? "-03:00";

if (!/^[+-]\d{2}:\d{2}$/.test(FUSO_APLICACAO)) {
  throw new Error(`ORACLE_TIMEZONE inválido: '${FUSO_APLICACAO}'. Use o formato -03:00`);
}
process.env["ORA_SDTZ"] = FUSO_APLICACAO;

let pool: oracledb.Pool | undefined;
let criandoPool: Promise<oracledb.Pool> | undefined;

function obrigatorio(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não configurada`);
  return v;
}

async function getPool(): Promise<oracledb.Pool> {
  if (pool) return pool;
  // Evita corrida: duas requisições simultâneas no boot criariam dois pools.
  if (criandoPool) return criandoPool;

  criandoPool = oracledb
    .createPool({
      user: obrigatorio("ORACLE_USER"),
      password: obrigatorio("ORACLE_PASSWORD"),
      connectString: `${obrigatorio("ORACLE_HOST")}:${process.env["ORACLE_PORT"] ?? 1521}/${obrigatorio("ORACLE_SERVICE_NAME")}`,
      poolMin: Number(process.env["ORACLE_POOL_MIN"] ?? 2),
      poolMax: Number(process.env["ORACLE_POOL_MAX"] ?? 10),
      poolIncrement: 1,
      // Derruba conexão ociosa que o firewall corporativo já matou
      // silenciosamente — sintoma clássico: ORA-03113 depois de idle.
      poolPingInterval: 60,
      queueTimeout: 30000,
    })
    .then((p: oracledb.Pool) => {
      pool = p;
      criandoPool = undefined;
      return p;
    })
    .catch((e: unknown) => {
      criandoPool = undefined;
      throw e;
    });

  return criandoPool;
}

/** Fecha o pool. Chamar no shutdown do servidor. */
export async function fecharPool(): Promise<void> {
  if (!pool) return;
  await pool.close(10);
  pool = undefined;
}

/**
 * ORACLE: string vazia é NULL. Um formulário web manda '' o tempo todo,
 * e '' numa coluna NOT NULL estoura com ORA-01400. Normaliza na borda.
 *
 * O retorno é convertido para BindParameters porque os tipos do driver
 * descrevem um union de formatos posicionais e nomeados; o nosso uso é
 * sempre nomeado, que é compatível em tempo de execução.
 */
function normalizarBinds(binds: Record<string, unknown>): oracledb.BindParameters {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(binds)) {
    saida[k] = v === "" ? null : v;
  }
  return saida as oracledb.BindParameters;
}

/** ORACLE devolve nomes de coluna em MAIÚSCULA. Converte para camelCase. */
function paraCamelCase(nome: string): string {
  return nome.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function mapearLinha<T>(linha: Record<string, unknown>): T {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    saida[paraCamelCase(k)] = v;
  }
  return saida as T;
}

/** SELECT. Devolve linhas já em camelCase. */
export async function consultar<T = Record<string, unknown>>(
  sql: string,
  binds: Record<string, unknown> = {},
): Promise<T[]> {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    const r = await conn.execute<Record<string, unknown>>(sql, normalizarBinds(binds));
    return (r.rows ?? []).map((l: Record<string, unknown>) => mapearLinha<T>(l));
  } finally {
    await conn.close();
  }
}

/** SELECT de uma linha só. Devolve null se não achar. */
export async function consultarUm<T = Record<string, unknown>>(
  sql: string,
  binds: Record<string, unknown> = {},
): Promise<T | null> {
  const linhas = await consultar<T>(sql, binds);
  return linhas[0] ?? null;
}

/** INSERT/UPDATE/DELETE isolado, com commit automático. */
export async function executar(sql: string, binds: Record<string, unknown> = {}): Promise<number> {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    const r = await conn.execute<unknown>(sql, normalizarBinds(binds), { autoCommit: true });
    return r.rowsAffected ?? 0;
  } finally {
    await conn.close();
  }
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
 */
export async function emTransacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
  const p = await getPool();
  const conn = await p.getConnection();

  const tx: Transacao = {
    async consultar<R>(sql: string, binds: Record<string, unknown> = {}) {
      const r = await conn.execute<Record<string, unknown>>(sql, normalizarBinds(binds));
      return (r.rows ?? []).map((l: Record<string, unknown>) => mapearLinha<R>(l));
    },
    async executar(sql: string, binds: Record<string, unknown> = {}) {
      const r = await conn.execute<unknown>(sql, normalizarBinds(binds));
      return r.rowsAffected ?? 0;
    },
  };

  try {
    const resultado = await fn(tx);
    await conn.commit();
    return resultado;
  } catch (erro) {
    await conn.rollback();
    throw erro;
  } finally {
    await conn.close();
  }
}
