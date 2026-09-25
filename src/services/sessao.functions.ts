import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions de sessão: login, logout, troca de empresa e o
 * resumo que a interface usa para montar menu e cabeçalho.
 *
 * O módulo do servidor é importado dentro do handler para o cliente
 * Supabase e os cookies nunca entrarem no bundle do navegador.
 */

async function servidor() {
  return import("@/services/current-user.server");
}

/**
 * Qual permissão libera cada item do menu. Rota sem entrada aqui fica
 * visível para qualquer pessoa logada.
 */
const PERMISSAO_POR_MODULO: Record<string, string[]> = {
  "/diretoria": ["projeto.diretoria"],
  "/backlog": ["projeto.criar", "projeto.ver_portfolio", "projeto.diretoria"],
  "/projetos": ["projeto.criar", "projeto.ver_portfolio", "projeto.diretoria"],
  "/recursos": ["projeto.criar", "projeto.ver_portfolio", "projeto.diretoria"],
  "/governanca": ["chamado.ver_todos"],
  "/administracao": ["usuario.gerenciar", "organizacao.gerenciar", "tenant.configurar"],
  "/permissoes": ["papel.gerenciar"],
};

const MODULOS = [
  "/",
  "/diretoria",
  "/chamados",
  "/backlog",
  "/projetos",
  "/recursos",
  "/catalogo",
  "/conhecimento",
  "/governanca",
  "/assistente",
  "/administracao",
  "/permissoes",
];

/**
 * Resumo da sessão para a interface. Formato único (campos nulos em vez
 * de uma união de tipos) porque é o que chega tipado do outro lado da
 * serialização da server function.
 *
 * estado:
 *   anonimo     não está logado
 *   sem_tenant  logou, mas não tem vínculo com nenhuma empresa
 *   ok          logado e trabalhando numa empresa
 */
export interface SessaoResumo {
  estado: "anonimo" | "sem_tenant" | "ok";
  usuario: { id: string; nome: string; email: string } | null;
  tenant: { id: string; slug: string; nome: string; tipo: "interno" | "cliente" } | null;
  tenants: { id: string; slug: string; nome: string; tipo: "interno" | "cliente" }[];
  permissoes: string[];
  admin: boolean;
  adminPlataforma: boolean;
  modulos: string[];
}

const VAZIA: Omit<SessaoResumo, "estado" | "usuario"> = {
  tenant: null,
  tenants: [],
  permissoes: [],
  admin: false,
  adminPlataforma: false,
  modulos: [],
};

export const sessaoFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessaoResumo> => {
    const { getSessao } = await servidor();
    const sessao = await getSessao();

    if (sessao.estado === "anonimo") return { ...VAZIA, estado: "anonimo", usuario: null };
    if (sessao.estado === "sem_tenant") {
      return {
        ...VAZIA,
        estado: "sem_tenant",
        usuario: { id: "", nome: sessao.nome, email: sessao.email },
      };
    }

    const { ctx } = sessao;
    const modulos = MODULOS.filter((m) => {
      const exigidas = PERMISSAO_POR_MODULO[m];
      return !exigidas || exigidas.some((p) => ctx.permissoes.includes(p));
    });

    return {
      estado: "ok",
      usuario: { id: ctx.id, nome: ctx.nome, email: ctx.email },
      tenant: {
        id: ctx.tenantId,
        slug: ctx.tenantSlug,
        nome: ctx.tenantNome,
        tipo: ctx.tipoMembro,
      },
      tenants: ctx.tenants,
      permissoes: ctx.permissoes,
      admin: ctx.admin,
      adminPlataforma: ctx.adminPlataforma,
      modulos,
    };
  },
);

export const entrarFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
      senha: z.string().min(1, "Informe a senha."),
    }),
  )
  .handler(async ({ data }) => {
    const { entrar } = await servidor();
    return entrar(data.email, data.senha);
  });

export const sairFn = createServerFn({ method: "POST" }).handler(async () => {
  const { sair } = await servidor();
  await sair();
  return { ok: true };
});

export const trocarTenantFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { trocarTenant } = await servidor();
    await trocarTenant(data.slug);
    return { ok: true };
  });
