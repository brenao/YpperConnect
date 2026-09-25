import { getRequestUrl } from "@tanstack/react-start/server";
import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Usuários da empresa. Mesma interface do repositório legado.
 *
 * Por dentro, um usuário é a soma de duas coisas:
 *   - a pessoa (`usuarios`): nome e e-mail, a mesma em todas as empresas;
 *   - o vínculo com a empresa (`tenant_membros`): login, departamento,
 *     equipe, perfil, administrador e situação — o que era da tabela
 *     `usuarios` do legado e varia de empresa para empresa.
 *
 * Diferença de login: sem AD/GLPI, criar um usuário cria a conta dele no
 * Supabase Auth e devolve um link para ele definir a senha.
 */

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  login: string;
  departamento: string | null;
  equipeId: string | null;
  equipeNome: string | null;
  perfilId: string | null;
  /** manual, convite, dominio, sso... Exibido em caixa alta na tela. */
  origem: string;
  admin: boolean;
  ativo: boolean;
}

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "23505") throw new ErroDominio("Este login já está em uso nesta empresa.");
  if (erro.code === "42501")
    throw new ErroDominio("Somente administradores podem alterar usuários");
  throw new Error(erro.message);
}

/** Lê membros + pessoas + equipes e monta o formato do legado. */
async function carregar(filtro: {
  apenasAtivos?: boolean;
  id?: string;
  login?: string;
  comEquipe?: boolean;
}): Promise<Usuario[]> {
  const tenantId = await tenantAtual();
  const sb = getSupabaseServerClient();

  let q = sb
    .from("tenant_membros")
    .select("usuario_id, login, departamento, equipe_id, perfil_id, origem, admin, ativo")
    .eq("tenant_id", tenantId);
  if (filtro.apenasAtivos) q = q.eq("ativo", true);
  if (filtro.id) q = q.eq("usuario_id", filtro.id);
  if (filtro.login) q = q.eq("login", filtro.login);
  if (filtro.comEquipe) q = q.not("equipe_id", "is", null);

  const [membros, equipes] = await Promise.all([
    q,
    sb.from("equipes").select("id, nome").eq("tenant_id", tenantId),
  ]);
  if (membros.error) falha(membros.error);
  if (equipes.error) falha(equipes.error);

  const linhas = membros.data ?? [];
  const pessoas = new Map<string, { nome: string; email: string }>();
  const ids = linhas.map((m) => m.usuario_id as string);

  // Em lotes: a lista vai na URL da API e 700 UUIDs estourariam o limite.
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from("usuarios")
      .select("id, nome, email")
      .in("id", ids.slice(i, i + 200));
    if (error) falha(error);
    for (const u of data ?? []) {
      pessoas.set(u.id as string, { nome: u.nome as string, email: (u.email as string) ?? "" });
    }
  }

  const nomeEquipe = new Map((equipes.data ?? []).map((e) => [e.id as string, e.nome as string]));

  return linhas
    .map((m) => {
      const id = m.usuario_id as string;
      const equipeId = (m.equipe_id as string | null) ?? null;
      return {
        id,
        nome: pessoas.get(id)?.nome ?? "",
        email: pessoas.get(id)?.email ?? "",
        login: (m.login as string | null) ?? "",
        departamento: (m.departamento as string | null) ?? null,
        equipeId,
        equipeNome: equipeId ? (nomeEquipe.get(equipeId) ?? null) : null,
        perfilId: (m.perfil_id as string | null) ?? null,
        origem: m.origem as string,
        admin: m.admin as boolean,
        ativo: m.ativo as boolean,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function listarUsuarios(apenasAtivos = true): Promise<Usuario[]> {
  return carregar({ apenasAtivos });
}

export async function buscarUsuario(id: string): Promise<Usuario | null> {
  return (await carregar({ id }))[0] ?? null;
}

export async function buscarUsuarioPorLogin(login: string): Promise<Usuario | null> {
  return (await carregar({ login }))[0] ?? null;
}

export async function listarAtendentes(): Promise<Usuario[]> {
  return carregar({ apenasAtivos: true, comEquipe: true });
}

export interface DadosUsuario {
  id: string;
  nome: string;
  email: string;
  login: string;
  departamento?: string | null | undefined;
  equipeId?: string | null | undefined;
  perfilId?: string | null | undefined;
  admin?: boolean | undefined;
}

export interface AlteracaoUsuario {
  nome?: string | undefined;
  email?: string | undefined;
  login?: string | undefined;
  departamento?: string | null | undefined;
  equipeId?: string | null | undefined;
  perfilId?: string | null | undefined;
  admin?: boolean | undefined;
}

// ------------------------------------------------------------------ login

/**
 * Endereço público do app, para os links. APP_URL no .env ganha da
 * requisição: atrás de proxy, a URL que chega ao servidor é a interna.
 */
function urlDoApp(): string {
  const configurada = process.env["APP_URL"]?.replace(/\/$/, "");
  if (configurada) return configurada;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${getRequestUrl().origin}${base}`;
}

function montarLink(tokenHash: string, tipo: "invite" | "email"): string {
  return `${urlDoApp()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${tipo}`;
}

/**
 * Cria o usuário na empresa.
 *
 * - E-mail sem conta: cria a conta e devolve o link de convite.
 * - Conta que já existe (em outra empresa): só vincula; a pessoa entra
 *   com a senha que já tem. Se nunca entrou, devolve um link novo.
 */
export async function criarUsuario(
  ctx: ContextoUsuario,
  d: DadosUsuario,
): Promise<{ id: string; link: string | null }> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem criar usuários");

  const email = d.email.trim().toLowerCase();
  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const admin = getSupabaseAdmin();

  const existente = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
  if (existente.error) throw new Error(existente.error.message);

  let id: string;
  let link: string | null = null;

  if (existente.data) {
    id = existente.data.id as string;
    const conta = await admin.auth.admin.getUserById(id);
    if (!conta.data.user?.last_sign_in_at) {
      const gerado = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (gerado.error) throw new Error(gerado.error.message);
      link = montarLink(gerado.data.properties.hashed_token, "email");
    }
  } else {
    const gerado = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: d.nome.trim() } },
    });
    if (gerado.error) throw new Error(gerado.error.message);
    id = gerado.data.user.id;
    link = montarLink(gerado.data.properties.hashed_token, "invite");
  }

  // Vínculo com a sessão de quem cadastrou: RLS e auditoria registram o autor.
  const { error } = await getSupabaseServerClient()
    .from("tenant_membros")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        usuario_id: id,
        tipo: "interno",
        origem: "manual",
        login: d.login.trim(),
        departamento: d.departamento ?? null,
        equipe_id: d.equipeId ?? null,
        perfil_id: d.perfilId ?? null,
        admin: d.admin ?? false,
        ativo: true,
      },
      { onConflict: "tenant_id,usuario_id" },
    );
  if (error) falha(error);

  return { id, link };
}

/**
 * Altera o usuário. Departamento, equipe, perfil e administrador são da
 * empresa. O nome é da pessoa (vale em todas as empresas dela).
 *
 * O e-mail é o login da conta: trocá-lo aqui mudaria o acesso da pessoa
 * em todas as empresas, então fica bloqueado nesta tela.
 */
export async function atualizarUsuario(
  ctx: ContextoUsuario,
  id: string,
  d: AlteracaoUsuario,
): Promise<void> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar usuários");

  const atual = await buscarUsuario(id);
  if (!atual) throw new ErroDominio(`Usuário ${id} não encontrado`);

  if (d.email !== undefined && d.email.trim().toLowerCase() !== atual.email.toLowerCase()) {
    throw new ErroDominio(
      "O e-mail é o login da pessoa e não pode ser alterado aqui. Cadastre o novo e-mail como outro usuário.",
    );
  }

  const mudancas: Record<string, unknown> = {
    departamento: d.departamento ?? null,
    equipe_id: d.equipeId ?? null,
    perfil_id: d.perfilId ?? null,
  };
  if (d.admin !== undefined) mudancas["admin"] = d.admin;

  const { data, error } = await getSupabaseServerClient()
    .from("tenant_membros")
    .update(mudancas)
    .eq("tenant_id", ctx.tenantId)
    .eq("usuario_id", id)
    .select("usuario_id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Usuário ${id} não encontrado`);

  if (d.nome !== undefined && d.nome.trim() && d.nome.trim() !== atual.nome) {
    // A pessoa é global e o RLS só deixa cada um editar o próprio nome;
    // o vínculo já foi conferido acima, então a chave administrativa grava.
    const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const r = await getSupabaseAdmin()
      .from("usuarios")
      .update({ nome: d.nome.trim() })
      .eq("id", id);
    if (r.error) throw new Error(r.error.message);
  }
}

/**
 * Desativa em vez de excluir. Chamados históricos referenciam o usuário
 * por FK, e a trilha de auditoria não pode perder o autor.
 */
export async function definirUsuarioAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar usuários");
  if (id === ctx.id && !ativo) throw new ErroDominio("Você não pode desativar a si mesmo");

  const { error } = await getSupabaseServerClient()
    .from("tenant_membros")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("usuario_id", id);
  if (error) falha(error);
}

/** Link de acesso avulso: primeiro acesso ou senha esquecida. */
export async function gerarLinkDeAcesso(ctx: ContextoUsuario, id: string): Promise<string> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem gerar link de acesso");
  const u = await buscarUsuario(id);
  if (!u) throw new ErroDominio("Esta pessoa não é usuária desta empresa.");
  if (!u.email) throw new ErroDominio("Este usuário não tem e-mail.");

  const { getSupabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const gerado = await getSupabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email: u.email,
  });
  if (gerado.error) throw new Error(gerado.error.message);
  return montarLink(gerado.data.properties.hashed_token, "email");
}
