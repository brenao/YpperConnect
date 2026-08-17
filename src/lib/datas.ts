/**
 * Utilitários de data das telas. Sem domínio e sem React.
 *
 * Tudo aqui trabalha no fuso local do navegador. O servidor roda com
 * TZ=America/Sao_Paulo e as colunas são TIMESTAMP puro, então a data que
 * chega já é a data que se quer mostrar — nada de conversão de fuso.
 */

const UM_DIA = 86_400_000;

/** dd/mm/aaaa, ou travessão quando não há data. */
export function fmt(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * aaaa-mm-dd para `<input type="date">`.
 *
 * Montado campo a campo de propósito: `toISOString()` converte para UTC e
 * volta um dia para qualquer hora antes das 03:00 no horário de Brasília.
 */
export function paraInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lê o valor de um `<input type="date">` como data local. */
export function doInput(v: string): Date {
  const [a, m, d] = v.split("-").map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Meia-noite local do dia informado. Base de toda a aritmética de dias. */
export function inicioDoDia(v: Date | string): Date {
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function somarDias(v: Date | string, n: number): Date {
  const d = inicioDoDia(v);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Dias corridos entre duas datas, com início e fim inclusive.
 * Uma tarefa que começa e termina no mesmo dia dura 1 dia, não 0.
 */
export function diasEntre(inicio: Date | string, fim: Date | string): number {
  const a = inicioDoDia(inicio).getTime();
  const b = inicioDoDia(fim).getTime();
  return Math.max(1, Math.round((b - a) / UM_DIA) + 1);
}

/** Distância em dias, podendo ser negativa. Não força o mínimo de 1. */
export function deslocamentoEmDias(origem: Date | string, alvo: Date | string): number {
  const a = inicioDoDia(origem).getTime();
  const b = inicioDoDia(alvo).getTime();
  return Math.round((b - a) / UM_DIA);
}

/** Segunda-feira da semana da data. Ancora a grade do Gantt no fim de semana certo. */
export function segundaDaSemana(v: Date | string): Date {
  const d = inicioDoDia(v);
  // getDay(): 0 = domingo. Domingo recua 6 dias, os demais recuam (dia - 1).
  const recuo = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return somarDias(d, -recuo);
}
