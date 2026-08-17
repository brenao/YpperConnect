/**
 * Barras e cabeçalho do Gantt. Só desenha: recebe a janela pronta do
 * `gantt-utils` e as tarefas já com rollup e CPM calculados no servidor.
 * Nada aqui refaz conta de data — a fonte é sempre `inicioEfetivo`/
 * `fimEfetivo`, que já são o consolidado das filhas quando a tarefa é mãe.
 */

import { deslocamentoEmDias, diasEntre, fmt } from "@/lib/datas";
import { faixasDoCabecalho, posicaoEmPx, type JanelaGantt } from "@/services/gantt-utils";
import type { DadosCpm, TarefaCalculada } from "@/repositories/projetos.repo";
import { cn } from "@/lib/utils";

export function CabecalhoGantt({ janela, hoje }: { janela: JanelaGantt; hoje: Date | null }) {
  const { contexto, tiques } = faixasDoCabecalho(janela);
  const posHoje = hoje ? posicaoEmPx(janela, hoje) : null;
  const dentro = posHoje !== null && posHoje >= 0 && posHoje <= janela.largura;

  return (
    <div className="relative select-none" style={{ width: `${janela.largura}px` }}>
      <div className="relative h-5 border-b border-border/60">
        {contexto.map((s) => (
          <span
            key={s.deslocamento}
            className="absolute top-0 truncate px-1.5 text-[11px] font-medium leading-5 text-muted-foreground"
            style={{ left: `${s.deslocamento * janela.px}px`, width: `${s.dias * janela.px}px` }}
          >
            {s.rotulo}
          </span>
        ))}
      </div>

      <div className="relative h-5">
        {tiques.map((s) => (
          <span
            key={s.deslocamento}
            className="absolute top-0 truncate text-center text-[10px] leading-5 text-muted-foreground/80"
            style={{ left: `${s.deslocamento * janela.px}px`, width: `${s.dias * janela.px}px` }}
          >
            {janela.zoom === "dia" && janela.px < 20 ? "" : s.rotulo}
          </span>
        ))}
        {dentro ? (
          <span
            className="absolute -top-5 bottom-0 w-px bg-destructive/70"
            style={{ left: `${posHoje}px` }}
          >
            <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10px] text-destructive">
              hoje
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Marca vertical do dia corrente, repetida em cada linha. */
export function MarcaHoje({ janela, hoje }: { janela: JanelaGantt; hoje: Date | null }) {
  if (!hoje) return null;
  const pos = posicaoEmPx(janela, hoje);
  if (pos < 0 || pos > janela.largura) return null;
  return (
    <span
      className="pointer-events-none absolute inset-y-0 w-px bg-destructive/40"
      style={{ left: `${pos}px` }}
      aria-hidden
    />
  );
}

/** Barra de referência do projeto: a linha 0 da grade. */
export function BarraProjeto({
  janela,
  inicio,
  fim,
  progresso,
}: {
  janela: JanelaGantt;
  inicio: Date | string;
  fim: Date | string;
  progresso: number;
}) {
  const esquerda = posicaoEmPx(janela, inicio);
  const largura = Math.max(janela.px, diasEntre(inicio, fim) * janela.px);

  return (
    <span
      className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-secondary ring-1 ring-inset ring-border"
      style={{ left: `${esquerda}px`, width: `${largura}px` }}
      title={`${fmt(inicio)} — ${fmt(fim)} · ${progresso}% concluído`}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-sm bg-muted-foreground/50"
        style={{ width: `${progresso}%` }}
      />
    </span>
  );
}

/**
 * Barra de uma tarefa. Três camadas, de baixo para cima:
 * baseline (fantasma), barra planejada e preenchimento do progresso.
 */
export function BarraTarefa({
  janela,
  tarefa: t,
  cpm,
  planejado,
  responsaveis,
}: {
  janela: JanelaGantt;
  tarefa: TarefaCalculada;
  cpm: DadosCpm | undefined;
  planejado: { inicio: Date; fim: Date } | undefined;
  responsaveis: string[];
}) {
  const esquerda = posicaoEmPx(janela, t.inicioEfetivo);
  const dias = diasEntre(t.inicioEfetivo, t.fimEfetivo);
  const largura = Math.max(janela.px * 0.75, dias * janela.px);

  const concluida = t.quadro === "done";
  const critica = cpm?.critica ?? false;

  const cor = concluida
    ? { trilha: "bg-success/15 ring-success/35", preenchido: "bg-success" }
    : critica
      ? { trilha: "bg-destructive/12 ring-destructive/40", preenchido: "bg-destructive" }
      : { trilha: "bg-primary/12 ring-primary/35", preenchido: "bg-primary" };

  const atrasoDias =
    planejado && t.fimEfetivo.getTime() > planejado.fim.getTime()
      ? deslocamentoEmDias(planejado.fim, t.fimEfetivo)
      : 0;

  const dica = [
    t.nome,
    `${fmt(t.inicioEfetivo)} — ${fmt(t.fimEfetivo)} · ${dias} d · ${t.progressoEfetivo}%`,
    critica
      ? "Caminho crítico: atraso aqui empurra a entrega"
      : cpm && cpm.folgaDias > 0
        ? `Folga de ${cpm.folgaDias} d`
        : "",
    planejado
      ? `Baseline: ${fmt(planejado.inicio)} — ${fmt(planejado.fim)}` +
        (atrasoDias > 0 ? ` (${atrasoDias} d além do plano)` : "")
      : "Fora da baseline",
    responsaveis.length ? responsaveis.join(", ") : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      {/* Baseline: fio fino abaixo da barra. O trecho vermelho é o que
          escorregou além do plano original — é ele que a diretoria cobra. */}
      {planejado ? (
        <span
          className="pointer-events-none absolute top-[calc(50%+9px)] h-[3px] rounded-full bg-muted-foreground/40"
          style={{
            left: `${posicaoEmPx(janela, planejado.inicio)}px`,
            width: `${Math.max(2, diasEntre(planejado.inicio, planejado.fim) * janela.px)}px`,
          }}
          aria-hidden
        />
      ) : null}
      {atrasoDias > 0 && planejado ? (
        <span
          className="pointer-events-none absolute top-[calc(50%+9px)] h-[3px] rounded-full bg-destructive/70"
          style={{
            left: `${posicaoEmPx(janela, planejado.fim)}px`,
            width: `${Math.max(2, atrasoDias * janela.px)}px`,
          }}
          aria-hidden
        />
      ) : null}

      {t.marco ? (
        <span
          className={cn(
            "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45",
            concluida ? "bg-success" : critica ? "bg-destructive" : "bg-foreground",
          )}
          style={{ left: `${esquerda}px` }}
          title={dica}
        />
      ) : t.ehPai ? (
        /* Tarefa mãe: barra-resumo com as pontas marcadas, como no MS Project. */
        <span
          className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-muted-foreground/70"
          style={{ left: `${esquerda}px`, width: `${largura}px` }}
          title={dica}
        >
          <span className="absolute -bottom-1 left-0 h-2.5 w-[2px] bg-muted-foreground/70" />
          <span className="absolute -bottom-1 right-0 h-2.5 w-[2px] bg-muted-foreground/70" />
        </span>
      ) : (
        <span
          className={cn(
            "absolute top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-[3px] ring-1 ring-inset",
            cor.trilha,
          )}
          style={{ left: `${esquerda}px`, width: `${largura}px` }}
          title={dica}
        >
          <span
            className={cn("absolute inset-y-0 left-0", cor.preenchido)}
            style={{ width: `${t.progressoEfetivo}%` }}
          />
        </span>
      )}
    </>
  );
}
