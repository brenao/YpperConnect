import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ResultadoCampo } from "@/repositories/projetos.repo";

/**
 * Server functions do portfólio de projetos.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o driver pg nunca entrar no bundle do navegador. O `import type` do
 * topo é apagado na compilação e não arrasta nada junto.
 */

const STATUS = [
  "backlog",
  "planejamento",
  "execucao",
  "paralisado",
  "cancelado",
  "concluido",
] as const;
const QUADROS = ["backlog", "todo", "doing", "done"] as const;
const NIVEIS = ["alta", "media", "baixa"] as const;
const IMPACTOS = ["alto", "medio", "baixo"] as const;
const UNIDADES = ["horas", "dias"] as const;
const STATUS_RISCO = ["aberto", "monitorado", "mitigado"] as const;

/** Quantos acompanhamentos vão no carregamento inicial da tela. */
const ATUALIZACOES_NA_ABERTURA = 12;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

export const listarProjetosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarProjetos } = await import("@/repositories/projetos.repo");
  return listarProjetos(await ctx());
});

/** Detalhe completo: tudo o que a tela do projeto precisa, numa ida só. */
export const detalheProjetoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const r = await import("@/repositories/projetos.repo");
    const usuario = await ctx();

    // `buscarProjeto` recusa projeto fora do alcance do usuário. A rota
    // é uma URL: sem esta checagem, quem tivesse o id de um projeto
    // alheio o abriria à mão.
    const projeto = await r.buscarProjeto(usuario, data.id);
    if (!projeto) return null;

    const [
      tarefas,
      vinculos,
      riscos,
      atualizacoes,
      totalAtualizacoes,
      atencoes,
      baselines,
      planejado,
      planejadoAtual,
      editavel,
    ] = await Promise.all([
      r.listarTarefas(data.id),
      r.listarVinculosTarefas(data.id),
      r.listarRiscos(data.id),
      // Só a janela recente: o acompanhamento é semanal e em um ano são
      // cinquenta registros por projeto. A aba pagina e busca sob
      // demanda em vez de despejar tudo na abertura.
      r.listarAtualizacoes(data.id, { limite: ATUALIZACOES_NA_ABERTURA }),
      r.contarAtualizacoes(data.id),
      r.listarAtencoes(data.id),
      r.listarBaselines(data.id),
      r.baselineOriginal(data.id),
      r.baselineAtual(data.id),
      r.podeEditarProjeto(usuario, data.id),
    ]);

    // Rollup e CPM calculados no servidor: a tela recebe pronto e não
    // precisa reimplementar ponderação nem topologia do grafo.
    const calculadas = r.calcularRollup(tarefas);

    // A folga precisa ser contada na mesma unidade em que o projeto
    // planeja. Em dias corridos, uma folga de "3 dias" poderia ser um
    // fim de semana inteiro e prometer margem que não existe.
    const contarDias = projeto.usaDiasUteis
      ? await (await import("@/integrations/postgres/sla.server")).contadorDeDiasUteis()
      : undefined;

    const cpm = r.calcularCpm(calculadas, vinculos.predecessoras, contarDias);

    return {
      projeto,
      tarefas: calculadas,
      // Map não sobrevive à serialização: vai como objeto simples.
      cpm: Object.fromEntries(cpm),
      vinculos,
      riscos,
      atualizacoes,
      /** Total no banco: a aba mostra "ver todas" quando passa da janela. */
      totalAtualizacoes,
      atencoes,
      baselines,
      /** Primeira baseline: mede o desvio acumulado do plano original. */
      planejado,
      /** Baseline mais recente: diz se o cronograma mudou desde a última foto. */
      planejadoAtual,
      /**
       * Se este usuário pode escrever. Calculado no servidor porque a
       * regra depende de responsáveis por tarefa, que a tela não tem
       * como avaliar — e porque diretoria e portfólio enxergam o
       * projeto sem poder editá-lo.
       */
      editavel,
    };
  });

/**
 * Sem `inicio` e `fim`: o período do projeto é derivado das tarefas,
 * recalculado pelo repositório a cada mudança no cronograma.
 */
const ProjetoSchema = z.object({
  nome: z.string().min(3).max(300),
  objetivo: z.string().max(4000).nullable().optional(),
  sponsorId: z.string().nullable().optional(),
  gerenteId: z.string().nullable().optional(),
  status: z.enum(STATUS).optional(),
  usaDiasUteis: z.boolean().optional(),
  /** Origem e priorização. Mesmos campos no backlog e fora dele. */
  areaDemandante: z.string().max(160).nullable().optional(),
  justificativa: z.string().max(4000).nullable().optional(),
  valor: z.number().int().min(1).max(5).nullable().optional(),
  esforco: z.number().positive().max(9999).nullable().optional(),
  alcance: z.number().int().min(0).max(1_000_000).nullable().optional(),
  confianca: z.number().int().min(0).max(100).nullable().optional(),
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
  /** Recalcula o término a partir do início. */
  duracao: z.number().positive().max(9999).optional(),
  duracaoUnidade: z.enum(UNIDADES).optional(),
  /**
   * Segunda saída do diálogo de conflito: grava a data assim mesmo e
   * corta as dependências que a impediam. Só tem efeito junto com
   * `inicio` — sem data proposta não há conflito a resolver.
   */
  forcarData: z.boolean().optional(),
});

export type CampoTarefaInput = z.infer<typeof CampoSchema>;

/**
 * Edição inline de um campo do cronograma.
 *
 * Devolve o `ResultadoCampo` do repositório, não um `{ ok: true }` fixo.
 * É por este retorno que o conflito de data chega à tela: com `ok:
 * false` e o `conflito` preenchido, nada foi gravado e o diálogo tem o
 * mínimo permitido e os vínculos que o impõem. Com `ok: true`, vêm as
 * datas efetivamente gravadas — que podem diferir do que foi digitado,
 * porque o reagendamento roda depois da escrita — e os avisos de
 * superalocação.
 *
 * O tipo de retorno é anotado à mão porque o `import type` do topo é a
 * única referência ao repositório neste arquivo: sem ele o TanStack
 * inferiria o tipo atravessando o import dinâmico.
 */
export const atualizarCampoTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => CampoSchema.parse(d))
  .handler(async ({ data }): Promise<ResultadoCampo> => {
    const { atualizarCampoTarefa } = await import("@/repositories/projetos.repo");
    const { id, ...campos } = data;
    return atualizarCampoTarefa(await ctx(), id, campos);
  });

const VinculosSchema = z.object({
  id: z.string(),
  responsaveis: z.array(z.string()).max(20).optional(),
  predecessoras: z.array(z.string()).max(20).optional(),
});

export type VinculosTarefaInput = z.infer<typeof VinculosSchema>;

/** Edição em linha de responsável e predecessora, sem tocar no resto. */
export const atualizarVinculosTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => VinculosSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarVinculosTarefa } = await import("@/repositories/projetos.repo");
    const { id, ...vinculos } = data;
    await atualizarVinculosTarefa(await ctx(), id, vinculos);
    return { ok: true };
  });

/** Endentar e desendentar pelo teclado, sem tocar no resto da tarefa. */
export const aninharTarefaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string(), direcao: z.enum(["dentro", "fora"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { aninharTarefa } = await import("@/repositories/projetos.repo");
    await aninharTarefa(await ctx(), data.id, data.direcao);
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

/** Tarefas de uma versão específica, para o histórico de baselines. */
export const tarefasDaBaselineFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ baselineId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { tarefasDaBaseline } = await import("@/repositories/projetos.repo");
    return { tarefas: await tarefasDaBaseline(data.baselineId) };
  });

// ------------------------------------------------- riscos e acompanhamento

const RiscoSchema = z.object({
  projetoId: z.string(),
  descricao: z.string().min(5),
  probabilidade: z.enum(NIVEIS),
  impacto: z.enum(IMPACTOS),
  mitigacao: z.string().nullable().optional(),
  status: z.enum(STATUS_RISCO).optional(),
});

export type RiscoInput = z.infer<typeof RiscoSchema>;

export const criarRiscoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RiscoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarRisco } = await import("@/repositories/projetos.repo");
    return { id: await criarRisco(await ctx(), data) };
  });

/**
 * Sem `projetoId`: um risco não muda de projeto, e aceitar o campo
 * abriria a porta para mover registro de um projeto para outro por
 * payload adulterado.
 */
const RiscoUpdateSchema = RiscoSchema.omit({ projetoId: true }).extend({ id: z.string() });
export type RiscoUpdateInput = z.infer<typeof RiscoUpdateSchema>;

export const atualizarRiscoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RiscoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarRisco } = await import("@/repositories/projetos.repo");
    const { id, ...dados } = data;
    await atualizarRisco(await ctx(), id, dados);
    return { ok: true };
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

const AtualizacaoUpdateSchema = AtualizacaoSchema.omit({ projetoId: true }).extend({
  id: z.string(),
});
export type AtualizacaoUpdateInput = z.infer<typeof AtualizacaoUpdateSchema>;

export const atualizarAtualizacaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtualizacaoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarAtualizacao } = await import("@/repositories/projetos.repo");
    const { id, ...dados } = data;
    await atualizarAtualizacao(await ctx(), id, dados);
    return { ok: true };
  });

/**
 * Busca no histórico de acompanhamento.
 *
 * Separada do detalhe do projeto porque é sob demanda: a tela abre com
 * a janela recente e só chama isto quando a pessoa digita no campo de
 * busca ou pede para ver tudo. Filtrar no cliente exigiria trazer o
 * histórico inteiro na abertura, que é justamente o que se quer evitar.
 */
export const buscarAtualizacoesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        projetoId: z.string(),
        busca: z.string().max(200).nullable().optional(),
        de: z.coerce.date().nullable().optional(),
        ate: z.coerce.date().nullable().optional(),
        limite: z.number().int().min(1).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { listarAtualizacoes, contarAtualizacoes } = await import("@/repositories/projetos.repo");
    const { projetoId, ...filtro } = data;
    const [atualizacoes, total] = await Promise.all([
      listarAtualizacoes(projetoId, filtro),
      contarAtualizacoes(projetoId),
    ]);
    return { atualizacoes, total };
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

const AtencaoUpdateSchema = AtencaoSchema.omit({ projetoId: true }).extend({ id: z.string() });
export type AtencaoUpdateInput = z.infer<typeof AtencaoUpdateSchema>;

export const atualizarAtencaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AtencaoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarAtencao } = await import("@/repositories/projetos.repo");
    const { id, ...dados } = data;
    await atualizarAtencao(await ctx(), id, dados);
    return { ok: true };
  });

export const resolverAtencaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { resolverAtencao } = await import("@/repositories/projetos.repo");
    await resolverAtencao(await ctx(), data.id);
    return { ok: true };
  });

/** Desfaz um "resolvido" clicado por engano, preservando a data de abertura. */
export const reabrirAtencaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { reabrirAtencao } = await import("@/repositories/projetos.repo");
    await reabrirAtencao(await ctx(), data.id);
    return { ok: true };
  });
