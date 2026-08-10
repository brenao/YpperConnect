import { consultar, consultarUm, executar } from "@/integrations/oracle/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
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

interface Linha extends Omit<Artigo, "geradoPorIa"> {
  geradoPorIa: number;
}

const SELECT_BASE = `
  SELECT a.id, a.titulo, a.categoria_id, ct.nome AS categoria_nome,
         a.resumo, a.conteudo, a.status, a.visualizacoes, a.gerado_por_ia,
         a.autor_id, u.nome AS autor_nome, a.criado_em, a.atualizado_em
    FROM artigos a
    LEFT JOIN categorias ct ON ct.id = a.categoria_id
    LEFT JOIN usuarios u ON u.id = a.autor_id`;

const mapear = (l: Linha): Artigo => ({ ...l, geradoPorIa: paraBool(l.geradoPorIa) });

function exigirTi(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio(`Somente a equipe de TI pode ${acao}`);
  }
}

export async function listarArtigos(): Promise<Artigo[]> {
  const linhas = await consultar<Linha>(`${SELECT_BASE} ORDER BY a.atualizado_em DESC`);
  return linhas.map(mapear);
}

export async function buscarArtigo(id: string): Promise<Artigo | null> {
  const l = await consultarUm<Linha>(`${SELECT_BASE} WHERE a.id = :id`, { id });
  return l ? mapear(l) : null;
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
  await executar(
    `INSERT INTO artigos
       (id, titulo, categoria_id, resumo, conteudo, status, visualizacoes,
        gerado_por_ia, autor_id, criado_em, atualizado_em)
     VALUES
       (:id, :titulo, :categoriaId, :resumo, :conteudo, :status, 0,
        :geradoPorIa, :autorId, SYSTIMESTAMP, SYSTIMESTAMP)`,
    {
      id,
      titulo: d.titulo.trim(),
      categoriaId: d.categoriaId ?? null,
      resumo: d.resumo?.trim() ?? null,
      conteudo: d.conteudo.trim(),
      // Artigo gerado por IA nasce em "revisar": ninguém publica texto
      // de modelo sem alguém ler antes.
      status: d.status ?? (d.geradoPorIa ? "revisar" : "rascunho"),
      geradoPorIa: deBool(d.geradoPorIa),
      autorId: ctx.id,
    },
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

  const n = await executar(
    `UPDATE artigos
        SET titulo = NVL(:titulo, titulo),
            categoria_id = :categoriaId,
            resumo = :resumo,
            conteudo = NVL(:conteudo, conteudo),
            status = NVL(:status, status),
            atualizado_em = SYSTIMESTAMP
      WHERE id = :id`,
    {
      id,
      titulo: d.titulo?.trim() ?? null,
      categoriaId: d.categoriaId ?? null,
      resumo: d.resumo?.trim() ?? null,
      conteudo: d.conteudo?.trim() ?? null,
      status: d.status ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Artigo ${id} não encontrado`);
}

/**
 * Incremento direto no banco, sem ler antes: evita perder contagem
 * quando duas pessoas abrem o mesmo artigo ao mesmo tempo.
 */
export async function registrarVisualizacao(id: string): Promise<void> {
  await executar(`UPDATE artigos SET visualizacoes = visualizacoes + 1 WHERE id = :id`, { id });
}
