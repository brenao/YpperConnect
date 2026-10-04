import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions dos chamados. Só existem para expor os repositórios
 * ao cliente — sem regra de negócio aqui.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o driver do Postgres nunca entrar no bundle do navegador.
 *
 * Os tipos inferidos do Zod são exportados porque as telas precisam
 * tipar as mutations: Parameters<typeof fn>[0]["data"] não funciona,
 * já que o parâmetro da server function é opcional.
 */

const STATUS = ["novo", "triagem", "em_andamento", "aguardando", "resolvido", "fechado"] as const;
const TIPOS = ["incidente", "requisicao", "melhoria", "problema", "tarefa"] as const;
const IMPACTOS = ["alto", "medio", "baixo"] as const;
const URGENCIAS = ["alta", "media", "baixa"] as const;
const ORIGENS = ["portal", "ia", "email", "telefone"] as const;

const Filtro = z.object({
  status: z.array(z.enum(STATUS)).optional(),
  responsavelId: z.string().optional(),
  solicitanteId: z.string().optional(),
  equipeId: z.string().optional(),
  vencidos: z.boolean().optional(),
  limite: z.number().int().positive().max(500).optional(),
});

export type FiltroChamadosInput = z.infer<typeof Filtro>;

export const listarChamadosFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => Filtro.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { listarChamados } = await import("@/repositories/chamados.repo");
    return listarChamados(data);
  });

export const buscarChamadoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
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
  tipo: z.enum(TIPOS),
  categoriaId: z.string().nullable().optional(),
  servicoId: z.string().nullable().optional(),
  sistemaId: z.string().nullable().optional(),
  impacto: z.enum(IMPACTOS),
  urgencia: z.enum(URGENCIAS),
  equipeId: z.string().nullable().optional(),
  origem: z.enum(ORIGENS).optional(),
});

export type NovoChamadoInput = z.infer<typeof Novo>;

export const criarChamadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Novo.parse(d))
  .handler(async ({ data }) => {
    const { criarChamado } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    const r = await criarChamado(ctx, data);

    // Depois da gravação: um relay indisponível não pode impedir a
    // abertura. Falha aqui só deixa o chamado sem aviso.
    const { avisarChamado } = await import("@/services/chamados-avisos.server");
    await avisarChamado("aberto", r.id, ctx.id);

    return r;
  });

const Alteracao = z.object({
  id: z.string(),
  status: z.enum(STATUS).optional(),
  responsavelId: z.string().nullable().optional(),
  equipeId: z.string().nullable().optional(),
  impacto: z.enum(IMPACTOS).optional(),
  urgencia: z.enum(URGENCIAS).optional(),
  categoriaId: z.string().nullable().optional(),
  servicoId: z.string().nullable().optional(),
  sistemaId: z.string().nullable().optional(),
  problemaVinculadoId: z.string().nullable().optional(),
  descricaoEncerramento: z.string().nullable().optional(),
});

export type AlteracaoChamadoInput = z.infer<typeof Alteracao>;

export const atualizarChamadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Alteracao.parse(d))
  .handler(async ({ data }) => {
    const { atualizarChamado, buscarChamado } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const { avisarChamado } = await import("@/services/chamados-avisos.server");
    const { id, ...mudancas } = data;
    const ctx = await getUsuarioAtual();

    const antes = await buscarChamado(id);
    await atualizarChamado(ctx, id, mudancas);

    // Atribuição avisa o novo responsável; resolução avisa o solicitante
    // e o atendimento. As demais mudanças ficam só no histórico.
    if (mudancas.responsavelId && antes && mudancas.responsavelId !== antes.responsavelId) {
      await avisarChamado("atribuido", id, ctx.id);
    }
    if (mudancas.status === "resolvido" && antes?.status !== "resolvido") {
      await avisarChamado("resolvido", id, ctx.id);
    }

    return { ok: true };
  });

const Interacao = z.object({
  chamadoId: z.string(),
  tipo: z.enum(["comentario", "nota_interna", "email"]),
  corpo: z.string().min(1),
});

export type InteracaoInput = z.infer<typeof Interacao>;

export const adicionarInteracaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Interacao.parse(d))
  .handler(async ({ data }) => {
    const { adicionarInteracao } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    await adicionarInteracao(ctx, data.chamadoId, data.tipo, data.corpo);

    const { avisarChamado } = await import("@/services/chamados-avisos.server");
    await avisarChamado("atividade", data.chamadoId, ctx.id, {
      texto: data.corpo,
      autorNome: ctx.nome,
    });
    return { ok: true };
  });

const Confirmacao = z.object({
  id: z.string(),
  aceita: z.boolean(),
  motivo: z.string().max(1000).optional(),
});

export type ConfirmacaoInput = z.infer<typeof Confirmacao>;

/**
 * O solicitante confirma a solução (fecha o chamado) ou o reabre, com
 * motivo. Reabrir avisa o atendimento; fechar fica só no histórico.
 */
export const confirmarSolucaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Confirmacao.parse(d))
  .handler(async ({ data }) => {
    const { confirmarSolucao } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    await confirmarSolucao(ctx, data.id, data.aceita, data.motivo ?? null);

    if (!data.aceita) {
      const { avisarChamado } = await import("@/services/chamados-avisos.server");
      await avisarChamado("reaberto", data.id, ctx.id, { texto: data.motivo });
    }
    return { ok: true };
  });