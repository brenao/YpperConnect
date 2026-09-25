import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions da tela de Administração do tenant.
 * O repositório é importado dentro do handler: cliente Supabase e chave
 * service_role nunca entram no bundle do navegador.
 */

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

async function repo() {
  return import("@/repositories/administracao.repo");
}

const ESCOPOS = ["chamado", "servico", "artigo", "sistema"] as const;
const id = z.string().uuid();
const nome = z.string().trim().min(2, "Nome muito curto.").max(120);

// ------------------------------------------------------------------ leitura

export const dadosAdministracaoFn = createServerFn({ method: "GET" }).handler(async () => {
  const c = await ctx();
  const r = await repo();
  const [membros, papeis, equipes, categorias] = await Promise.all([
    r.listarMembros(c),
    r.listarPapeis(c),
    r.listarEquipes(c),
    r.listarCategorias(c),
  ]);
  return { membros, papeis, equipes, categorias, meuId: c.id };
});

// ------------------------------------------------------------------ membros

export const convidarMembroFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().trim().toLowerCase().email("E-mail inválido."),
      nome,
      papelId: id,
      equipeId: id.nullable(),
    }),
  )
  .handler(async ({ data }) => (await repo()).convidarMembro(await ctx(), data));

export const atualizarMembroFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      usuarioId: id,
      papelId: id.optional(),
      equipeId: id.nullable().optional(),
      ativo: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const c = await ctx();
    const r = await repo();
    if (data.papelId) await r.definirPapel(c, data.usuarioId, data.papelId);
    if (data.equipeId !== undefined)
      await r.definirEquipeDoMembro(c, data.usuarioId, data.equipeId);
    if (data.ativo !== undefined) await r.definirMembroAtivo(c, data.usuarioId, data.ativo);
    return { ok: true };
  });

export const gerarLinkAcessoFn = createServerFn({ method: "POST" })
  .validator(z.object({ usuarioId: id }))
  .handler(async ({ data }) => ({
    link: await (await repo()).gerarLinkDeAcesso(await ctx(), data.usuarioId),
  }));

// ------------------------------------------------------------------ equipes

export const criarEquipeFn = createServerFn({ method: "POST" })
  .validator(z.object({ nome }))
  .handler(async ({ data }) => {
    await (await repo()).criarEquipe(await ctx(), data.nome);
    return { ok: true };
  });

export const atualizarEquipeFn = createServerFn({ method: "POST" })
  .validator(z.object({ id, nome: nome.optional(), ativo: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { id: equipeId, ...mudancas } = data;
    await (await repo()).atualizarEquipe(await ctx(), equipeId, limpar(mudancas));
    return { ok: true };
  });

// ------------------------------------------------------------------ categorias

export const criarCategoriaFn = createServerFn({ method: "POST" })
  .validator(z.object({ nome, escopo: z.enum(ESCOPOS) }))
  .handler(async ({ data }) => {
    await (await repo()).criarCategoria(await ctx(), data);
    return { ok: true };
  });

export const atualizarCategoriaFn = createServerFn({ method: "POST" })
  .validator(z.object({ id, nome: nome.optional(), ativo: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { id: categoriaId, ...mudancas } = data;
    await (await repo()).atualizarCategoria(await ctx(), categoriaId, limpar(mudancas));
    return { ok: true };
  });

/** Remove chaves undefined: o Supabase gravaria null nelas. */
function limpar<T extends Record<string, unknown>>(
  o: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
