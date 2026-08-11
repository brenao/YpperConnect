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

/** Expediente e feriados vigentes, para a página de governança. */
export const calendarioFn = createServerFn({ method: "GET" }).handler(async () => {
  const { db, linhas } = await import("@/integrations/db/client.server");

  const [expediente, feriados] = await Promise.all([
    linhas<{ dia_semana: number; minuto_ini: number; minuto_fim: number }>(
      await db
        .from("expediente")
        .select("dia_semana, minuto_ini, minuto_fim")
        .eq("ativo", true)
        .order("dia_semana")
        .order("minuto_ini"),
    ),
    linhas<{ data_feriado: string; descricao: string; recorrente: boolean }>(
      await db
        .from("feriados")
        .select("data_feriado, descricao, recorrente")
        .eq("ativo", true)
        .order("data_feriado"),
    ),
  ]);

  // A tela consome o formato antigo (camelCase, recorrente 0/1);
  // a tradução fica aqui para não mexer na camada de apresentação.
  return {
    expediente: expediente.map((e) => ({
      diaSemana: e.dia_semana,
      minutoIni: e.minuto_ini,
      minutoFim: e.minuto_fim,
    })),
    feriados: feriados
      .map((f) => ({
        dataFeriado: `${f.data_feriado.slice(0, 10)}T00:00:00`,
        descricao: f.descricao,
        recorrente: f.recorrente ? 1 : 0,
      }))
      .sort((a, b) => a.dataFeriado.slice(5).localeCompare(b.dataFeriado.slice(5))),
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
    } = await import("@/repositories/indicadores.repo");

    const [chamados, serie, prioridade, tipo, status, equipe, projetos] = await Promise.all([
      metricasChamados(data),
      serieCriadosAtendidos(data),
      chamadosPorPrioridade(data),
      chamadosPorTipo(data),
      chamadosPorStatus(data),
      chamadosPorEquipe(data),
      metricasProjetos(),
    ]);

    return { chamados, serie, prioridade, tipo, status, equipe, projetos };
  });
