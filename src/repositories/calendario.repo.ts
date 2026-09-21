import {
  consultar,
  consultarUm,
  executar,
  emTransacao,
} from "@/integrations/postgres/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Calendário da instalação: localidades e feriados.
 *
 * Uma localidade é "de onde a pessoa trabalha": define quais feriados
 * valem para ela e, quando cadastrado, o expediente próprio. Empresa de
 * uma cidade só cadastra nada além da padrão, que a migration 16 já
 * criou.
 *
 * `pais` em ISO-3166 e `regiao` como texto livre, não uma coluna `uf`:
 * estado, província, condado e cantão são a mesma camada com nomes
 * diferentes, e um produto que assume "UF" não atravessa a fronteira.
 */

export interface Localidade {
  id: string;
  nome: string;
  pais: string;
  regiao: string | null;
  cidade: string | null;
  /** A que vale para quem não tem localidade própria. Existe uma só. */
  padrao: boolean;
  ativo: boolean;
  /** Quantos recursos apontam para ela — a tela avisa antes de desativar. */
  recursos: number;
  /** Feriados regionais e municipais cadastrados nela. */
  feriados: number;
}

interface LinhaLocalidade extends Omit<Localidade, "padrao" | "ativo"> {
  padrao: number;
  ativo: number;
}

const mapearLocalidade = (l: LinhaLocalidade): Localidade => ({
  ...l,
  padrao: paraBool(l.padrao),
  ativo: paraBool(l.ativo),
});

/**
 * Quem administra o calendário.
 *
 * Feriado e localidade mudam as datas de todo cronograma da empresa —
 * é configuração de instalação, não de projeto. Fica com o
 * administrador, junto do resto da Administração.
 */
function exigirAdmin(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin) throw new ErroDominio(`Somente administradores podem ${acao}`);
}

/**
 * Limpa o cache do calendário depois de escrever.
 *
 * O `sla.server` guarda cada localidade por dez minutos. Sem esta
 * chamada, cadastrar um feriado e ver o cronograma continuar igual é o
 * comportamento esperado do cache — e uma confusão garantida para quem
 * acabou de cadastrar.
 */
async function invalidarCalendario(): Promise<void> {
  const { invalidarCacheCalendario } = await import("@/integrations/postgres/sla.server");
  invalidarCacheCalendario();
}

export async function listarLocalidades(apenasAtivas = false): Promise<Localidade[]> {
  const linhas = await consultar<LinhaLocalidade>(
    `SELECT l.id, l.nome, l.pais, l.regiao, l.cidade, l.padrao, l.ativo,
            (SELECT COUNT(*) FROM recursos r
              WHERE r.localidade_id = l.id AND r.ativo = 1)::int AS recursos,
            (SELECT COUNT(*) FROM feriados f
              WHERE f.localidade_id = l.id AND f.ativo = 1)::int AS feriados
       FROM localidades l
      ${apenasAtivas ? "WHERE l.ativo = 1" : ""}
      ORDER BY l.padrao DESC, l.nome`,
  );
  return linhas.map(mapearLocalidade);
}

export interface DadosLocalidade {
  nome: string;
  pais?: string | undefined;
  regiao?: string | null | undefined;
  cidade?: string | null | undefined;
}

function validarLocalidade(d: DadosLocalidade): void {
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome da localidade");
  const pais = (d.pais ?? "BR").trim();
  if (pais.length !== 2) throw new ErroDominio("O país deve ter duas letras (BR, PT, US)");
}

export async function criarLocalidade(ctx: ContextoUsuario, d: DadosLocalidade): Promise<string> {
  exigirAdmin(ctx, "cadastrar localidades");
  validarLocalidade(d);

  const id = crypto.randomUUID();
  await executar(
    `INSERT INTO localidades (id, nome, pais, regiao, cidade, padrao, ativo, criado_em)
     VALUES (:id, :nome, :pais, :regiao, :cidade, 0, 1, LOCALTIMESTAMP)`,
    {
      id,
      nome: d.nome.trim(),
      pais: (d.pais ?? "BR").trim().toUpperCase(),
      regiao: d.regiao?.trim() ?? null,
      cidade: d.cidade?.trim() ?? null,
    },
  );
  await invalidarCalendario();
  return id;
}

export async function atualizarLocalidade(
  ctx: ContextoUsuario,
  id: string,
  d: DadosLocalidade,
): Promise<void> {
  exigirAdmin(ctx, "alterar localidades");
  validarLocalidade(d);

  const n = await executar(
    `UPDATE localidades
        SET nome = :nome, pais = :pais, regiao = :regiao, cidade = :cidade
      WHERE id = :id`,
    {
      id,
      nome: d.nome.trim(),
      pais: (d.pais ?? "BR").trim().toUpperCase(),
      regiao: d.regiao?.trim() ?? null,
      cidade: d.cidade?.trim() ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Localidade ${id} não encontrada`);
  await invalidarCalendario();
}

/**
 * Troca qual localidade é a padrão.
 *
 * Em transação e zerando todas antes: o índice único parcial recusa
 * duas padrões, e fazer o UPDATE na ordem inversa quebraria no meio do
 * caminho.
 */
export async function definirLocalidadePadrao(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx, "alterar localidades");

  await emTransacao(async (tx) => {
    await tx.executar(`UPDATE localidades SET padrao = 0 WHERE padrao = 1`, {});
    const n = await tx.executar(`UPDATE localidades SET padrao = 1, ativo = 1 WHERE id = :id`, {
      id,
    });
    if (n === 0) throw new ErroDominio(`Localidade ${id} não encontrada`);
  });
  await invalidarCalendario();
}

/**
 * Desativa em vez de excluir: recursos e feriados apontam para ela por
 * FK, e apagar deixaria gente sem calendário.
 *
 * A padrão não pode ser desativada — é para ela que todo mundo cai
 * quando não tem localidade própria.
 */
export async function definirLocalidadeAtiva(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirAdmin(ctx, "alterar localidades");

  if (!ativo) {
    const l = await consultarUm<{ padrao: number }>(
      `SELECT padrao FROM localidades WHERE id = :id`,
      { id },
    );
    if (!l) throw new ErroDominio(`Localidade ${id} não encontrada`);
    if (paraBool(l.padrao)) {
      throw new ErroDominio(
        "A localidade padrão não pode ser desativada. Eleja outra como padrão antes.",
      );
    }
  }

  await executar(`UPDATE localidades SET ativo = :ativo WHERE id = :id`, {
    id,
    ativo: deBool(ativo),
  });
  await invalidarCalendario();
}

// ----------------------------------------------------------- feriados

/**
 * Abrangência do feriado.
 *
 * A coluna é `tipo`, que existe desde o 01-schema. A migration 18
 * removeu a `abrangencia` que eu havia criado em paralelo: duas colunas
 * para a mesma verdade divergem na primeira vez que alguém edita só uma.
 */
export type TipoFeriado = "nacional" | "estadual" | "municipal";

export const FERIADO_LABEL: Record<TipoFeriado, string> = {
  nacional: "Nacional",
  estadual: "Estadual / regional",
  municipal: "Municipal",
};

export interface Feriado {
  id: string;
  data: Date;
  descricao: string;
  tipo: TipoFeriado;
  /**
   * Repete todo ano na mesma data.
   *
   * Natal e Tiradentes são recorrentes; Páscoa, Carnaval e Corpus
   * Christi dependem do calendário litúrgico e precisam de uma linha por
   * ano. O ano gravado num recorrente é só marcador — a busca casa por
   * mês e dia.
   */
  recorrente: boolean;
  localidadeId: string | null;
  localidadeNome: string | null;
  ativo: boolean;
}

interface LinhaFeriado extends Omit<Feriado, "recorrente" | "ativo"> {
  recorrente: number;
  ativo: number;
}

const mapearFeriado = (l: LinhaFeriado): Feriado => ({
  ...l,
  recorrente: paraBool(l.recorrente),
  ativo: paraBool(l.ativo),
});

/**
 * Feriados de um ano, mais todos os recorrentes.
 *
 * O recorrente é gravado com um ano qualquer e vale para todos, então a
 * consulta o traz sempre — filtrá-lo por ano esconderia o Natal de quem
 * está olhando 2027.
 *
 * Com localidade informada, vêm os nacionais (que valem para todos) e os
 * daquela localidade. Sem ela, vem tudo: é a visão da administração.
 */
export async function listarFeriados(filtro: {
  ano?: number | null | undefined;
  localidadeId?: string | null | undefined;
}): Promise<Feriado[]> {
  const linhas = await consultar<LinhaFeriado>(
    `SELECT f.id, f.data_feriado AS data, f.descricao, f.tipo, f.recorrente,
            f.localidade_id, l.nome AS localidade_nome, f.ativo
       FROM feriados f
       LEFT JOIN localidades l ON l.id = f.localidade_id
      WHERE (f.recorrente = 1
             OR CAST(:ano AS integer) IS NULL
             OR EXTRACT(YEAR FROM f.data_feriado) = CAST(:ano AS integer))
        AND (CAST(:localidadeId AS varchar) IS NULL
             OR f.tipo = 'nacional'
             OR f.localidade_id = CAST(:localidadeId AS varchar))
      ORDER BY f.recorrente DESC, f.mes, f.dia`,
    { ano: filtro.ano ?? null, localidadeId: filtro.localidadeId ?? null },
  );
  return linhas.map(mapearFeriado);
}

export interface DadosFeriado {
  data: Date;
  descricao: string;
  tipo: TipoFeriado;
  recorrente?: boolean | undefined;
  /** Obrigatória para estadual e municipal; proibida para nacional. */
  localidadeId?: string | null | undefined;
}

/**
 * Valida antes do banco para dar a mensagem certa.
 *
 * O `CHECK` da tabela recusaria de qualquer jeito, mas o erro do
 * Postgres diria "viola ck_feriados_localidade" — que não ajuda em nada
 * quem está cadastrando.
 */
function validarFeriado(d: DadosFeriado): void {
  if (d.descricao.trim().length < 3) throw new ErroDominio("Informe o nome do feriado");

  if (d.tipo === "nacional" && d.localidadeId) {
    throw new ErroDominio("Feriado nacional vale para todos e não tem localidade.");
  }
  if (d.tipo !== "nacional" && !d.localidadeId) {
    throw new ErroDominio(
      "Feriado estadual ou municipal precisa de uma localidade: sem ela, não há como saber a quem se aplica.",
    );
  }
}

/** Traduz a violação do índice único, que é o erro mais provável aqui. */
function traduzirDuplicidade(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("ux_feriados")) {
    throw new ErroDominio("Já existe um feriado nessa data para essa abrangência.");
  }
  throw e;
}

export async function criarFeriado(ctx: ContextoUsuario, d: DadosFeriado): Promise<string> {
  exigirAdmin(ctx, "cadastrar feriados");
  validarFeriado(d);

  const id = crypto.randomUUID();
  try {
    await executar(
      `INSERT INTO feriados
         (id, data_feriado, descricao, tipo, recorrente, localidade_id, ativo)
       VALUES (:id, :data, :descricao, :tipo, :recorrente, :localidadeId, 1)`,
      {
        id,
        data: d.data,
        descricao: d.descricao.trim(),
        tipo: d.tipo,
        recorrente: deBool(d.recorrente ?? false),
        localidadeId: d.localidadeId ?? null,
      },
    );
  } catch (e) {
    traduzirDuplicidade(e);
  }

  await invalidarCalendario();
  return id;
}

export async function atualizarFeriado(
  ctx: ContextoUsuario,
  id: string,
  d: DadosFeriado,
): Promise<void> {
  exigirAdmin(ctx, "alterar feriados");
  validarFeriado(d);

  let n = 0;
  try {
    n = await executar(
      `UPDATE feriados
          SET data_feriado = :data,
              descricao = :descricao,
              tipo = :tipo,
              recorrente = :recorrente,
              localidade_id = :localidadeId
        WHERE id = :id`,
      {
        id,
        data: d.data,
        descricao: d.descricao.trim(),
        tipo: d.tipo,
        recorrente: deBool(d.recorrente ?? false),
        localidadeId: d.localidadeId ?? null,
      },
    );
  } catch (e) {
    traduzirDuplicidade(e);
  }

  if (n === 0) throw new ErroDominio(`Feriado ${id} não encontrado`);
  await invalidarCalendario();
}

/**
 * Liga e desliga o feriado.
 *
 * Preferível a excluir no caso do ponto facultativo que a empresa
 * decidiu não parar neste ano: a linha continua lá e volta com um
 * clique, em vez de ser recadastrada do zero.
 */
export async function definirFeriadoAtivo(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirAdmin(ctx, "alterar feriados");
  const n = await executar(`UPDATE feriados SET ativo = :ativo WHERE id = :id`, {
    id,
    ativo: deBool(ativo),
  });
  if (n === 0) throw new ErroDominio(`Feriado ${id} não encontrado`);
  await invalidarCalendario();
}

/**
 * Apaga de verdade, para o cadastro errado.
 *
 * Feriado não é histórico de trabalho: é regra de calendário. O prazo de
 * SLA já gravado não muda — ele é um retrato do momento da abertura —, e
 * o cronograma recalcula na próxima passada, que é exatamente o que se
 * quer quando alguém cadastrou um feriado que não existe.
 */
export async function excluirFeriado(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx, "excluir feriados");
  const n = await executar(`DELETE FROM feriados WHERE id = :id`, { id });
  if (n === 0) throw new ErroDominio(`Feriado ${id} não encontrado`);
  await invalidarCalendario();
}
