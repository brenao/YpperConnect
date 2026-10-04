import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Indicadores agregados do painel inicial e das telas de gestão. */

export const painelFn = createServerFn({ method: "GET" }).handler(async () => {
  const {
    resumoPainel,
    abertosPorPrioridade,
    totalPorTipo,
    volumeUltimos7Dias,
    filaPrioritaria,
    sistemasRecorrentes,
  } = await import("@/repositories/indicadores.repo");

  const [resumo, prioridades, tipos, volume, fila, recorrencias] = await Promise.all([
    resumoPainel(),
    abertosPorPrioridade(),
    totalPorTipo(),
    volumeUltimos7Dias(),
    filaPrioritaria(5),
    sistemasRecorrentes(),
  ]);

  return { resumo, prioridades, tipos, volume, fila, recorrencias };
});

/**
 * Expediente e feriados vigentes da empresa, para a página de governança.
 * Expediente da localidade padrão; feriados ativos da empresa.
 */
export const calendarioFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
  const { tenantId } = await getUsuarioAtual();
  const sb = getSupabaseServerClient();

  const padrao = await sb
    .from("localidades")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("padrao", true)
    .maybeSingle();

  const [exp, fer] = await Promise.all([
    sb
      .from("expediente")
      .select("dia_semana, minuto_ini, minuto_fim")
      .eq("tenant_id", tenantId)
      .eq("localidade_id", padrao.data?.id ?? "")
      .eq("ativo", true)
      .order("dia_semana")
      .order("minuto_ini"),
    sb
      .from("feriados")
      .select("data, descricao, recorrente, mes, dia")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .is("excluido_em", null)
      .order("mes")
      .order("dia"),
  ]);
  if (exp.error) throw new Error(exp.error.message);
  if (fer.error) throw new Error(fer.error.message);

  return {
    expediente: (exp.data ?? []).map((e) => ({
      diaSemana: e.dia_semana as number,
      minutoIni: e.minuto_ini as number,
      minutoFim: e.minuto_fim as number,
    })),
    feriados: (fer.data ?? []).map((f) => ({
      dataFeriado: new Date(`${f.data as string}T00:00:00`),
      descricao: f.descricao as string,
      recorrente: f.recorrente ? 1 : 0,
    })),
  };
});

const Periodo = z.object({
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
});

export type PeriodoInput = z.infer<typeof Periodo>;

export const diretoriaFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => Periodo.parse(d ?? {}))
  .handler(async ({ data }) => {
    const {
      metricasChamados,
      serieCriadosAtendidos,
      chamadosPorPrioridade,
      chamadosPorTipo,
      chamadosPorStatus,
      chamadosPorEquipe,
      metricasProjetos,
      carteiraProjetos,
      projetosPorGerente,
    } = await import("@/repositories/indicadores.repo");

    const [chamados, serie, prioridade, tipo, status, equipe, projetos, carteira, gerentes] =
      await Promise.all([
        metricasChamados(data),
        serieCriadosAtendidos(data),
        chamadosPorPrioridade(data),
        chamadosPorTipo(data),
        chamadosPorStatus(data),
        chamadosPorEquipe(data),
        metricasProjetos(),
        carteiraProjetos(),
        projetosPorGerente(),
      ]);

    // A carteira e a carga por gerente ignoram o filtro de período de
    // propósito: são a foto do portfólio inteiro, não do recorte.
    return { chamados, serie, prioridade, tipo, status, equipe, projetos, carteira, gerentes };
  });

const FiltroPortfolioSchema = z.object({
  gerenteId: z.string().optional(),
  nome: z.string().max(300).optional(),
  status: z.enum(["planejamento", "execucao", "paralisado", "cancelado", "concluido"]).optional(),
});

export type FiltroPortfolioInput = z.infer<typeof FiltroPortfolioSchema>;

/** Lista filtrável do portfólio, consultada à parte dos agregados. */
export const portfolioFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => FiltroPortfolioSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { portfolio } = await import("@/repositories/indicadores.repo");
    return portfolio(data);
  });