import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Solicitação e aprovação de acesso a projeto.
 *
 * O repositório entra por import dinâmico dentro do handler, como no
 * resto do sistema: import estático arrastaria o `pg` para o bundle do
 * cliente, e só o `npm run build` acusaria.
 */

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

const SolicitarSchema = z.object({
  projetoId: z.string().min(1),
  justificativa: z.string().max(1000).optional(),
});

const DecidirSchema = z.object({
  id: z.string().min(1),
  aprovar: z.boolean(),
  motivo: z.string().max(1000).optional(),
});

const AcessoSchema = z.object({
  projetoId: z.string().min(1),
  usuarioId: z.string().min(1),
});

export type SolicitarAcessoInput = z.infer<typeof SolicitarSchema>;
export type DecidirAcessoInput = z.infer<typeof DecidirSchema>;
export type AcessoProjetoInput = z.infer<typeof AcessoSchema>;

/**
 * Ids que o usuário pode abrir.
 *
 * O backlog lista a carteira inteira e decide, por linha, entre abrir e
 * pedir acesso. Um conjunto carregado de uma vez responde isso sem uma
 * consulta por cartão.
 */
export const idsComAcessoFn = createServerFn({ method: "GET" }).handler(async () => {
  const { idsComAcesso } = await import("@/repositories/acesso-projeto.repo");
  return idsComAcesso(await ctx());
});

export const listarMinhasSolicitacoesFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const { listarMinhasSolicitacoes } = await import("@/repositories/acesso-projeto.repo");
  return listarMinhasSolicitacoes(await ctx());
});

export const listarSolicitacoesParaAprovarFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ incluirDecididas: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { listarSolicitacoesParaAprovar } = await import("@/repositories/acesso-projeto.repo");
    return listarSolicitacoesParaAprovar(await ctx(), data.incluirDecididas ?? false);
  });

export const contarSolicitacoesPendentesFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const { contarSolicitacoesPendentes } = await import("@/repositories/acesso-projeto.repo");
  return contarSolicitacoesPendentes(await ctx());
});

export const solicitarAcessoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => SolicitarSchema.parse(d))
  .handler(async ({ data }) => {
    const { solicitarAcesso } = await import("@/repositories/acesso-projeto.repo");
    const id = await solicitarAcesso(await ctx(), data.projetoId, data.justificativa ?? null);

    // Fora da transação de propósito: a solicitação vale mesmo com a
    // fila ou o relay fora do ar, e o contrário não é verdade. Falhar
    // aqui não pode desfazer o pedido que já está gravado.
    try {
      const { avisarGerenteDeSolicitacao } = await import("@/services/notificacoes-acesso.server");
      await avisarGerenteDeSolicitacao(id);
    } catch (e) {
      console.error("[acesso-projeto] falha ao enfileirar aviso ao gerente", e);
    }

    return { id };
  });

export const cancelarSolicitacaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { cancelarSolicitacao } = await import("@/repositories/acesso-projeto.repo");
    await cancelarSolicitacao(await ctx(), data.id);
    return { ok: true };
  });

export const decidirSolicitacaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => DecidirSchema.parse(d))
  .handler(async ({ data }) => {
    const { decidirSolicitacao } = await import("@/repositories/acesso-projeto.repo");
    await decidirSolicitacao(await ctx(), data.id, data.aprovar, data.motivo ?? null);

    try {
      const { avisarSolicitanteDaDecisao } = await import("@/services/notificacoes-acesso.server");
      await avisarSolicitanteDaDecisao(data.id);
    } catch (e) {
      console.error("[acesso-projeto] falha ao enfileirar aviso ao solicitante", e);
    }

    return { ok: true };
  });

export const listarAcessosFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ projetoId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { listarAcessos } = await import("@/repositories/acesso-projeto.repo");
    return listarAcessos(await ctx(), data.projetoId);
  });

export const concederAcessoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AcessoSchema.parse(d))
  .handler(async ({ data }) => {
    const { concederAcesso } = await import("@/repositories/acesso-projeto.repo");
    await concederAcesso(await ctx(), data.projetoId, data.usuarioId);
    return { ok: true };
  });

export const revogarAcessoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AcessoSchema.parse(d))
  .handler(async ({ data }) => {
    const { revogarAcesso } = await import("@/repositories/acesso-projeto.repo");
    await revogarAcesso(await ctx(), data.projetoId, data.usuarioId);
    return { ok: true };
  });
