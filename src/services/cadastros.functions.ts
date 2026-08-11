import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions dos cadastros: leitura e escrita de catálogo,
 * sistemas, categorias, equipes, usuários e perfis.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o driver do banco nunca entrar no bundle do navegador.
 */

const ESCOPOS = ["chamado", "servico", "artigo", "sistema"] as const;
const TIPOS = ["incidente", "requisicao", "melhoria", "problema", "tarefa"] as const;
const CRITICIDADES = ["alta", "media", "baixa"] as const;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

// ------------------------------------------------------------------ leitura

export const usuarioAtualFn = createServerFn({ method: "GET" }).handler(async () => ctx());

export const listarEquipesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarEquipes } = await import("@/repositories/equipes.repo");
  return listarEquipes(false);
});

export const listarUsuariosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarUsuarios } = await import("@/repositories/usuarios.repo");
  return listarUsuarios(false);
});

/** Somente quem pode receber atribuição de chamado: usuários com equipe. */
export const listarAtendentesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarAtendentes } = await import("@/repositories/usuarios.repo");
  return listarAtendentes();
});

export const listarPerfisFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarPerfis } = await import("@/repositories/perfis.repo");
  return listarPerfis();
});

export const listarServicosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarServicos } = await import("@/repositories/catalogo.repo");
  return listarServicos();
});

/** Inclui inativos: a tela de catálogo precisa mostrar e reativar. */
export const listarServicosAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarServicos } = await import("@/repositories/catalogo.repo");
  return listarServicos(false);
});

export const listarSistemasFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarSistemas } = await import("@/repositories/catalogo.repo");
  return listarSistemas();
});

export const listarSistemasAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarSistemas } = await import("@/repositories/catalogo.repo");
  return listarSistemas(false);
});

export const listarCategoriasFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ escopo: z.enum(ESCOPOS).optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { listarCategorias } = await import("@/repositories/catalogo.repo");
    return listarCategorias(data.escopo);
  });

// ------------------------------------------------------------------ serviços

const ServicoSchema = z.object({
  nome: z.string().min(3).max(200),
  categoriaId: z.string().nullable().optional(),
  descricao: z.string().max(1000).nullable().optional(),
  tipoPadrao: z.enum(TIPOS),
  slaHoras: z.number().int().positive().max(9999),
  equipeId: z.string().nullable().optional(),
});

export type ServicoInput = z.infer<typeof ServicoSchema>;

export const criarServicoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ServicoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarServico } = await import("@/repositories/catalogo.repo");
    return { id: await criarServico(await ctx(), data) };
  });

const ServicoUpdateSchema = ServicoSchema.extend({ id: z.string() });
export type ServicoUpdateInput = z.infer<typeof ServicoUpdateSchema>;

export const atualizarServicoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ServicoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarServico } = await import("@/repositories/catalogo.repo");
    const { id, ...dados } = data;
    await atualizarServico(await ctx(), id, dados);
    return { ok: true };
  });

const AtivoSchema = z.object({ id: z.string(), ativo: z.boolean() });
export type AtivoInput = z.infer<typeof AtivoSchema>;

export const definirServicoAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtivoSchema.parse(d))
  .handler(async ({ data }) => {
    const { definirServicoAtivo } = await import("@/repositories/catalogo.repo");
    await definirServicoAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });

// ------------------------------------------------------------------ sistemas

const SistemaSchema = z.object({
  nome: z.string().min(2).max(200),
  descricao: z.string().max(1000).nullable().optional(),
  categoriaId: z.string().nullable().optional(),
  criticidade: z.enum(CRITICIDADES),
  equipeId: z.string().nullable().optional(),
  responsavelId: z.string().nullable().optional(),
  atribuicaoId: z.string().nullable().optional(),
});

export type SistemaInput = z.infer<typeof SistemaSchema>;

export const criarSistemaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => SistemaSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarSistema } = await import("@/repositories/catalogo.repo");
    return { id: await criarSistema(await ctx(), data) };
  });

const SistemaUpdateSchema = SistemaSchema.extend({ id: z.string() });
export type SistemaUpdateInput = z.infer<typeof SistemaUpdateSchema>;

export const atualizarSistemaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => SistemaUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarSistema } = await import("@/repositories/catalogo.repo");
    const { id, ...dados } = data;
    await atualizarSistema(await ctx(), id, dados);
    return { ok: true };
  });

export const definirSistemaAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtivoSchema.parse(d))
  .handler(async ({ data }) => {
    const { definirSistemaAtivo } = await import("@/repositories/catalogo.repo");
    await definirSistemaAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });

// ---------------------------------------------------------------- categorias

const CategoriaSchema = z.object({
  nome: z.string().min(2).max(120),
  escopo: z.enum(ESCOPOS),
});

export type CategoriaInput = z.infer<typeof CategoriaSchema>;

export const criarCategoriaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => CategoriaSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarCategoria } = await import("@/repositories/catalogo.repo");
    return { id: await criarCategoria(await ctx(), data) };
  });

// ------------------------------------------------------------------ equipes

const EquipeSchema = z.object({ nome: z.string().min(2).max(120) });
export type EquipeInput = z.infer<typeof EquipeSchema>;

export const criarEquipeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => EquipeSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarEquipe } = await import("@/repositories/equipes.repo");
    const id = crypto.randomUUID();
    await criarEquipe(await ctx(), { id, nome: data.nome });
    return { id };
  });

// ----------------------------------------------------------------- usuários

const UsuarioSchema = z.object({
  nome: z.string().min(3).max(200),
  email: z.string().email().max(320),
  login: z.string().min(3).max(120),
  departamento: z.string().max(160).nullable().optional(),
  equipeId: z.string().nullable().optional(),
  perfilId: z.string().nullable().optional(),
  admin: z.boolean().optional(),
});

export type UsuarioInput = z.infer<typeof UsuarioSchema>;

export const criarUsuarioFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => UsuarioSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarUsuario } = await import("@/repositories/usuarios.repo");
    const id = crypto.randomUUID();
    await criarUsuario(await ctx(), { id, ...data });
    return { id };
  });

const UsuarioUpdateSchema = UsuarioSchema.partial().extend({ id: z.string() });
export type UsuarioUpdateInput = z.infer<typeof UsuarioUpdateSchema>;

export const atualizarUsuarioFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => UsuarioUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarUsuario } = await import("@/repositories/usuarios.repo");
    const { id, ...dados } = data;
    await atualizarUsuario(await ctx(), id, dados);
    return { ok: true };
  });

export const definirUsuarioAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtivoSchema.parse(d))
  .handler(async ({ data }) => {
    const { definirUsuarioAtivo } = await import("@/repositories/usuarios.repo");
    await definirUsuarioAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });

// ------------------------------------------------------------------- perfis

const PermissoesSchema = z.object({
  perfilId: z.string(),
  modulos: z.array(z.string()).max(50),
  funcionalidades: z.array(z.string()).max(50),
});

export type PermissoesInput = z.infer<typeof PermissoesSchema>;

export const salvarPermissoesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => PermissoesSchema.parse(d))
  .handler(async ({ data }) => {
    const { salvarPermissoes } = await import("@/repositories/perfis.repo");
    await salvarPermissoes(await ctx(), data.perfilId, data.modulos, data.funcionalidades);
    return { ok: true };
  });

// --------------------------------------------------------- perfis (escrita)

const PerfilSchema = z.object({
  nome: z.string().min(3).max(120),
  descricao: z.string().max(500).nullable().optional(),
});

export type PerfilInput = z.infer<typeof PerfilSchema>;

export const criarPerfilFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => PerfilSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarPerfil } = await import("@/repositories/perfis.repo");
    return { id: await criarPerfil(await ctx(), data) };
  });

const PerfilUpdateSchema = z.object({
  id: z.string(),
  nome: z.string().min(3).max(120).optional(),
  descricao: z.string().max(500).nullable().optional(),
  ativo: z.boolean().optional(),
});

export type PerfilUpdateInput = z.infer<typeof PerfilUpdateSchema>;

export const atualizarPerfilFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => PerfilUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarPerfil } = await import("@/repositories/perfis.repo");
    const { id, ...dados } = data;
    await atualizarPerfil(await ctx(), id, dados);
    return { ok: true };
  });

export const desativarPerfilFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { desativarPerfil } = await import("@/repositories/perfis.repo");
    await desativarPerfil(await ctx(), data.id);
    return { ok: true };
  });

// ------------------------------------------------------------ notificações

export const listarNotificacoesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarNotificacoes, contarPorStatus } = await import("@/repositories/notificacoes.repo");
  const [lista, contagem] = await Promise.all([listarNotificacoes(100), contarPorStatus()]);
  return { lista, contagem };
});

// ------------------------------------------------------- fila de e-mail

export const processarFilaEmailFn = createServerFn({ method: "POST" }).handler(async () => {
  const c = await ctx();
  if (!c.admin) throw new Error("Somente administradores podem processar a fila");
  const { processarFila } = await import("@/services/notificacoes.server");
  return processarFila();
});

export const testarSmtpFn = createServerFn({ method: "POST" }).handler(async () => {
  const c = await ctx();
  if (!c.admin) throw new Error("Somente administradores podem testar o SMTP");
  const { testarConexao } = await import("@/services/notificacoes.server");
  await testarConexao();
  return { ok: true };
});

// ------------------------------------------------- permissões do usuário

/**
 * Módulos e funcionalidades do perfil do usuário atual.
 *
 * Substitui o `canAccess` do store antigo, que lia papel do
 * localStorage. Admin recebe tudo: sem isso, um erro de configuração de
 * perfil trancaria o administrador para fora da tela de permissões — e
 * não haveria como consertar pela interface.
 */
export const minhasPermissoesFn = createServerFn({ method: "GET" }).handler(async () => {
  const c = await ctx();
  const { listarPerfis } = await import("@/repositories/perfis.repo");
  const perfis = await listarPerfis();

  if (c.admin) {
    const todos = perfis.flatMap((p) => p.modulos);
    return { modulos: [...new Set(["/", ...todos])], funcionalidades: [], admin: true };
  }

  const meu = perfis.find((p) => p.id === c.perfilId && p.ativo);
  return {
    modulos: [...new Set(["/", ...(meu?.modulos ?? [])])],
    funcionalidades: meu?.funcionalidades ?? [],
    admin: false,
  };
});
