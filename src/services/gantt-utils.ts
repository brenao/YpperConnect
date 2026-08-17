/**
 * Geometria da linha do tempo do cronograma: janela visível, escala e
 * faixas do cabeçalho. Sem React e sem acesso a dados — só conta.
 *
 * O eixo é ancorado numa segunda-feira porque a faixa de fim de semana é
 * desenhada com `repeating-linear-gradient` de período fixo, e não com uma
 * div por dia: num projeto de um ano seriam 365 nós por linha da grade.
 */

import {
  deslocamentoEmDias,
  diasEntre,
  inicioDoDia,
  segundaDaSemana,
  somarDias,
} from "@/lib/datas";

export type ZoomGantt = "dia" | "semana" | "mes";

/** Largura de um dia em pixels, por nível de zoom. */
const PX_POR_DIA: Record<ZoomGantt, number> = { dia: 26, semana: 9, mes: 3 };

export const ZOOM_LABEL: Record<ZoomGantt, string> = {
  dia: "Dias",
  semana: "Semanas",
  mes: "Meses",
};

/**
 * Nomes fixos de propósito: `toLocaleDateString` pode divergir entre o ICU
 * do Node e o do navegador, e o cabeçalho é renderizado no servidor —
 * qualquer diferença quebraria a hidratação.
 */
const MES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export interface JanelaGantt {
  /** Segunda-feira anterior à primeira data em jogo. */
  inicio: Date;
  totalDias: number;
  px: number;
  largura: number;
  zoom: ZoomGantt;
}

export interface SegmentoGantt {
  deslocamento: number;
  dias: number;
  rotulo: string;
}

/** Estilo do fundo da faixa. Estruturalmente compatível com CSSProperties. */
export interface EstiloFundo {
  width: string;
  backgroundImage?: string;
}

/**
 * Monta a janela visível a partir de todas as datas em jogo — projeto,
 * tarefas e baseline. A baseline entra porque um replanejamento pode ter
 * empurrado o cronograma para frente, e o plano original precisa continuar
 * visível para o desvio fazer sentido.
 */
export function montarJanela(
  zoom: ZoomGantt,
  datas: (Date | string | null | undefined)[],
): JanelaGantt {
  const tempos = datas.filter((d): d is Date | string => !!d).map((d) => inicioDoDia(d).getTime());

  const hoje = inicioDoDia(new Date()).getTime();
  const menor = tempos.length ? Math.min(...tempos) : hoje;
  const maior = tempos.length ? Math.max(...tempos) : hoje;

  // Uma semana de folga de cada lado: barra colada na borda não se lê.
  const inicio = segundaDaSemana(somarDias(new Date(menor), -7));
  const fim = somarDias(new Date(maior), 7);
  const px = PX_POR_DIA[zoom];

  // Fecha em semanas inteiras para o gradiente de fim de semana não cortar.
  const totalDias = Math.ceil(diasEntre(inicio, fim) / 7) * 7;

  return { inicio, totalDias, px, largura: totalDias * px, zoom };
}

/** Zoom inicial pelo tamanho do projeto. */
export function zoomSugerido(dias: number): ZoomGantt {
  if (dias <= 45) return "dia";
  if (dias <= 240) return "semana";
  return "mes";
}

/** Posição em pixels de uma data dentro da janela. */
export function posicaoEmPx(j: JanelaGantt, d: Date | string): number {
  return deslocamentoEmDias(j.inicio, d) * j.px;
}

/**
 * Fim de semana sombreado e divisória por semana, como imagem de fundo da
 * célula: custa zero nó de DOM por linha. No zoom de meses a semana daria
 * 21px e viraria ruído, então some.
 */
export function estiloFundo(j: JanelaGantt): EstiloFundo {
  if (j.zoom === "mes") return { width: `${j.largura}px` };

  const semana = 7 * j.px;
  const inicioFds = 5 * j.px;

  return {
    width: `${j.largura}px`,
    backgroundImage: [
      `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${semana}px)`,
      `repeating-linear-gradient(to right, transparent 0 ${inicioFds}px,` +
        ` color-mix(in oklch, var(--muted) 60%, transparent) ${inicioFds}px ${semana}px)`,
    ].join(", "),
  };
}

function segmentosPorMes(j: JanelaGantt, comAno: boolean): SegmentoGantt[] {
  const out: SegmentoGantt[] = [];
  let cursor = new Date(j.inicio.getFullYear(), j.inicio.getMonth(), 1);

  // Limite de voltas: guarda contra data absurda vinda do banco.
  for (let i = 0; i < 600; i += 1) {
    const proximo = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const de = Math.max(0, deslocamentoEmDias(j.inicio, cursor));
    const ate = Math.min(j.totalDias, deslocamentoEmDias(j.inicio, proximo));
    if (de >= j.totalDias) break;
    if (ate > de) {
      const nome = MES_CURTO[cursor.getMonth()] ?? "";
      out.push({
        deslocamento: de,
        dias: ate - de,
        rotulo: comAno ? `${nome}/${String(cursor.getFullYear()).slice(2)}` : nome,
      });
    }
    cursor = proximo;
  }
  return out;
}

function segmentosPorAno(j: JanelaGantt): SegmentoGantt[] {
  const out: SegmentoGantt[] = [];
  let cursor = new Date(j.inicio.getFullYear(), 0, 1);

  for (let i = 0; i < 60; i += 1) {
    const proximo = new Date(cursor.getFullYear() + 1, 0, 1);
    const de = Math.max(0, deslocamentoEmDias(j.inicio, cursor));
    const ate = Math.min(j.totalDias, deslocamentoEmDias(j.inicio, proximo));
    if (de >= j.totalDias) break;
    if (ate > de) {
      out.push({ deslocamento: de, dias: ate - de, rotulo: String(cursor.getFullYear()) });
    }
    cursor = proximo;
  }
  return out;
}

function segmentosPorDia(j: JanelaGantt): SegmentoGantt[] {
  return Array.from({ length: j.totalDias }, (_, i) => ({
    deslocamento: i,
    dias: 1,
    rotulo: String(somarDias(j.inicio, i).getDate()),
  }));
}

function segmentosPorSemana(j: JanelaGantt): SegmentoGantt[] {
  const out: SegmentoGantt[] = [];
  for (let i = 0; i < j.totalDias; i += 7) {
    const d = somarDias(j.inicio, i);
    out.push({
      deslocamento: i,
      dias: 7,
      rotulo: `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`,
    });
  }
  return out;
}

/** Faixa de contexto (em cima) e faixa de tiques (embaixo) do cabeçalho. */
export function faixasDoCabecalho(j: JanelaGantt): {
  contexto: SegmentoGantt[];
  tiques: SegmentoGantt[];
} {
  if (j.zoom === "mes") return { contexto: segmentosPorAno(j), tiques: segmentosPorMes(j, false) };
  if (j.zoom === "semana") {
    return { contexto: segmentosPorMes(j, true), tiques: segmentosPorSemana(j) };
  }
  return { contexto: segmentosPorMes(j, true), tiques: segmentosPorDia(j) };
}
