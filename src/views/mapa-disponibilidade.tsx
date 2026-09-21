import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Recurso, TipoAusencia } from "@/repositories/recursos.repo";
import { AUSENCIA_LABEL } from "@/services/resource-utils";
import { listarAusenciasFn } from "@/services/recursos.functions";
import { cn } from "@/lib/utils";

/**
 * Mapa de quem está fora nas próximas semanas.
 *
 * Existe para a pergunta que se faz ANTES de alocar alguém numa tarefa:
 * "essa pessoa vai estar aqui?". Sem isso, a resposta só aparece depois,
 * quando o cronograma já empurrou a data e o gerente vai entender o
 * motivo abrindo o cadastro de cada um.
 *
 * Mostra só ausências — férias, licença, treinamento. Feriado de
 * localidade fica de fora de propósito: ele vale para um grupo inteiro
 * e pintaria uma coluna inteira de cinza, escondendo justamente o que é
 * individual e decide a alocação. Quem quer conferir feriado olha o
 * calendário, em Administração.
 */

const DIA_MS = 86_400_000;

/** Quantas semanas o mapa mostra de uma vez. */
const SEMANAS = 8;

/** Dias úteis desenhados por semana: segunda a sexta. */
const DIAS_NA_SEMANA = 5;

const COR_POR_TIPO: Record<TipoAusencia, string> = {
  ferias: "bg-primary/70",
  licenca_medica: "bg-destructive/60",
  licenca: "bg-warning/70",
  treinamento: "bg-info/60",
  folga: "bg-muted-foreground/50",
  outro: "bg-muted-foreground/40",
};

function meiaNoite(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Segunda-feira da semana em que a data cai. */
function segundaDe(d: Date): Date {
  const c = meiaNoite(d);
  const js = c.getDay();
  // JS: 0=domingo. Domingo pertence à semana que termina, não à que
  // começa — daí voltar 6 dias em vez de 1.
  c.setDate(c.getDate() - (js === 0 ? 6 : js - 1));
  return c;
}

function chaveData(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

function rotuloSemana(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function MapaDisponibilidade({ recursos }: { recursos: Recurso[] }) {
  // Deslocamento em semanas a partir da atual. Guardado como número, e
  // não como data, para "Hoje" voltar ao zero sem recalcular nada.
  const [deslocamento, setDeslocamento] = useState(0);

  const inicio = useMemo(() => {
    const s = segundaDe(new Date());
    s.setDate(s.getDate() + deslocamento * 7);
    return s;
  }, [deslocamento]);

  const fim = useMemo(() => {
    const f = new Date(inicio);
    f.setDate(f.getDate() + SEMANAS * 7 - 1);
    return f;
  }, [inicio]);

  const q = useQuery({
    queryKey: ["ausencias-periodo", chaveData(inicio), chaveData(fim)],
    queryFn: () => listarAusenciasFn({ data: { de: inicio, ate: fim } }),
  });

  /**
   * Ausências expandidas em dias, por recurso.
   *
   * O período vira um conjunto de chaves "YYYY-MM-DD" para a célula
   * perguntar "este dia está fora?" em tempo constante — são centenas de
   * células, e varrer a lista de períodos em cada uma seria trabalho
   * repetido à toa.
   */
  const diasFora = useMemo(() => {
    const mapa = new Map<string, Map<string, TipoAusencia>>();
    for (const a of q.data?.ausencias ?? []) {
      const doRecurso = mapa.get(a.recursoId) ?? new Map<string, TipoAusencia>();
      const cursor = meiaNoite(new Date(a.inicio));
      const limite = meiaNoite(new Date(a.fim));
      for (let i = 0; i < 400 && cursor <= limite; i++) {
        doRecurso.set(chaveData(cursor), a.tipo);
        cursor.setDate(cursor.getDate() + 1);
      }
      mapa.set(a.recursoId, doRecurso);
    }
    return mapa;
  }, [q.data]);

  const semanas = useMemo(
    () =>
      Array.from({ length: SEMANAS }, (_, s) => {
        const seg = new Date(inicio);
        seg.setDate(seg.getDate() + s * 7);
        return seg;
      }),
    [inicio],
  );

  const hoje = chaveData(new Date());

  /**
   * Só quem tem ausência no período, mais todo mundo quando não há
   * nenhuma.
   *
   * Com mil pessoas cadastradas, listar a equipe inteira para pintar
   * três linhas afundaria justamente as três que importam. Quem não
   * aparece está disponível — que é o estado normal e não precisa de
   * uma linha para ser dito.
   */
  const ativos = useMemo(() => recursos.filter((r) => r.ativo), [recursos]);
  const visiveis = useMemo(
    () => ativos.filter((r) => (diasFora.get(r.id)?.size ?? 0) > 0),
    [ativos, diasFora],
  );

  const tiposPresentes = useMemo(() => {
    const t = new Set<TipoAusencia>();
    for (const a of q.data?.ausencias ?? []) t.add(a.tipo);
    return [...t];
  }, [q.data]);

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarRange className="size-4 text-muted-foreground" /> Quem estará fora
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Férias, licenças e treinamentos nas próximas {SEMANAS} semanas. O cronograma já desconta
            esses dias — este mapa é para consultar antes de alocar.
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Semanas anteriores"
            onClick={() => setDeslocamento((v) => v - SEMANAS)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          {deslocamento !== 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setDeslocamento(0)}>
              Hoje
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Próximas semanas"
            onClick={() => setDeslocamento((v) => v + SEMANAS)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {q.isPending ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </p>
      ) : visiveis.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Ninguém com ausência registrada de {rotuloSemana(inicio)} a {rotuloSemana(fim)}. A equipe
          inteira está disponível no período.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card px-2 py-1 text-left text-xs font-medium text-muted-foreground">
                  Recurso
                </th>
                {semanas.map((s) => (
                  <th
                    key={chaveData(s)}
                    className="px-1 py-1 text-center text-[11px] font-normal text-muted-foreground"
                  >
                    {rotuloSemana(s)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => {
                const dias = diasFora.get(r.id);
                const total = dias?.size ?? 0;

                return (
                  <tr key={r.id}>
                    <td className="sticky left-0 max-w-48 truncate bg-card px-2 py-1 text-xs">
                      <span className="block truncate">{r.nome}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {total} dia(s) fora
                        {r.localidadeNome ? ` · ${r.localidadeNome}` : ""}
                      </span>
                    </td>

                    {semanas.map((seg) => (
                      <td key={chaveData(seg)} className="px-1 py-1">
                        <span className="flex justify-center gap-0.5">
                          {Array.from({ length: DIAS_NA_SEMANA }, (_, i) => {
                            const dia = new Date(seg);
                            dia.setDate(dia.getDate() + i);
                            const chave = chaveData(dia);
                            const tipo = dias?.get(chave);

                            return (
                              <span
                                key={chave}
                                title={
                                  tipo
                                    ? `${r.nome} · ${AUSENCIA_LABEL[tipo]} · ${dia.toLocaleDateString("pt-BR")}`
                                    : `${r.nome} · disponível · ${dia.toLocaleDateString("pt-BR")}`
                                }
                                className={cn(
                                  "block size-2.5 rounded-[2px]",
                                  tipo ? COR_POR_TIPO[tipo] : "bg-secondary",
                                  // O dia de hoje ganha contorno: sem
                                  // ele, a grade é uma sequência de
                                  // quadrados sem âncora temporal.
                                  chave === hoje ? "ring-1 ring-primary ring-offset-1" : "",
                                )}
                              />
                            );
                          })}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Legenda só dos tipos que aparecem: uma lista fixa com seis
              cores obrigaria a procurar qual delas está na tela. */}
          {tiposPresentes.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {tiposPresentes.map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-[2px]", COR_POR_TIPO[t])} />
                  {AUSENCIA_LABEL[t]}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-secondary" />
                disponível
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
