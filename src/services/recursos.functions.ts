import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Server functions de recursos, capacidade e ausências. */

const TIPOS_AUSENCIA = [
  "ferias",
  "licenca_medica",
  "licenca",
  "treinamento",
  "folga",
  "outro",
] as const;

async function ctx() {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return getUsuarioAtual();
}

export const listarRecursosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarRecursos, cargaPorRecurso } = await import("@/repositories/recursos.repo");
  const [recursos, cargas] = await Promise.all([listarRecursos(false), cargaPorRecurso()]);
  return { recursos, cargas };
});

/**
 * Usuários que ainda não são recurso.
 *
 * Alimenta o cadastro em lote, que existe para acabar com a digitação
 * da mesma pessoa em dois lugares: nome, equipe e vínculo vêm do
 * usuário, e só a disponibilidade é decisão de quem cadastra.
 */
export const usuariosSemRecursoFn = createServerFn({ method: "GET" }).handler(async () => {
  const { usuariosSemRecurso } = await import("@/repositories/recursos.repo");
  return { usuarios: await usuariosSemRecurso() };
});

export const criarRecursosDeUsuariosFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        usuarioIds: z.array(z.string()).min(1).max(200),
        disponibilidadeProjetos: z.number().int().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { criarRecursosDeUsuarios, DISPONIBILIDADE_PADRAO } =
      await import("@/repositories/recursos.repo");
    const criados = await criarRecursosDeUsuarios(
      await ctx(),
      data.usuarioIds,
      data.disponibilidadeProjetos ?? DISPONIBILIDADE_PADRAO,
    );
    return { criados };
  });

/**
 * `horasDia` é opcional: a jornada padrão é 8h e saiu do formulário.
 * A coluna continua no banco para a exceção — estagiário de 6h, meio
 * período —, editável por quem precisar, sem ocupar a tela de todo dia.
 *
 * `localidadeId` nulo herda a localidade padrão, que é o caso da
 * empresa com uma cidade só.
 */
const RecursoSchema = z.object({
  nome: z.string().min(3).max(200),
  usuarioId: z.string().nullable().optional(),
  papel: z.string().max(120).nullable().optional(),
  equipeId: z.string().nullable().optional(),
  localidadeId: z.string().nullable().optional(),
  horasDia: z.number().positive().max(24).optional(),
  disponibilidadeProjetos: z.number().int().min(0).max(100),
});

export type RecursoInput = z.infer<typeof RecursoSchema>;

export const criarRecursoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RecursoSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarRecurso } = await import("@/repositories/recursos.repo");
    return { id: await criarRecurso(await ctx(), data) };
  });

const RecursoUpdateSchema = RecursoSchema.extend({ id: z.string() });
export type RecursoUpdateInput = z.infer<typeof RecursoUpdateSchema>;

export const atualizarRecursoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RecursoUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarRecurso } = await import("@/repositories/recursos.repo");
    const { id, ...dados } = data;
    await atualizarRecurso(await ctx(), id, dados);
    return { ok: true };
  });

/**
 * Altera só o percentual.
 *
 * É a edição do dia a dia: o resto do cadastro vem do usuário, e
 * reescrever a linha inteira para mexer num número sobrescreveria o que
 * o cadastro de usuários mantém atualizado.
 */
export const definirDisponibilidadeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string(),
        disponibilidadeProjetos: z.number().int().min(0).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { definirDisponibilidade } = await import("@/repositories/recursos.repo");
    await definirDisponibilidade(await ctx(), data.id, data.disponibilidadeProjetos);
    return { ok: true };
  });

export const definirRecursoAtivoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), ativo: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { definirRecursoAtivo } = await import("@/repositories/recursos.repo");
    await definirRecursoAtivo(await ctx(), data.id, data.ativo);
    return { ok: true };
  });

// --------------------------------------------------------- ausências

/**
 * Ausências de um recurso, ou de todos num período.
 *
 * Os dois filtros são opcionais e independentes: o card da pessoa pede
 * as dela; o mapa de disponibilidade pede as de todo mundo nas próximas
 * semanas.
 */
export const listarAusenciasFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        recursoId: z.string().nullable().optional(),
        de: z.coerce.date().nullable().optional(),
        ate: z.coerce.date().nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { listarAusencias } = await import("@/repositories/recursos.repo");
    return { ausencias: await listarAusencias(data) };
  });

const AusenciaSchema = z.object({
  recursoId: z.string().min(1),
  tipo: z.enum(TIPOS_AUSENCIA),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
  observacao: z.string().max(500).nullable().optional(),
});

export type AusenciaInput = z.infer<typeof AusenciaSchema>;

/**
 * Registrar uma ausência mexe no cronograma de todos os projetos em que
 * a pessoa tem tarefa: o reagendamento pula os dias dela e empurra as
 * sucessoras. É o comportamento certo, e é bom que quem cadastra saiba
 * — por isso a tela avisa depois de salvar.
 */
export const criarAusenciaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AusenciaSchema.parse(d))
  .handler(async ({ data }) => {
    const { criarAusencia } = await import("@/repositories/recursos.repo");
    const id = await criarAusencia(await ctx(), data);
    return { id, efeito: await reagendarProjetosDoRecurso(data.recursoId) };
  });

const AusenciaUpdateSchema = AusenciaSchema.omit({ recursoId: true }).extend({
  id: z.string().min(1),
  /** Vem junto para o reagendamento saber quais projetos revisar. */
  recursoId: z.string().min(1),
});

export type AusenciaUpdateInput = z.infer<typeof AusenciaUpdateSchema>;

export const atualizarAusenciaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => AusenciaUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { atualizarAusencia } = await import("@/repositories/recursos.repo");
    const { id, recursoId, ...dados } = data;
    await atualizarAusencia(await ctx(), id, dados);
    return { ok: true, efeito: await reagendarProjetosDoRecurso(recursoId) };
  });

export const excluirAusenciaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().min(1), recursoId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { excluirAusencia } = await import("@/repositories/recursos.repo");
    await excluirAusencia(await ctx(), data.id);
    // Férias canceladas devolvem os dias: o cronograma pode encurtar.
    return {
      ok: true,
      efeito: await reagendarProjetosDoRecurso(data.recursoId),
    };
  });

/**
 * Reagenda todo projeto vivo em que o recurso tem tarefa.
 *
 * É a consequência de cadastrar ausência, e é a primeira vez que um
 * cadastro fora do projeto mexe no cronograma de vários de uma vez.
 * Fica aqui, e não no repositório de recursos, porque é orquestração
 * entre dois domínios — recurso não deveria conhecer reagendamento.
 *
 * Projeto encerrado ou cancelado fica de fora: mexer na data de algo
 * que já acabou reescreveria história.
 */
export interface EfeitoNoCronograma {
  projetos: number;
  tarefas: number;
}

async function reagendarProjetosDoRecurso(recursoId: string): Promise<EfeitoNoCronograma> {
  const { consultar } = await import("@/integrations/postgres/client.server");
  const { reagendarProjeto } = await import("@/repositories/projetos.repo");

  const linhas = await consultar<{ projetoId: string; tarefas: number }>(
    `SELECT t.projeto_id, COUNT(*)::int AS tarefas
       FROM tarefa_responsaveis tr
       JOIN projeto_tarefas t ON t.id = tr.tarefa_id
       JOIN projetos p ON p.id = t.projeto_id
      WHERE tr.recurso_id = :recursoId
        AND t.ativo = 1
        AND p.status IN ('planejamento', 'execucao', 'paralisado')
      GROUP BY t.projeto_id`,
    { recursoId },
  );

  for (const l of linhas) {
    // Um de cada vez: são poucos por pessoa, e em paralelo duas
    // passadas topológicas do mesmo projeto poderiam se atropelar.
    await reagendarProjeto(l.projetoId);
  }

  // A contagem volta para a tela dizer o que aconteceu. Zero aqui é a
  // informação mais importante: significa que a pessoa não é
  // responsável por tarefa nenhuma em projeto ativo, e que a ausência,
  // por mais bem cadastrada que esteja, não move data alguma. Sem esse
  // aviso, quem cadastra conclui que a funcionalidade está quebrada.
  return {
    projetos: linhas.length,
    tarefas: linhas.reduce((s, l) => s + l.tarefas, 0),
  };
}

// -------------------------------------------------------- localidades

/**
 * Localidades ativas, para os seletores.
 *
 * Fica aqui, e não numa tela própria de calendário, porque quem escolhe
 * localidade no dia a dia é quem cadastra recurso. A administração
 * delas tem funções próprias.
 */
export const listarLocalidadesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listarLocalidades } = await import("@/repositories/calendario.repo");
  return { localidades: await listarLocalidades(true) };
});
