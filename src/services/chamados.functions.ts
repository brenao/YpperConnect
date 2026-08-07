import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions dos chamados. Só existem para expor os repositórios
 * ao cliente — sem regra de negócio aqui.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o oracledb nunca entrar no bundle do navegador.
 */

const Filtro = z.object({
  status: z
    .array(z.enum(["novo", "triagem", "em_andamento", "aguardando", "resolvido", "fechado"]))
    .optional(),
  responsavelId: z.string().optional(),
  solicitanteId: z.string().optional(),
  equipeId: z.string().optional(),
  vencidos: z.boolean().optional(),
  limite: z.number().int().positive().max(500).optional(),
});

export const listarChamadosFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => Filtro.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { listarChamados } = await import("@/repositories/chamados.repo");
    return listarChamados(data);
  });

export const buscarChamadoFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { buscarChamado, listarInteracoes, listarHistorico } =
      await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");

    const ctx = await getUsuarioAtual();
    const chamado = await buscarChamado(data.id);
    if (!chamado) return null;

    const [interacoes, historico] = await Promise.all([
      listarInteracoes(ctx, data.id),
      listarHistorico(data.id),
    ]);

    return { chamado, interacoes, historico };
  });

const Novo = z.object({
  titulo: z.string().min(3).max(300),
  descricao: z.string().min(5),
  tipo: z.enum(["incidente", "requisicao", "melhoria", "problema", "tarefa"]),
  categoriaId: z.string().nullable().optional(),
  servicoId: z.string().nullable().optional(),
  sistemaId: z.string().nullable().optional(),
  impacto: z.enum(["alto", "medio", "baixo"]),
  urgencia: z.enum(["alta", "media", "baixa"]),
  equipeId: z.string().nullable().optional(),
  origem: z.enum(["portal", "ia", "email", "telefone"]).optional(),
});

export const criarChamadoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Novo.parse(d))
  .handler(async ({ data }) => {
    const { criarChamado } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    return criarChamado(ctx, data);
  });

const Alteracao = z.object({
  id: z.string(),
  status: z
    .enum(["novo", "triagem", "em_andamento", "aguardando", "resolvido", "fechado"])
    .optional(),
  responsavelId: z.string().nullable().optional(),
  equipeId: z.string().nullable().optional(),
  impacto: z.enum(["alto", "medio", "baixo"]).optional(),
  urgencia: z.enum(["alta", "media", "baixa"]).optional(),
  descricaoEncerramento: z.string().nullable().optional(),
});

export const atualizarChamadoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Alteracao.parse(d))
  .handler(async ({ data }) => {
    const { atualizarChamado } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const { id, ...mudancas } = data;
    const ctx = await getUsuarioAtual();
    await atualizarChamado(ctx, id, mudancas);
    return { ok: true };
  });

export const adicionarInteracaoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chamadoId: z.string(),
        tipo: z.enum(["comentario", "nota_interna", "email"]),
        corpo: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { adicionarInteracao } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    await adicionarInteracao(ctx, data.chamadoId, data.tipo, data.corpo);
    return { ok: true };
  });
