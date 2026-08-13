import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions do portfólio de projetos.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o driver pg nunca entrar no bundle do navegador.
 */

const STATUS = ["planejamento", "execucao", "paralisado", "cancelado", "concluido"] as const;
const QUADROS = ["backlog", "todo", "doing", "done"] as const;
const NIVEIS = ["alta", "media", "baixa"] as const;
const IMPACTOS = ["alto", "medio", "baixo"] as const;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

export const listarProjetosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarProjetos } = await import("@/repositories/projetos.repo");
  return listarProjetos();
});

/** Detalhe completo: tudo o que a tela do projeto precisa, numa ida só. */
export const detalheProjetoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const r = await import("@/repositories/projetos.repo");
    const projeto = await r.buscarProjeto(data.id);
    if (!projeto) return null;

    const [tarefas, vinculos, riscos, atualizacoes, atencoes, baselines, planejado] =
      await Promise.all([
        r.listarTarefas(data.id),
        r.listarVinculosTarefas(data.id),
        r.listarRiscos(data.id),
        r.listarAtualizacoes(data.id),
        r.listarAtencoes(data.id),
        r.listarBaselines(data.id),
        r.baselineOriginal(data.id),
      ]);

    // Rollup e CPM calculados no servidor: a tela recebe pronto e não
    // precisa reimplementar ponderação nem topologia do grafo.
    const calculadas = r.calcularRollup(tarefas);
    const cpm = r.calcularCpm(calculadas, vinculos.predecessoras);

    return {
      projeto,
      tarefas: calculadas,
      // Map não sobrevive à serialização: vai como objeto simples.
      cpm: Object.fromEntries(cpm),
      vinculos,
      riscos,
      atualizacoes,
      atencoes,
      baselines,
      planejado,
    };
  });

const ProjetoSchema = z.object({
  nome: z.string().min(3).max(300),
  objetivo: z.string().max(4000).nullable().optional(),
  sponsorId: z.string().nullable().optional(),
  gerenteId: z.string().nullable().optional(),
  status: z.enum(STATUS).optional(),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
});

export type ProjetoInput = z.infer<typeof ProjetoSchema>;

export const criarProjetoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ProjetoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarProjeto } = await import("@/repositories/projetos.repo");
    return { id: await criarProjeto(await ctx(), data) };
  });

const ProjetoUpdateSchema = ProjetoSchema.extend({ id: z.string() });
export type ProjetoUpdateInput = z.infer<typeof ProjetoUpdateSchema>;

export const atualizarProjetoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ProjetoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarProjeto } = await import("@/repositories/projetos.repo");
    const { id, ...dados } = data;
    await atualizarProjeto(await ctx(), id, dados);
    return { ok: true };
  });

const TarefaBase = z.object({
  paiId: z.string().nullable().optional(),
  nome: z.string().min(3).max(300),
  atividade: z.string().max(200).nullable().optional(),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
  progresso: z.number().int().min(0).max(100).optional(),
  quadro: z.enum(QUADROS).optional(),
  marco: z.boolean().optional(),
  alocacaoPct: z.number().int().min(0).max(100).nullable().optional(),
  ordem: z.number().int().optional(),
  responsaveis: z.array(z.string()).max(20).optional(),
  predecessoras: z.array(z.string()).max(20).optional(),
});

const TarefaSchema = TarefaBase.extend({ projetoId: z.string() });
export type TarefaInput = z.infer<typeof TarefaSchema>;

export const criarTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => TarefaSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarTarefa } = await import("@/repositories/projetos.repo");
    return { id: await criarTarefa(await ctx(), data) };
  });

const TarefaUpdateSchema = TarefaBase.extend({ id: z.string() });
export type TarefaUpdateInput = z.infer<typeof TarefaUpdateSchema>;

export const atualizarTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => TarefaUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarTarefa } = await import("@/repositories/projetos.repo");
    const { id, ...dados } = data;
    await atualizarTarefa(await ctx(), id, dados);
    return { ok: true };
  });

export const moverTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), quadro: z.enum(QUADROS) }).parse(d))
  .handler(async ({ data }) => {
    const { moverTarefa } = await import("@/repositories/projetos.repo");
    await moverTarefa(await ctx(), data.id, data.quadro);
    return { ok: true };
  });

export const excluirTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { excluirTarefa } = await import("@/repositories/projetos.repo");
    await excluirTarefa(await ctx(), data.id);
    return { ok: true };
  });

// ------------------------------------------------------- edição inline

const CampoSchema = z.object({
  id: z.string(),
  nome: z.string().min(1).max(300).optional(),
  progresso: z.number().int().min(0).max(100).optional(),
  inicio: z.coerce.date().optional(),
  fim: z.coerce.date().optional(),
});

export type CampoTarefaInput = z.infer<typeof CampoSchema>;

export const atualizarCampoTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => CampoSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarCampoTarefa } = await import("@/repositories/projetos.repo");
    const { id, ...campos } = data;
    await atualizarCampoTarefa(await ctx(), id, campos);
    return { ok: true };
  });

export const inserirAbaixoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ referenciaId: z.string(), comoFilha: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { inserirAbaixo } = await import("@/repositories/projetos.repo");
    return { id: await inserirAbaixo(await ctx(), data.referenciaId, data.comoFilha) };
  });

// ---------------------------------------------------------------- baseline

export const salvarBaselineFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ projetoId: z.string(), descricao: z.string().nullable().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { salvarBaseline } = await import("@/repositories/projetos.repo");
    return { id: await salvarBaseline(await ctx(), data.projetoId, data.descricao) };
  });

// ------------------------------------------------- riscos e acompanhamento

const RiscoSchema = z.object({
  projetoId: z.string(),
  descricao: z.string().min(5),
  probabilidade: z.enum(NIVEIS),
  impacto: z.enum(IMPACTOS),
  mitigacao: z.string().nullable().optional(),
  status: z.enum(["aberto", "monitorado", "mitigado"]).optional(),
});

export type RiscoInput = z.infer<typeof RiscoSchema>;

export const criarRiscoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RiscoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarRisco } = await import("@/repositories/projetos.repo");
    return { id: await criarRisco(await ctx(), data) };
  });

const AtualizacaoSchema = z.object({
  projetoId: z.string(),
  dataRef: z.coerce.date(),
  descricao: z.string().nullable().optional(),
  ultimasEntregas: z.string().nullable().optional(),
  proximasEntregas: z.string().nullable().optional(),
});

export type AtualizacaoInput = z.infer<typeof AtualizacaoSchema>;

export const criarAtualizacaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtualizacaoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarAtualizacao } = await import("@/repositories/projetos.repo");
    return { id: await criarAtualizacao(await ctx(), data) };
  });

const AtencaoSchema = z.object({
  projetoId: z.string(),
  titulo: z.string().min(5).max(300),
  descricao: z.string().nullable().optional(),
  decisaoNecessaria: z.string().nullable().optional(),
  responsavelDecisaoId: z.string().nullable().optional(),
});

export type AtencaoInput = z.infer<typeof AtencaoSchema>;

export const criarAtencaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtencaoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarAtencao } = await import("@/repositories/projetos.repo");
    return { id: await criarAtencao(await ctx(), data) };
  });

export const resolverAtencaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { resolverAtencao } = await import("@/repositories/projetos.repo");
    await resolverAtencao(await ctx(), data.id);
    return { ok: true };
  });
