import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
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

/**
 * Enxerga o portfólio inteiro, em leitura (visão de diretoria).
 * Chaves de `perfil_features`, iguais às do legado.
 */
export const FEATURE_PROJETOS_DIRETORIA = "projetos.visao_diretoria";
/** Enxerga os projetos da própria equipe, em leitura. */
export const FEATURE_PROJETOS_PORTFOLIO = "projetos.portfolio";
/** Vê o instrutor de cronograma no detalhe do projeto. */
export const FEATURE_PROJETOS_COACH = "projetos.coach";

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
  /** Vazio só em conta sem e-mail; mantido `string` como no legado. */
  email: string;
  admin: boolean;
  perfilId: string | null;
  equipeId: string | null;
  /** Chaves de `perfil_features` do perfil do usuário. */
  funcionalidades: string[];
  /** Chaves de `perfil_modulos` do perfil do usuário. */
  modulos: string[];
  /** Atalhos dos papéis de projeto, para não espalhar string mágica. */
  visaoDiretoriaProjetos: boolean;
  gestorPortfolio: boolean;
  /** Instrutor de cronograma. O administrador vê sempre. */
  coachProjetos: boolean;

  // ------------------------------------------------------------------
  // Multi-empresa
  // ------------------------------------------------------------------
  /** Empresa em que a pessoa está trabalhando agora. */
  tenantId: string;
  tenantSlug: string;
  tenantNome: string;
  tipoMembro: "interno" | "cliente";
  /** Todas as empresas a que a pessoa tem acesso (para o seletor). */
  tenants: TenantResumo[];
  /** Operador da plataforma (equipe Ypper Tech). */
  adminPlataforma: boolean;
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
 * Uma leitura de sessão por requisição.
 *
 * Várias funções do servidor perguntam "quem é e em qual empresa?" na
 * mesma requisição — o motor de calendário, por exemplo, a cada cálculo.
 * Sem isto, cada pergunta custaria quatro idas ao Supabase. A chave é o
 * próprio objeto Request, que o WeakMap solta quando a requisição acaba.
 */
const sessaoPorRequisicao = new WeakMap<Request, Promise<Sessao>>();

/**
 * Lê a sessão sem lançar erro. Usada pelo guarda de rotas e pela tela
 * de login, que precisam distinguir "não logou" de "logou mas não tem
 * empresa".
 */
export function getSessao(): Promise<Sessao> {
  const requisicao = getRequest();
  const pronta = sessaoPorRequisicao.get(requisicao);
  if (pronta) return pronta;
  const nova = lerSessao();
  sessaoPorRequisicao.set(requisicao, nova);
  // Falha não fica guardada: a próxima pergunta tenta de novo.
  nova.catch(() => sessaoPorRequisicao.delete(requisicao));
  return nova;
}

async function lerSessao(): Promise<Sessao> {
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

  const acessoRes = await supabase.rpc("meu_acesso", { p_tenant: tenant.id });
  if (acessoRes.error) {
    throw new Error(`Falha ao carregar o perfil de acesso: ${acessoRes.error.message}`);
  }
  const acesso = (acessoRes.data ?? {}) as {
    admin?: boolean;
    perfil_id?: string | null;
    equipe_id?: string | null;
    modulos?: string[];
    funcionalidades?: string[];
  };

  const admin = acesso.admin === true;
  const funcionalidades = acesso.funcionalidades ?? [];

  return {
    estado: "ok",
    ctx: {
      id: user.id,
      nome,
      email,
      admin,
      perfilId: acesso.perfil_id ?? null,
      equipeId: acesso.equipe_id ?? null,
      funcionalidades,
      modulos: acesso.modulos ?? [],
      visaoDiretoriaProjetos: funcionalidades.includes(FEATURE_PROJETOS_DIRETORIA),
      gestorPortfolio: funcionalidades.includes(FEATURE_PROJETOS_PORTFOLIO),
      coachProjetos: admin || funcionalidades.includes(FEATURE_PROJETOS_COACH),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantNome: tenant.nome,
      tipoMembro: tenant.tipo,
      tenants,
      adminPlataforma: adminRes.data === true,
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

/**
 * Troca o token do link (convite ou acesso) por uma sessão.
 * O link leva token_hash, e não a sessão pronta: assim ele só vale uma
 * vez e expira, e quem abre o e-mail não recebe cookie nenhum sem clicar.
 */
export async function confirmarLink(
  tokenHash: string,
  tipo: "invite" | "email" | "recovery",
): Promise<{ erro: string | null }> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
  if (!error) return { erro: null };
  if (error.code === "otp_expired") {
    return { erro: "Este link expirou ou já foi usado. Peça um novo ao administrador." };
  }
  return { erro: error.message };
}

export async function definirSenha(senha: string): Promise<{ erro: string | null }> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (!error) return { erro: null };
  if (error.code === "same_password") return { erro: null };
  if (error.code === "weak_password") return { erro: "Senha fraca. Use ao menos 8 caracteres." };
  return { erro: error.message };
}
