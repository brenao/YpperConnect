import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Base de conhecimento: procedimentos e soluções recorrentes.
 *
 * Mesma interface do repositório legado; por dentro, Supabase com a
 * sessão de quem chamou. Qualquer membro da empresa lê; só a equipe de
 * TI escreve — o RLS confere de novo.
 */

export type StatusArtigo = "publicado" | "revisar" | "rascunho";

export interface Artigo {
  id: string;
  titulo: string;
  categoriaId: string | null;
  categoriaNome: string | null;
  resumo: string | null;
  conteudo: string;
  status: StatusArtigo;
  visualizacoes: number;
  geradoPorIa: boolean;
  autorId: string | null;
  autorNome: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

function exigirTi(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio(`Somente a equipe de TI pode ${acao}`);
  }
}

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "42501") throw new ErroDominio("Somente a equipe de TI pode alterar artigos");
  if (erro.code === "23503") {
    throw new ErroDominio("A categoria escolhida não pertence a esta empresa.");
  }
  throw new Error(erro.message);
}

async function carregar(id?: string): Promise<Artigo[]> {
  const tenantId = await tenantAtual();
  const sb = getSupabaseServerClient();

  let q = sb
    .from("artigos")
    .select(
      "id, titulo, categoria_id, resumo, conteudo, status, visualizacoes, gerado_por_ia, autor_id, criado_em, atualizado_em",
    )
    .eq("tenant_id", tenantId);
  if (id) q = q.eq("id", id);

  const [artigos, categorias] = await Promise.all([
    q.order("atualizado_em", { ascending: false }),
    sb.from("categorias").select("id, nome").eq("tenant_id", tenantId),
  ]);
  if (artigos.error) falha(artigos.error);
  if (categorias.error) falha(categorias.error);

  const linhas = artigos.data ?? [];
  const autores = [...new Set(linhas.map((a) => a.autor_id).filter(Boolean))] as string[];
  const nomeAutor = new Map<string, string>();
  if (autores.length) {
    const u = await sb.from("usuarios").select("id, nome").in("id", autores);
    for (const p of u.data ?? []) nomeAutor.set(p.id as string, p.nome as string);
  }
  const nomeCategoria = new Map(
    (categorias.data ?? []).map((c) => [c.id as string, c.nome as string]),
  );

  return linhas.map((a) => ({
    id: a.id as string,
    titulo: a.titulo as string,
    categoriaId: (a.categoria_id as string | null) ?? null,
    categoriaNome: a.categoria_id ? (nomeCategoria.get(a.categoria_id as string) ?? null) : null,
    resumo: (a.resumo as string | null) ?? null,
    conteudo: a.conteudo as string,
    status: a.status as StatusArtigo,
    visualizacoes: Number(a.visualizacoes ?? 0),
    geradoPorIa: a.gerado_por_ia as boolean,
    autorId: (a.autor_id as string | null) ?? null,
    autorNome: a.autor_id ? (nomeAutor.get(a.autor_id as string) ?? null) : null,
    criadoEm: new Date(a.criado_em as string),
    atualizadoEm: new Date(a.atualizado_em as string),
  }));
}

export async function listarArtigos(): Promise<Artigo[]> {
  return carregar();
}

export async function buscarArtigo(id: string): Promise<Artigo | null> {
  return (await carregar(id))[0] ?? null;
}

export interface DadosArtigo {
  titulo: string;
  categoriaId?: string | null | undefined;
  resumo?: string | null | undefined;
  conteudo: string;
  status?: StatusArtigo | undefined;
  geradoPorIa?: boolean | undefined;
}

function validar(d: DadosArtigo): void {
  if (d.titulo.trim().length < 5) throw new ErroDominio("Informe o título do artigo");
  if (d.conteudo.trim().length < 20) {
    throw new ErroDominio("O conteúdo precisa de pelo menos 20 caracteres");
  }
}

export async function criarArtigo(ctx: ContextoUsuario, d: DadosArtigo): Promise<string> {
  exigirTi(ctx, "criar artigos");
  validar(d);

  const { data, error } = await getSupabaseServerClient()
    .from("artigos")
    .insert({
      tenant_id: ctx.tenantId,
      titulo: d.titulo.trim(),
      categoria_id: d.categoriaId ?? null,
      resumo: d.resumo?.trim() ?? null,
      conteudo: d.conteudo.trim(),
      // Artigo gerado por IA nasce em "revisar": ninguém publica texto
      // de modelo sem alguém ler antes.
      status: d.status ?? (d.geradoPorIa ? "revisar" : "rascunho"),
      gerado_por_ia: d.geradoPorIa ?? false,
      autor_id: ctx.id,
    })
    .select("id")
    .single();
  if (error) falha(error);
  return data.id as string;
}

export interface AlteracaoArtigo {
  titulo?: string | undefined;
  categoriaId?: string | null | undefined;
  resumo?: string | null | undefined;
  conteudo?: string | undefined;
  status?: StatusArtigo | undefined;
}

/**
 * Mesma semântica do legado: título, conteúdo e status só mudam se
 * vierem; categoria e resumo são sempre gravados (vazio limpa).
 */
export async function atualizarArtigo(
  ctx: ContextoUsuario,
  id: string,
  d: AlteracaoArtigo,
): Promise<void> {
  exigirTi(ctx, "alterar artigos");

  const mudancas: Record<string, unknown> = {
    categoria_id: d.categoriaId ?? null,
    resumo: d.resumo?.trim() ?? null,
  };
  if (d.titulo !== undefined) mudancas["titulo"] = d.titulo.trim();
  if (d.conteudo !== undefined) mudancas["conteudo"] = d.conteudo.trim();
  if (d.status !== undefined) mudancas["status"] = d.status;

  const { data, error } = await getSupabaseServerClient()
    .from("artigos")
    .update(mudancas)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Artigo ${id} não encontrado`);
}

/**
 * Incremento direto no banco, sem ler antes: evita perder contagem
 * quando duas pessoas abrem o mesmo artigo ao mesmo tempo.
 */
export async function registrarVisualizacao(id: string): Promise<void> {
  const { error } = await getSupabaseServerClient().rpc("registrar_visualizacao_artigo", {
    p_id: id,
  });
  if (error) falha(error);
}