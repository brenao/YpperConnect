import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Cadastro de empresas (tenants). SOMENTE SERVIDOR.
 *
 * Só operadores da plataforma. A checagem aqui dá a mensagem certa; quem
 * garante de fato é o banco (as funções recusam quem não é operador).
 */

export interface Empresa {
  id: string;
  nome: string;
  slug: string;
  criadoEm: string;
  usuarios: number;
  chamados: number;
}

export interface ResumoEmpresa {
  nome: string;
  slug: string;
  usuarios: number;
  sistemas: number;
  chamados: number;
  projetos: number;
}

function exigirOperador(ctx: ContextoUsuario): void {
  if (!ctx.adminPlataforma) throw new ErroDominio("Somente operadores da plataforma.");
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "23505") throw new ErroDominio(erro.message);
  if (erro.code === "42501") throw new ErroDominio("Somente operadores da plataforma.");
  if (erro.code === "P0002") throw new ErroDominio("Empresa não encontrada.");
  throw new Error(erro.message);
}

export async function listarEmpresas(ctx: ContextoUsuario): Promise<Empresa[]> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient().rpc("listar_empresas");
  if (error) falha(error);
  return ((data ?? []) as Record<string, unknown>[]).map((e) => ({
    id: e["id"] as string,
    nome: e["nome"] as string,
    slug: e["slug"] as string,
    criadoEm: e["criado_em"] as string,
    usuarios: Number(e["usuarios"]),
    chamados: Number(e["chamados"]),
  }));
}

/** Endereço da empresa: minúsculas, números e hífen, de 3 a 50 caracteres. */
export function validarSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    throw new ErroDominio(
      "Endereço inválido: use de 3 a 50 caracteres, só letras minúsculas, números e hífen.",
    );
  }
}

/**
 * Cria a empresa com o primeiro administrador. Devolve o link de convite
 * dele (ou nenhum, se ele já tem conta e já entrou alguma vez).
 */
export async function criarEmpresa(
  ctx: ContextoUsuario,
  d: { nome: string; slug: string; adminNome: string; adminEmail: string },
): Promise<{ id: string; link: string | null }> {
  exigirOperador(ctx);
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome da empresa");
  const slug = d.slug.trim().toLowerCase();
  validarSlug(slug);

  const { prepararConta } = await import("./usuarios.repo");
  const conta = await prepararConta(d.adminEmail, d.adminNome);

  const { data, error } = await getSupabaseServerClient().rpc("criar_empresa", {
    p_nome: d.nome.trim(),
    p_slug: slug,
    p_admin: conta.id,
  });
  if (error) falha(error);
  return { id: data as string, link: conta.link };
}

export async function resumoEmpresa(ctx: ContextoUsuario, id: string): Promise<ResumoEmpresa> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient()
    .rpc("resumo_empresa", { p_id: id })
    .single();
  if (error) falha(error);
  const r = data as Record<string, unknown>;
  return {
    nome: r["nome"] as string,
    slug: r["slug"] as string,
    usuarios: Number(r["usuarios"]),
    sistemas: Number(r["sistemas"]),
    chamados: Number(r["chamados"]),
    projetos: Number(r["projetos"]),
  };
}

/** Exclusão lógica. `confirmacao` precisa ser o endereço (slug) da empresa. */
export async function excluirEmpresa(
  ctx: ContextoUsuario,
  id: string,
  confirmacao: string,
): Promise<void> {
  exigirOperador(ctx);
  if (id === ctx.tenantId) {
    throw new ErroDominio("Você está trabalhando nesta empresa agora. Troque de empresa antes.");
  }
  const { error } = await getSupabaseServerClient().rpc("excluir_empresa", {
    p_id: id,
    p_confirmacao: confirmacao,
  });
  if (error) {
    if (error.message.includes("Confirmacao")) {
      throw new ErroDominio("A confirmação não confere com o endereço da empresa.");
    }
    falha(error);
  }
}
