import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { RecordType } from "@/models/itsm-types";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Catálogo de serviços, inventário de sistemas e categorias.
 *
 * Mesma interface do repositório legado; por dentro, Supabase com a
 * sessão de quem chamou (o RLS confere a empresa de novo).
 *
 * Regra transversal: nada é excluído de verdade. Chamados históricos
 * apontam para serviço e sistema por chave estrangeira, e DELETE
 * quebraria o histórico. Tudo desativa com ativo = false.
 */

export type Criticidade = "alta" | "media" | "baixa";
export type EscopoCategoria = "chamado" | "servico" | "artigo" | "sistema";

export interface Servico {
  id: string;
  nome: string;
  categoriaId: string | null;
  categoriaNome: string | null;
  descricao: string | null;
  tipoPadrao: RecordType;
  slaHoras: number;
  /** Define o roteamento: chamado aberto neste serviço vai para esta equipe. */
  equipeId: string | null;
  equipeNome: string | null;
  geradoPorIa: boolean;
  ativo: boolean;
}

export interface Sistema {
  id: string;
  nome: string;
  descricao: string | null;
  categoriaId: string | null;
  categoriaNome: string | null;
  criticidade: Criticidade;
  equipeId: string | null;
  equipeNome: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  atribuicaoId: string | null;
  atribuicaoNome: string | null;
  ativo: boolean;
}

export interface Categoria {
  id: string;
  nome: string;
  escopo: EscopoCategoria;
  ativo: boolean;
}

function exigirAdmin(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin) throw new ErroDominio(`Somente administradores podem ${acao}`);
}

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }, duplicado?: string): never {
  if (erro.code === "23505" && duplicado) throw new ErroDominio(duplicado);
  if (erro.code === "23503") {
    throw new ErroDominio("Um dos itens selecionados não pertence a esta empresa.");
  }
  if (erro.code === "42501") throw new ErroDominio("Somente administradores podem alterar");
  throw new Error(erro.message);
}

/** Nomes de categorias, equipes e pessoas da empresa, para montar as listas. */
async function nomesDeApoio(tenantId: string, pessoas: string[] = []) {
  const sb = getSupabaseServerClient();
  const [categorias, equipes, usuarios] = await Promise.all([
    sb.from("categorias").select("id, nome").eq("tenant_id", tenantId),
    sb.from("equipes").select("id, nome").eq("tenant_id", tenantId),
    pessoas.length
      ? sb.from("usuarios").select("id, nome").in("id", pessoas)
      : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null }),
  ]);
  if (categorias.error) falha(categorias.error);
  if (equipes.error) falha(equipes.error);
  if (usuarios.error) falha(usuarios.error);

  const mapa = (l: { id: unknown; nome: unknown }[] | null) =>
    new Map((l ?? []).map((x) => [x.id as string, x.nome as string]));
  return {
    categoria: mapa(categorias.data),
    equipe: mapa(equipes.data),
    pessoa: mapa(usuarios.data),
  };
}

const nomeDe = (mapa: Map<string, string>, id: unknown): string | null =>
  id ? (mapa.get(id as string) ?? null) : null;

// ------------------------------------------------------------- categorias

export async function listarCategorias(escopo?: EscopoCategoria): Promise<Categoria[]> {
  let q = getSupabaseServerClient()
    .from("categorias")
    .select("id, nome, escopo, ativo")
    .eq("tenant_id", await tenantAtual());
  if (escopo) q = q.eq("escopo", escopo);
  const { data, error } = await q.order("escopo").order("nome");
  if (error) falha(error);
  return (data ?? []) as Categoria[];
}

export async function criarCategoria(
  ctx: ContextoUsuario,
  dados: { nome: string; escopo: EscopoCategoria },
): Promise<string> {
  exigirAdmin(ctx, "criar categorias");
  if (dados.nome.trim().length < 2) throw new ErroDominio("Informe o nome da categoria");

  const { data, error } = await getSupabaseServerClient()
    .from("categorias")
    .insert({ tenant_id: ctx.tenantId, nome: dados.nome.trim(), escopo: dados.escopo })
    .select("id")
    .single();
  if (error) falha(error, "Já existe uma categoria com esse nome.");
  return data.id as string;
}

export async function renomearCategoria(ctx: ContextoUsuario, id: string, nome: string) {
  exigirAdmin(ctx, "alterar categorias");
  const { data, error } = await getSupabaseServerClient()
    .from("categorias")
    .update({ nome: nome.trim() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error, "Já existe uma categoria com esse nome.");
  if (!data?.length) throw new ErroDominio(`Categoria ${id} não encontrada`);
}

export async function definirCategoriaAtiva(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar categorias");
  const { error } = await getSupabaseServerClient()
    .from("categorias")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

// --------------------------------------------------------------- serviços

const COLUNAS_SERVICO =
  "id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, gerado_por_ia, ativo";

async function carregarServicos(filtro: {
  apenasAtivos?: boolean;
  id?: string;
}): Promise<Servico[]> {
  const tenantId = await tenantAtual();
  let q = getSupabaseServerClient()
    .from("servicos")
    .select(COLUNAS_SERVICO)
    .eq("tenant_id", tenantId);
  if (filtro.apenasAtivos) q = q.eq("ativo", true);
  if (filtro.id) q = q.eq("id", filtro.id);

  const [{ data, error }, nomes] = await Promise.all([q.order("nome"), nomesDeApoio(tenantId)]);
  if (error) falha(error);

  return (data ?? []).map((s) => ({
    id: s.id as string,
    nome: s.nome as string,
    categoriaId: (s.categoria_id as string | null) ?? null,
    categoriaNome: nomeDe(nomes.categoria, s.categoria_id),
    descricao: (s.descricao as string | null) ?? null,
    tipoPadrao: s.tipo_padrao as RecordType,
    slaHoras: s.sla_horas as number,
    equipeId: (s.equipe_id as string | null) ?? null,
    equipeNome: nomeDe(nomes.equipe, s.equipe_id),
    geradoPorIa: s.gerado_por_ia as boolean,
    ativo: s.ativo as boolean,
  }));
}

export async function listarServicos(apenasAtivos = true): Promise<Servico[]> {
  return carregarServicos({ apenasAtivos });
}

export async function buscarServico(id: string): Promise<Servico | null> {
  return (await carregarServicos({ id }))[0] ?? null;
}

export interface DadosServico {
  nome: string;
  categoriaId?: string | null | undefined;
  descricao?: string | null | undefined;
  tipoPadrao: RecordType;
  slaHoras: number;
  equipeId?: string | null | undefined;
  geradoPorIa?: boolean | undefined;
}

function validarServico(d: DadosServico): void {
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome do serviço");
  if (!Number.isFinite(d.slaHoras) || d.slaHoras <= 0) {
    throw new ErroDominio("SLA deve ser maior que zero");
  }
}

export async function criarServico(ctx: ContextoUsuario, d: DadosServico): Promise<string> {
  exigirAdmin(ctx, "criar serviços");
  validarServico(d);

  const { data, error } = await getSupabaseServerClient()
    .from("servicos")
    .insert({
      tenant_id: ctx.tenantId,
      nome: d.nome.trim(),
      categoria_id: d.categoriaId ?? null,
      descricao: d.descricao?.trim() ?? null,
      tipo_padrao: d.tipoPadrao,
      sla_horas: d.slaHoras,
      equipe_id: d.equipeId ?? null,
      gerado_por_ia: d.geradoPorIa ?? false,
    })
    .select("id")
    .single();
  if (error) falha(error);
  return data.id as string;
}

export async function atualizarServico(
  ctx: ContextoUsuario,
  id: string,
  d: DadosServico,
): Promise<void> {
  exigirAdmin(ctx, "alterar serviços");
  validarServico(d);

  const { data, error } = await getSupabaseServerClient()
    .from("servicos")
    .update({
      nome: d.nome.trim(),
      categoria_id: d.categoriaId ?? null,
      descricao: d.descricao?.trim() ?? null,
      tipo_padrao: d.tipoPadrao,
      sla_horas: d.slaHoras,
      equipe_id: d.equipeId ?? null,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Serviço ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir: chamados históricos referenciam o serviço
 * por FK. Um serviço inativo some dos formulários mas continua legível
 * nos chamados antigos.
 */
export async function definirServicoAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar serviços");
  const { error } = await getSupabaseServerClient()
    .from("servicos")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

// --------------------------------------------------------------- sistemas

export async function listarSistemas(apenasAtivos = true): Promise<Sistema[]> {
  const tenantId = await tenantAtual();
  let q = getSupabaseServerClient()
    .from("sistemas")
    .select(
      "id, nome, descricao, categoria_id, criticidade, equipe_id, responsavel_id, atribuicao_id, ativo",
    )
    .eq("tenant_id", tenantId);
  if (apenasAtivos) q = q.eq("ativo", true);

  const { data, error } = await q.order("nome");
  if (error) falha(error);

  const linhas = data ?? [];
  const pessoas = [
    ...new Set(
      linhas.flatMap((s) => [s.responsavel_id, s.atribuicao_id]).filter(Boolean) as string[],
    ),
  ];
  const nomes = await nomesDeApoio(tenantId, pessoas);

  return linhas.map((s) => ({
    id: s.id as string,
    nome: s.nome as string,
    descricao: (s.descricao as string | null) ?? null,
    categoriaId: (s.categoria_id as string | null) ?? null,
    categoriaNome: nomeDe(nomes.categoria, s.categoria_id),
    criticidade: s.criticidade as Criticidade,
    equipeId: (s.equipe_id as string | null) ?? null,
    equipeNome: nomeDe(nomes.equipe, s.equipe_id),
    responsavelId: (s.responsavel_id as string | null) ?? null,
    responsavelNome: nomeDe(nomes.pessoa, s.responsavel_id),
    atribuicaoId: (s.atribuicao_id as string | null) ?? null,
    atribuicaoNome: nomeDe(nomes.pessoa, s.atribuicao_id),
    ativo: s.ativo as boolean,
  }));
}

export interface DadosSistema {
  nome: string;
  descricao?: string | null | undefined;
  categoriaId?: string | null | undefined;
  criticidade: Criticidade;
  equipeId?: string | null | undefined;
  responsavelId?: string | null | undefined;
  atribuicaoId?: string | null | undefined;
}

function linhaSistema(d: DadosSistema) {
  return {
    nome: d.nome.trim(),
    descricao: d.descricao?.trim() ?? null,
    categoria_id: d.categoriaId ?? null,
    responsavel_id: d.responsavelId ?? null,
    atribuicao_id: d.atribuicaoId ?? null,
    equipe_id: d.equipeId ?? null,
    criticidade: d.criticidade,
  };
}

export async function criarSistema(ctx: ContextoUsuario, d: DadosSistema): Promise<string> {
  exigirAdmin(ctx, "criar sistemas");
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome do sistema");

  const { data, error } = await getSupabaseServerClient()
    .from("sistemas")
    .insert({ tenant_id: ctx.tenantId, ...linhaSistema(d) })
    .select("id")
    .single();
  if (error) falha(error, "Já existe um sistema com esse nome.");
  return data.id as string;
}

export async function atualizarSistema(
  ctx: ContextoUsuario,
  id: string,
  d: DadosSistema,
): Promise<void> {
  exigirAdmin(ctx, "alterar sistemas");
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome do sistema");

  const { data, error } = await getSupabaseServerClient()
    .from("sistemas")
    .update(linhaSistema(d))
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error, "Já existe um sistema com esse nome.");
  if (!data?.length) throw new ErroDominio(`Sistema ${id} não encontrado`);
}

export async function definirSistemaAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar sistemas");
  const { error } = await getSupabaseServerClient()
    .from("sistemas")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

/**
 * Exclui um sistema cadastrado errado.
 *
 * Só enquanto nenhum chamado usar o sistema: depois disso, a chave
 * estrangeira dos chamados barra a exclusão, e o caminho é desativar
 * (o histórico precisa continuar legível). Fica na auditoria.
 */
export async function excluirSistema(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx, "excluir sistemas");
  const { data, error } = await getSupabaseServerClient()
    .from("sistemas")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23503") {
      throw new ErroDominio(
        "Este sistema já é usado em chamados e não pode ser excluído. Desative-o em vez disso.",
      );
    }
    falha(error);
  }
  if (!data?.length) throw new ErroDominio(`Sistema ${id} não encontrado`);
}
