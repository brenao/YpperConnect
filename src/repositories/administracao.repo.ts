import { getRequestUrl } from "@tanstack/react-start/server";
import { getSupabaseServerClient } from "@/integrations/supabase/server";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Administração do tenant: membros, papéis, equipes e categorias.
 * SOMENTE SERVIDOR.
 *
 * Tudo roda com a sessão de quem chamou, então o RLS confere de novo
 * cada gravação. A checagem de permissão daqui existe para devolver uma
 * mensagem clara em vez de "0 linhas alteradas".
 */

export interface Membro {
  usuarioId: string;
  nome: string;
  email: string | null;
  tipo: "interno" | "cliente";
  ativo: boolean;
  origem: string;
  equipeId: string | null;
  papelId: string | null;
  criadoEm: string;
}

export interface PapelResumo {
  id: string;
  chave: string;
  nome: string;
  sistema: boolean;
}

export interface Equipe {
  id: string;
  nome: string;
  ativo: boolean;
  membros: number;
}

export type EscopoCategoria = "chamado" | "servico" | "artigo" | "sistema";

export interface Categoria {
  id: string;
  nome: string;
  escopo: EscopoCategoria;
  ativo: boolean;
}

// ------------------------------------------------------------------ apoio

function exigir(ctx: ContextoUsuario, permissao: string) {
  if (!ctx.permissoes.includes(permissao)) {
    throw new Error("Você não tem permissão para esta ação.");
  }
}

/** Traduz os erros do Postgres que a pessoa consegue resolver. */
function falha(erro: { code?: string; message: string }, duplicado = "Registro duplicado."): never {
  if (erro.code === "23505") throw new Error(duplicado);
  if (erro.code === "42501") throw new Error("Você não tem permissão para esta ação.");
  throw new Error(erro.message);
}

/**
 * UPDATE barrado pelo RLS não dá erro: só não altera nada. Pedir as
 * linhas de volta é o que transforma o silêncio em mensagem.
 */
function exigirAlterado(linhas: unknown[] | null) {
  if (!linhas || linhas.length === 0) {
    throw new Error("Registro não encontrado ou sem permissão para alterar.");
  }
}

/**
 * Endereço público do app, para montar links de convite.
 * APP_URL no .env ganha da requisição: atrás de proxy, a URL que chega
 * ao servidor é a interna, não a que a pessoa vai abrir.
 */
function urlDoApp(): string {
  const configurada = process.env["APP_URL"]?.replace(/\/$/, "");
  const origem = configurada ?? getRequestUrl().origin;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return configurada ? origem : `${origem}${base}`;
}

function linkDeAcesso(tokenHash: string, tipo: "invite" | "email"): string {
  return `${urlDoApp()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${tipo}`;
}

// ------------------------------------------------------------------ papéis

export async function listarPapeis(ctx: ContextoUsuario): Promise<PapelResumo[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("papeis")
    .select("id, chave, nome, sistema")
    .eq("tenant_id", ctx.tenantId)
    .eq("ativo", true)
    .order("nome");
  if (error) falha(error);
  return (data ?? []) as PapelResumo[];
}

// ------------------------------------------------------------------ membros

export async function listarMembros(ctx: ContextoUsuario): Promise<Membro[]> {
  const sb = getSupabaseServerClient();

  const [membros, atribuicoes] = await Promise.all([
    sb
      .from("tenant_membros")
      .select("usuario_id, tipo, ativo, origem, equipe_id, criado_em")
      .eq("tenant_id", ctx.tenantId),
    sb
      .from("atribuicoes")
      .select("usuario_id, papel_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("escopo_tipo", "tenant"),
  ]);
  if (membros.error) falha(membros.error);
  if (atribuicoes.error) falha(atribuicoes.error);

  const linhas = membros.data ?? [];
  const ids = linhas.map((m) => m.usuario_id as string);
  const pessoas = new Map<string, { nome: string; email: string | null }>();

  if (ids.length > 0) {
    const { data, error } = await sb.from("usuarios").select("id, nome, email").in("id", ids);
    if (error) falha(error);
    for (const u of data ?? []) {
      pessoas.set(u.id as string, { nome: u.nome as string, email: (u.email as string) ?? null });
    }
  }

  const papelDe = new Map<string, string>();
  for (const a of atribuicoes.data ?? []) {
    if (!papelDe.has(a.usuario_id as string)) {
      papelDe.set(a.usuario_id as string, a.papel_id as string);
    }
  }

  return linhas
    .map((m) => {
      const id = m.usuario_id as string;
      const pessoa = pessoas.get(id);
      return {
        usuarioId: id,
        nome: pessoa?.nome ?? "—",
        email: pessoa?.email ?? null,
        tipo: m.tipo as "interno" | "cliente",
        ativo: m.ativo as boolean,
        origem: m.origem as string,
        equipeId: (m.equipe_id as string) ?? null,
        papelId: papelDe.get(id) ?? null,
        criadoEm: m.criado_em as string,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Troca o papel de escopo tenant da pessoa (um papel por pessoa na tela). */
export async function definirPapel(ctx: ContextoUsuario, usuarioId: string, papelId: string) {
  exigir(ctx, "papel.gerenciar");
  const sb = getSupabaseServerClient();

  if (usuarioId === ctx.id) {
    const { data } = await sb.from("papeis").select("chave").eq("id", papelId).maybeSingle();
    if (data?.chave !== "admin_tenant") {
      throw new Error(
        "Você não pode tirar o próprio acesso de administrador. Peça a outro administrador.",
      );
    }
  }

  const apagar = await sb
    .from("atribuicoes")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("usuario_id", usuarioId)
    .eq("escopo_tipo", "tenant");
  if (apagar.error) falha(apagar.error);

  const incluir = await sb
    .from("atribuicoes")
    .insert({ tenant_id: ctx.tenantId, usuario_id: usuarioId, papel_id: papelId });
  if (incluir.error) falha(incluir.error);
}

export async function definirEquipeDoMembro(
  ctx: ContextoUsuario,
  usuarioId: string,
  equipeId: string | null,
) {
  exigir(ctx, "usuario.gerenciar");
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("tenant_membros")
    .update({ equipe_id: equipeId })
    .eq("tenant_id", ctx.tenantId)
    .eq("usuario_id", usuarioId)
    .select("usuario_id");
  if (error) falha(error);
  exigirAlterado(data);
}

export async function definirMembroAtivo(ctx: ContextoUsuario, usuarioId: string, ativo: boolean) {
  exigir(ctx, "usuario.gerenciar");
  if (usuarioId === ctx.id && !ativo) {
    throw new Error("Você não pode desativar o próprio acesso.");
  }
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("tenant_membros")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("usuario_id", usuarioId)
    .select("usuario_id");
  if (error) falha(error);
  exigirAlterado(data);
}

/**
 * Convida alguém para o tenant.
 *
 * - E-mail sem conta: cria a conta no Auth e devolve um link de convite.
 * - Conta que já existe (em outra empresa, por exemplo): só vincula.
 *   A pessoa entra com a senha que já tem e passa a ver as duas empresas.
 * - Conta que existe mas nunca entrou: devolve um link novo de acesso.
 *
 * O link é devolvido para o administrador enviar pelo canal que quiser.
 * O e-mail automático entra no passo de notificações.
 */
export async function convidarMembro(
  ctx: ContextoUsuario,
  dados: { email: string; nome: string; papelId: string; equipeId: string | null },
): Promise<{ link: string | null; jaTinhaConta: boolean }> {
  exigir(ctx, "usuario.gerenciar");
  exigir(ctx, "papel.gerenciar");

  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const admin = getSupabaseAdmin();

  const existente = await admin
    .from("usuarios")
    .select("id")
    .eq("email", dados.email)
    .maybeSingle();
  if (existente.error) falha(existente.error);

  let usuarioId: string;
  let link: string | null = null;
  const jaTinhaConta = !!existente.data;

  if (existente.data) {
    usuarioId = existente.data.id as string;
    const conta = await admin.auth.admin.getUserById(usuarioId);
    if (!conta.data.user?.last_sign_in_at) {
      const gerado = await admin.auth.admin.generateLink({ type: "magiclink", email: dados.email });
      if (gerado.error) throw new Error(gerado.error.message);
      link = linkDeAcesso(gerado.data.properties.hashed_token, "email");
    }
  } else {
    const gerado = await admin.auth.admin.generateLink({
      type: "invite",
      email: dados.email,
      options: { data: { full_name: dados.nome } },
    });
    if (gerado.error) throw new Error(gerado.error.message);
    usuarioId = gerado.data.user.id;
    link = linkDeAcesso(gerado.data.properties.hashed_token, "invite");
  }

  // Vínculo e papel com a sessão de quem convidou: RLS + auditoria.
  const sb = getSupabaseServerClient();
  const vinculo = await sb.from("tenant_membros").upsert(
    {
      tenant_id: ctx.tenantId,
      usuario_id: usuarioId,
      tipo: "interno",
      equipe_id: dados.equipeId,
      origem: "convite",
      ativo: true,
    },
    { onConflict: "tenant_id,usuario_id" },
  );
  if (vinculo.error) falha(vinculo.error);

  await definirPapel(ctx, usuarioId, dados.papelId);

  return { link, jaTinhaConta };
}

/** Link de acesso avulso: serve para quem perdeu o convite ou a senha. */
export async function gerarLinkDeAcesso(ctx: ContextoUsuario, usuarioId: string): Promise<string> {
  exigir(ctx, "usuario.gerenciar");

  // Só gera link para quem é membro deste tenant.
  const sb = getSupabaseServerClient();
  const membro = await sb
    .from("tenant_membros")
    .select("usuario_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (membro.error) falha(membro.error);
  if (!membro.data) throw new Error("Esta pessoa não é membro da empresa.");

  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const admin = getSupabaseAdmin();
  const conta = await admin.auth.admin.getUserById(usuarioId);
  const email = conta.data.user?.email;
  if (!email) throw new Error("Esta conta não tem e-mail.");

  const gerado = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (gerado.error) throw new Error(gerado.error.message);
  return linkDeAcesso(gerado.data.properties.hashed_token, "email");
}

// ------------------------------------------------------------------ equipes

export async function listarEquipes(ctx: ContextoUsuario): Promise<Equipe[]> {
  const sb = getSupabaseServerClient();
  const [equipes, membros] = await Promise.all([
    sb.from("equipes").select("id, nome, ativo").eq("tenant_id", ctx.tenantId).order("nome"),
    sb.from("tenant_membros").select("equipe_id").eq("tenant_id", ctx.tenantId).eq("ativo", true),
  ]);
  if (equipes.error) falha(equipes.error);
  if (membros.error) falha(membros.error);

  const contagem = new Map<string, number>();
  for (const m of membros.data ?? []) {
    const id = m.equipe_id as string | null;
    if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return (equipes.data ?? []).map((e) => ({
    id: e.id as string,
    nome: e.nome as string,
    ativo: e.ativo as boolean,
    membros: contagem.get(e.id as string) ?? 0,
  }));
}

export async function criarEquipe(ctx: ContextoUsuario, nome: string) {
  exigir(ctx, "cadastro.gerenciar");
  const sb = getSupabaseServerClient();
  const { error } = await sb.from("equipes").insert({ tenant_id: ctx.tenantId, nome });
  if (error) falha(error, "Já existe uma equipe com esse nome.");
}

export async function atualizarEquipe(
  ctx: ContextoUsuario,
  id: string,
  mudancas: { nome?: string; ativo?: boolean },
) {
  exigir(ctx, "cadastro.gerenciar");
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("equipes")
    .update(mudancas)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error, "Já existe uma equipe com esse nome.");
  exigirAlterado(data);
}

// ------------------------------------------------------------------ categorias

export async function listarCategorias(ctx: ContextoUsuario): Promise<Categoria[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("categorias")
    .select("id, nome, escopo, ativo")
    .eq("tenant_id", ctx.tenantId)
    .order("escopo")
    .order("nome");
  if (error) falha(error);
  return (data ?? []) as Categoria[];
}

export async function criarCategoria(
  ctx: ContextoUsuario,
  dados: { nome: string; escopo: EscopoCategoria },
) {
  exigir(ctx, "cadastro.gerenciar");
  const sb = getSupabaseServerClient();
  const { error } = await sb.from("categorias").insert({ tenant_id: ctx.tenantId, ...dados });
  if (error) falha(error, "Já existe uma categoria com esse nome neste escopo.");
}

export async function atualizarCategoria(
  ctx: ContextoUsuario,
  id: string,
  mudancas: { nome?: string; ativo?: boolean },
) {
  exigir(ctx, "cadastro.gerenciar");
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("categorias")
    .update(mudancas)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error, "Já existe uma categoria com esse nome neste escopo.");
  exigirAlterado(data);
}
