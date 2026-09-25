import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { getSupabaseServerClient } from "@/integrations/supabase/server";

/**
 * Contexto de identidade da aplicação. SOMENTE SERVIDOR.
 *
 * Quem autentica é o Supabase Auth: a sessão vive em cookies httpOnly
 * gravados pelo @supabase/ssr. Aqui descobrimos QUEM é a pessoa, em QUAL
 * empresa (tenant) ela está trabalhando e O QUE pode fazer nela.
 *
 * O tenant ativo fica no cookie `bo_tenant` (slug). O cookie é só uma
 * preferência: a cada requisição ele é conferido contra os vínculos
 * reais da pessoa no banco, então trocar o valor à mão não dá acesso a
 * empresa nenhuma — o RLS barraria de qualquer jeito.
 */

/** Chaves do catálogo `public.permissoes` usadas pelo módulo de projetos. */
export const FEATURE_PROJETOS_DIRETORIA = "projeto.diretoria";
export const FEATURE_PROJETOS_PORTFOLIO = "projeto.ver_portfolio";

export const COOKIE_TENANT = "bo_tenant";

const OPCOES_COOKIE_TENANT = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env["NODE_ENV"] === "production",
  maxAge: 60 * 60 * 24 * 365,
};

export interface TenantResumo {
  id: string;
  slug: string;
  nome: string;
  /** interno = equipe de quem presta o serviço; cliente = solicitante externo. */
  tipo: "interno" | "cliente";
}

export interface ContextoUsuario {
  id: string;
  nome: string;
  email: string;

  /** Empresa em que a pessoa está trabalhando agora. */
  tenantId: string;
  tenantSlug: string;
  tenantNome: string;
  tipoMembro: "interno" | "cliente";
  /** Todas as empresas a que a pessoa tem acesso (para o seletor). */
  tenants: TenantResumo[];
  /** Permissões de escopo tenant, do catálogo `public.permissoes`. */
  permissoes: string[];
  /** Operador da plataforma (equipe Ypper Tech). */
  adminPlataforma: boolean;

  // ------------------------------------------------------------------
  // Campos do modelo antigo, mantidos para as telas legadas compilarem
  // enquanto são migradas. Não use em código novo.
  // ------------------------------------------------------------------
  /** Tem `tenant.configurar` no tenant ativo. */
  admin: boolean;
  /** Sem equivalente no modelo novo (papéis substituem perfis). */
  perfilId: string | null;
  /** Equipes voltam no passo de cadastros. */
  equipeId: string | null;
  /** Igual a `permissoes`. */
  funcionalidades: string[];
  visaoDiretoriaProjetos: boolean;
  gestorPortfolio: boolean;
  coachProjetos: boolean;
}

export type Sessao =
  | { estado: "anonimo" }
  | { estado: "sem_tenant"; nome: string; email: string }
  | { estado: "ok"; ctx: ContextoUsuario };

export class NaoAutenticadoError extends Error {
  constructor(mensagem = "Sessão expirada. Entre novamente.") {
    super(mensagem);
    this.name = "NaoAutenticadoError";
  }
}

/**
 * Lê a sessão sem lançar erro. Usada pelo guarda de rotas e pela tela
 * de login, que precisam distinguir "não logou" de "logou mas não tem
 * empresa".
 */
export async function getSessao(): Promise<Sessao> {
  const supabase = getSupabaseServerClient();

  // getUser() confere o token no servidor do Auth. getSession() apenas
  // leria o cookie, que o navegador pode ter adulterado.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { estado: "anonimo" };

  const [perfil, tenantsRes, adminRes] = await Promise.all([
    supabase.from("usuarios").select("nome, email").eq("id", user.id).maybeSingle(),
    supabase.rpc("meus_tenants"),
    supabase.rpc("sou_admin_plataforma"),
  ]);

  if (tenantsRes.error) {
    throw new Error(`Falha ao carregar as empresas do usuário: ${tenantsRes.error.message}`);
  }

  const nome = (perfil.data?.nome as string | undefined) ?? user.email ?? "Usuário";
  const email = (perfil.data?.email as string | undefined) ?? user.email ?? "";
  const tenants = (tenantsRes.data ?? []) as TenantResumo[];

  if (tenants.length === 0) return { estado: "sem_tenant", nome, email };

  const preferido = getCookie(COOKIE_TENANT);
  const tenant = tenants.find((t) => t.slug === preferido) ?? tenants[0]!;
  if (tenant.slug !== preferido) setCookie(COOKIE_TENANT, tenant.slug, OPCOES_COOKIE_TENANT);

  const permRes = await supabase.rpc("minhas_permissoes", { p_tenant: tenant.id });
  if (permRes.error) {
    throw new Error(`Falha ao carregar as permissões: ${permRes.error.message}`);
  }
  const permissoes = (permRes.data ?? []) as string[];

  return {
    estado: "ok",
    ctx: {
      id: user.id,
      nome,
      email,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantNome: tenant.nome,
      tipoMembro: tenant.tipo,
      tenants,
      permissoes,
      adminPlataforma: adminRes.data === true,
      admin: permissoes.includes("tenant.configurar"),
      perfilId: null,
      equipeId: null,
      funcionalidades: permissoes,
      visaoDiretoriaProjetos: permissoes.includes(FEATURE_PROJETOS_DIRETORIA),
      gestorPortfolio: permissoes.includes(FEATURE_PROJETOS_PORTFOLIO),
      coachProjetos: true,
    },
  };
}

/** Contexto obrigatório. Usado pelas server functions de negócio. */
export async function getUsuarioAtual(): Promise<ContextoUsuario> {
  const sessao = await getSessao();
  if (sessao.estado === "anonimo") throw new NaoAutenticadoError();
  if (sessao.estado === "sem_tenant") {
    throw new Error(
      "Seu usuário não está vinculado a nenhuma empresa. Peça acesso ao administrador.",
    );
  }
  return sessao.ctx;
}

export async function entrar(email: string, senha: string): Promise<{ erro: string | null }> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (!error) return { erro: null };
  if (error.code === "invalid_credentials") return { erro: "E-mail ou senha incorretos." };
  if (error.code === "email_not_confirmed") return { erro: "Confirme seu e-mail antes de entrar." };
  return { erro: error.message };
}

export async function sair(): Promise<void> {
  const supabase = getSupabaseServerClient();
  await supabase.auth.signOut();
  deleteCookie(COOKIE_TENANT, { path: "/" });
}

/** Troca o tenant ativo, desde que a pessoa tenha vínculo com ele. */
export async function trocarTenant(slug: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("meus_tenants");
  if (error) throw new Error(error.message);
  const existe = ((data ?? []) as TenantResumo[]).some((t) => t.slug === slug);
  if (!existe) throw new Error("Você não tem acesso a esta empresa.");
  setCookie(COOKIE_TENANT, slug, OPCOES_COOKIE_TENANT);
}
