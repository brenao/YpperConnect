import { checar, data, db, linhas } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/** Base de conhecimento: procedimentos e soluções recorrentes. */

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

interface LinhaArtigo {
  id: string;
  titulo: string;
  categoria_id: string | null;
  resumo: string | null;
  conteudo: string;
  status: string;
  visualizacoes: number;
  gerado_por_ia: boolean;
  autor_id: string | null;
  criado_em: string;
  atualizado_em: string;
  categorias: { nome: string } | null;
  usuarios: { nome: string } | null;
}

const SELECT_BASE = `
  id, titulo, categoria_id, resumo, conteudo, status, visualizacoes, gerado_por_ia,
  autor_id, criado_em, atualizado_em,
  categorias ( nome ),
  usuarios ( nome )
`;

const mapear = (l: LinhaArtigo): Artigo => ({
  id: l.id,
  titulo: l.titulo,
  categoriaId: l.categoria_id,
  categoriaNome: l.categorias?.nome ?? null,
  resumo: l.resumo,
  conteudo: l.conteudo,
  status: l.status as StatusArtigo,
  visualizacoes: l.visualizacoes,
  geradoPorIa: l.gerado_por_ia,
  autorId: l.autor_id,
  autorNome: l.usuarios?.nome ?? null,
  criadoEm: data(l.criado_em),
  atualizadoEm: data(l.atualizado_em),
});

function exigirTi(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio(`Somente a equipe de TI pode ${acao}`);
  }
}

export async function listarArtigos(): Promise<Artigo[]> {
  const l = linhas(
    await db.from("artigos").select(SELECT_BASE).order("atualizado_em", { ascending: false }),
  );
  return (l as unknown as LinhaArtigo[]).map(mapear);
}

export async function buscarArtigo(id: string): Promise<Artigo | null> {
  const r = await db.from("artigos").select(SELECT_BASE).eq("id", id).maybeSingle();
  const l = checar(r);
  return l ? mapear(l as unknown as LinhaArtigo) : null;
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

  const id = crypto.randomUUID();
  const agoraIso = new Date().toISOString();
  checar(
    await db.from("artigos").insert({
      id,
      titulo: d.titulo.trim(),
      categoria_id: d.categoriaId ?? null,
      resumo: d.resumo?.trim() ?? null,
      conteudo: d.conteudo.trim(),
      visualizacoes: 0,
      // Artigo gerado por IA nasce em "revisar": ninguém publica texto
      // de modelo sem alguém ler antes.
      status: d.status ?? (d.geradoPorIa ? "revisar" : "rascunho"),
      gerado_por_ia: d.geradoPorIa ?? false,
      autor_id: ctx.id,
      criado_em: agoraIso,
      atualizado_em: agoraIso,
    }),
  );
  return id;
}

export interface AlteracaoArtigo {
  titulo?: string | undefined;
  categoriaId?: string | null | undefined;
  resumo?: string | null | undefined;
  conteudo?: string | undefined;
  status?: StatusArtigo | undefined;
}

export async function atualizarArtigo(
  ctx: ContextoUsuario,
  id: string,
  d: AlteracaoArtigo,
): Promise<void> {
  exigirTi(ctx, "alterar artigos");

  const atual = await buscarArtigo(id);
  if (!atual) throw new ErroDominio(`Artigo ${id} não encontrado`);

  checar(
    await db
      .from("artigos")
      .update({
        titulo: d.titulo?.trim() ?? atual.titulo,
        categoria_id: d.categoriaId ?? null,
        resumo: d.resumo?.trim() ?? null,
        conteudo: d.conteudo?.trim() ?? atual.conteudo,
        status: d.status ?? atual.status,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", id),
  );
}

/**
 * O Oracle fazia o incremento direto no banco (visualizacoes = visualizacoes + 1),
 * atômico e sem round-trip de leitura. O PostgREST não expõe expressões de
 * coluna em UPDATE, então aqui lemos o valor atual e gravamos +1: o incremento
 * deixou de ser atômico e pode perder contagem sob concorrência alta.
 */
export async function registrarVisualizacao(id: string): Promise<void> {
  const r = await db.from("artigos").select("visualizacoes").eq("id", id).maybeSingle();
  const atual = checar(r);
  if (!atual) return;
  checar(
    await db
      .from("artigos")
      .update({ visualizacoes: atual.visualizacoes + 1 })
      .eq("id", id),
  );
}
