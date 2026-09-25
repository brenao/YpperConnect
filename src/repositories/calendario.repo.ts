import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Calendário do tenant: localidades e feriados. SOMENTE SERVIDOR.
 *
 * Mesma interface do repositório legado (a tela e as server functions
 * não mudaram); por dentro, lê e grava no Supabase com a sessão de quem
 * chamou, então o RLS confere cada operação de novo.
 *
 * Regras iguais às do legado, agora por empresa. Os feriados nacionais
 * também são da empresa: ela nasce com uma cópia do modelo da plataforma
 * (`feriados_plataforma`) e depois edita, desativa ou exclui como quiser.
 *
 * Uma localidade é "de onde a pessoa trabalha": define quais feriados
 * valem para ela e, quando cadastrado, o expediente próprio. `pais` em
 * ISO-3166 e `regiao` como texto livre, não uma coluna `uf`: estado,
 * província, condado e cantão são a mesma camada com nomes diferentes.
 */

export interface Localidade {
  id: string;
  nome: string;
  pais: string;
  regiao: string | null;
  cidade: string | null;
  /** A que vale para quem não tem localidade própria. Existe uma por tenant. */
  padrao: boolean;
  ativo: boolean;
  /** Quantos recursos apontam para ela. Zero até o módulo de recursos migrar. */
  recursos: number;
  /** Feriados regionais e municipais cadastrados nela. */
  feriados: number;
}

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
   * Repete todo ano na mesma data. Natal e Tiradentes são recorrentes;
   * Páscoa, Carnaval e Corpus Christi precisam de uma linha por ano.
   */
  recorrente: boolean;
  localidadeId: string | null;
  localidadeNome: string | null;
  ativo: boolean;
}

// ------------------------------------------------------------------ apoio

/**
 * Quem administra o calendário, como no legado: feriado e localidade
 * mudam as datas de todo cronograma da empresa — é configuração de
 * instalação, fica com o administrador.
 */
function exigirGestor(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin) throw new ErroDominio(`Somente administradores podem ${acao}`);
}

async function ctxAtual(): Promise<ContextoUsuario> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

async function invalidarCalendario(): Promise<void> {
  const { invalidarCacheCalendario } = await import("@/integrations/postgres/sla.server");
  invalidarCacheCalendario();
}

/** "YYYY-MM-DD" a partir dos componentes locais, sem passar pelo fuso. */
function paraTextoData(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

/** Meia-noite local do dia, como o driver pg entregava no legado. */
function deTextoData(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00`);
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "23505") {
    throw new ErroDominio("Já existe um feriado nessa data para essa abrangência.");
  }
  if (erro.code === "42501") throw new ErroDominio("Você não tem permissão para esta ação.");
  throw new Error(erro.message);
}

// ------------------------------------------------------------------ localidades

export async function listarLocalidades(apenasAtivas = false): Promise<Localidade[]> {
  const ctx = await ctxAtual();
  const sb = getSupabaseServerClient();

  let consulta = sb
    .from("localidades")
    .select("id, nome, pais, regiao, cidade, padrao, ativo")
    .eq("tenant_id", ctx.tenantId);
  if (apenasAtivas) consulta = consulta.eq("ativo", true);

  const [locais, feriados] = await Promise.all([
    consulta.order("padrao", { ascending: false }).order("nome"),
    sb
      .from("feriados")
      .select("localidade_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("ativo", true)
      .not("localidade_id", "is", null),
  ]);
  if (locais.error) falha(locais.error);
  if (feriados.error) falha(feriados.error);

  const contagem = new Map<string, number>();
  for (const f of feriados.data ?? []) {
    const id = f.localidade_id as string;
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return (locais.data ?? []).map((l) => ({
    id: l.id as string,
    nome: l.nome as string,
    pais: (l.pais as string).trim(),
    regiao: (l.regiao as string | null) ?? null,
    cidade: (l.cidade as string | null) ?? null,
    padrao: l.padrao as boolean,
    ativo: l.ativo as boolean,
    recursos: 0,
    feriados: contagem.get(l.id as string) ?? 0,
  }));
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

function linhaLocalidade(d: DadosLocalidade) {
  return {
    nome: d.nome.trim(),
    pais: (d.pais ?? "BR").trim().toUpperCase(),
    regiao: d.regiao?.trim() || null,
    cidade: d.cidade?.trim() || null,
  };
}

export async function criarLocalidade(ctx: ContextoUsuario, d: DadosLocalidade): Promise<string> {
  exigirGestor(ctx, "cadastrar localidades");
  validarLocalidade(d);

  const { data, error } = await getSupabaseServerClient()
    .from("localidades")
    .insert({ tenant_id: ctx.tenantId, ...linhaLocalidade(d) })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new ErroDominio("Já existe uma localidade com esse nome.");
    falha(error);
  }
  await invalidarCalendario();
  return data.id as string;
}

export async function atualizarLocalidade(
  ctx: ContextoUsuario,
  id: string,
  d: DadosLocalidade,
): Promise<void> {
  exigirGestor(ctx, "alterar localidades");
  validarLocalidade(d);

  const { data, error } = await getSupabaseServerClient()
    .from("localidades")
    .update(linhaLocalidade(d))
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") throw new ErroDominio("Já existe uma localidade com esse nome.");
    falha(error);
  }
  if (!data?.length) throw new ErroDominio(`Localidade ${id} não encontrada`);
  await invalidarCalendario();
}

/**
 * Troca qual localidade é a padrão do tenant.
 *
 * Duas escritas em sequência, zerando a atual antes: o índice único
 * parcial recusa duas padrões ao mesmo tempo. Se a segunda falhar, a
 * primeira é desfeita, para o tenant nunca ficar sem padrão.
 */
export async function definirLocalidadePadrao(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirGestor(ctx, "alterar localidades");
  const sb = getSupabaseServerClient();

  const atual = await sb
    .from("localidades")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("padrao", true)
    .maybeSingle();
  if (atual.error) falha(atual.error);
  if (atual.data?.id === id) return;

  if (atual.data) {
    const zerar = await sb.from("localidades").update({ padrao: false }).eq("id", atual.data.id);
    if (zerar.error) falha(zerar.error);
  }

  const eleger = await sb
    .from("localidades")
    .update({ padrao: true, ativo: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");

  if (eleger.error || !eleger.data?.length) {
    if (atual.data) {
      await sb.from("localidades").update({ padrao: true }).eq("id", atual.data.id);
    }
    if (eleger.error) falha(eleger.error);
    throw new ErroDominio(`Localidade ${id} não encontrada`);
  }
  await invalidarCalendario();
}

/**
 * Desativa em vez de excluir: recursos e feriados apontam para ela.
 * A padrão não pode ser desativada — é para ela que todo mundo cai.
 */
export async function definirLocalidadeAtiva(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirGestor(ctx, "alterar localidades");
  const sb = getSupabaseServerClient();

  if (!ativo) {
    const l = await sb
      .from("localidades")
      .select("padrao")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();
    if (l.error) falha(l.error);
    if (!l.data) throw new ErroDominio(`Localidade ${id} não encontrada`);
    if (l.data.padrao) {
      throw new ErroDominio(
        "A localidade padrão não pode ser desativada. Eleja outra como padrão antes.",
      );
    }
  }

  const { error } = await sb
    .from("localidades")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
  await invalidarCalendario();
}

// ------------------------------------------------------------------ feriados

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
  const ctx = await ctxAtual();
  const sb = getSupabaseServerClient();

  const [feriados, locais] = await Promise.all([
    sb
      .from("feriados")
      .select("id, data, descricao, tipo, recorrente, localidade_id, ativo")
      .eq("tenant_id", ctx.tenantId),
    sb.from("localidades").select("id, nome").eq("tenant_id", ctx.tenantId),
  ]);
  if (feriados.error) falha(feriados.error);
  if (locais.error) falha(locais.error);

  const nomeLocal = new Map((locais.data ?? []).map((l) => [l.id as string, l.nome as string]));

  return (feriados.data ?? [])
    .map((f): Feriado => {
      const localidadeId = (f.localidade_id as string | null) ?? null;
      const tipo: TipoFeriado =
        f.tipo === "estadual" || f.tipo === "municipal" ? f.tipo : "nacional";
      return {
        id: f.id as string,
        data: deTextoData(f.data as string),
        descricao: f.descricao as string,
        tipo,
        recorrente: f.recorrente as boolean,
        localidadeId,
        localidadeNome: localidadeId ? (nomeLocal.get(localidadeId) ?? null) : null,
        ativo: f.ativo as boolean,
      };
    })
    .filter((f) => f.recorrente || !filtro.ano || f.data.getFullYear() === filtro.ano)
    .filter(
      (f) =>
        !filtro.localidadeId || f.tipo === "nacional" || f.localidadeId === filtro.localidadeId,
    )
    .sort(
      (a, b) =>
        Number(b.recorrente) - Number(a.recorrente) ||
        a.data.getMonth() - b.data.getMonth() ||
        a.data.getDate() - b.data.getDate(),
    );
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
 * Valida antes do banco para dar a mensagem certa: o CHECK da tabela
 * recusaria de qualquer jeito, mas com um texto que não ajuda ninguém.
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

function linhaFeriado(d: DadosFeriado) {
  return {
    data: paraTextoData(d.data),
    descricao: d.descricao.trim(),
    tipo: d.tipo,
    recorrente: d.recorrente ?? false,
    localidade_id: d.tipo === "nacional" ? null : (d.localidadeId ?? null),
  };
}

export async function criarFeriado(ctx: ContextoUsuario, d: DadosFeriado): Promise<string> {
  exigirGestor(ctx, "cadastrar feriados");
  validarFeriado(d);

  const { data, error } = await getSupabaseServerClient()
    .from("feriados")
    .insert({ tenant_id: ctx.tenantId, ...linhaFeriado(d) })
    .select("id")
    .single();
  if (error) falha(error);
  await invalidarCalendario();
  return data.id as string;
}

export async function atualizarFeriado(
  ctx: ContextoUsuario,
  id: string,
  d: DadosFeriado,
): Promise<void> {
  exigirGestor(ctx, "alterar feriados");
  validarFeriado(d);

  const { data, error } = await getSupabaseServerClient()
    .from("feriados")
    .update(linhaFeriado(d))
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Feriado ${id} não encontrado`);
  await invalidarCalendario();
}

/**
 * Liga e desliga o feriado. Preferível a excluir no caso do ponto
 * facultativo que a empresa decidiu não parar neste ano.
 */
export async function definirFeriadoAtivo(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirGestor(ctx, "alterar feriados");
  const { data, error } = await getSupabaseServerClient()
    .from("feriados")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Feriado ${id} não encontrado`);
  await invalidarCalendario();
}

/** Apaga de verdade, para o cadastro errado. Prazos já gravados não mudam. */
export async function excluirFeriado(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirGestor(ctx, "excluir feriados");
  const { data, error } = await getSupabaseServerClient()
    .from("feriados")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Feriado ${id} não encontrado`);
  await invalidarCalendario();
}
