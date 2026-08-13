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
  const { consultar } = await import("@/integrations/postgres/client.server");

  const [expediente, feriados] = await Promise.all([
    consultar<{ diaSemana: number; minutoIni: number; minutoFim: number }>(
      `SELECT dia_semana, minuto_ini, minuto_fim
         FROM expediente WHERE ativo = 1
        ORDER BY dia_semana, minuto_ini`,
    ),
    consultar<{ dataFeriado: Date; descricao: string; recorrente: number }>(
      `SELECT data_feriado, descricao, recorrente
         FROM feriados WHERE ativo = 1
        ORDER BY EXTRACT(MONTH FROM data_feriado), EXTRACT(DAY FROM data_feriado)`,
    ),
  ]);

  return { expediente, feriados };
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
