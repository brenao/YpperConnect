import { responsaveisDoProjeto, ausenciasDoProjeto } from "@/repositories/recursos.repo";
import {
  calendarioDaLocalidade,
  comAusencias,
  aritmeticaDe,
  type AritmeticaDeDias,
} from "./sla.server";

/**
 * Calendário de cada tarefa de um projeto. SOMENTE SERVIDOR.
 *
 * O cronograma deixou de ter um calendário só. Quem executa a tarefa
 * define quais dias contam: os feriados da localidade dela e as
 * ausências dela — férias, licença, treinamento.
 *
 * Vive fora de `projetos.repo` de propósito. Aquele arquivo já tem
 * três mil linhas com CPM, rollup e reagendamento; acrescentar ali a
 * montagem dos calendários misturaria duas coisas que mudam por
 * motivos diferentes, e toda alteração aqui obrigaria a reabrir o
 * arquivo mais delicado do sistema.
 *
 * Tudo é carregado em três consultas para o projeto inteiro. Perguntar
 * por tarefa transformaria a passada topológica do reagendamento numa
 * enxurrada — o mesmo motivo que fez `capacidadesDoProjeto` nascer em
 * lote.
 */

const DIA_MS = 86_400_000;

function meiaNoite(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function chaveData(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

/**
 * Expande um período em datas.
 *
 * Férias de trinta dias viram trinta chaves "YYYY-MM-DD". Parece
 * desperdício, mas é o que permite ao cálculo de dias perguntar "este
 * dia vale?" em tempo constante, dentro de um laço que roda por tarefa
 * e por dia.
 *
 * O teto de dois anos existe para um cadastro errado — fim em 2999 —
 * não travar o reagendamento inteiro.
 */
function expandirPeriodo(inicio: Date, fim: Date): string[] {
  const datas: string[] = [];
  const cursor = meiaNoite(inicio);
  const limite = meiaNoite(fim);
  const teto = 730;

  for (let i = 0; i <= teto && cursor <= limite; i++) {
    datas.push(chaveData(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return datas;
}

/** Aritmética de dias corridos: o projeto que não usa dias úteis. */
function diasCorridos(): AritmeticaDeDias {
  return {
    normalizar: meiaNoite,
    somar: (inicio, dias) => {
      const c = meiaNoite(inicio);
      c.setDate(c.getDate() + dias - 1);
      return c;
    },
    contar: (inicio, fim) =>
      Math.max(
        1,
        Math.round((meiaNoite(fim).getTime() - meiaNoite(inicio).getTime()) / DIA_MS) + 1,
      ),
  };
}

export interface CalendariosDoProjeto {
  /** Calendário de cada tarefa que tem responsável. */
  porTarefa: Map<string, AritmeticaDeDias>;
  /**
   * Usado por tarefa sem responsável, e por qualquer cálculo que não
   * saiba de quem é a tarefa: feriados da localidade padrão, sem
   * ausência nenhuma.
   */
  padrao: AritmeticaDeDias;
}

/**
 * Monta o calendário de cada tarefa do projeto.
 *
 * Com mais de um responsável, a regra é: **a localidade do primeiro na
 * ordem alfabética de id decide o expediente e os feriados, e as
 * ausências de TODOS entram**.
 *
 * A segunda metade é a que importa e é conservadora do jeito certo — se
 * qualquer um dos dois está de férias, a dupla não entrega naquele dia.
 * A primeira metade é uma simplificação assumida: combinar os feriados
 * de duas cidades exigiria interseção de calendários, e o caso de uma
 * tarefa dividida entre pessoas de cidades diferentes é raro o
 * suficiente para não justificar essa complexidade agora. Quando
 * justificar, o lugar de mudar é aqui, e só aqui.
 *
 * Em dias corridos (`usaDiasUteis = false`) nada disso se aplica:
 * projeto de virada de sistema conta sábado e domingo, e contar férias
 * ali seria contradizer a escolha de quem configurou o projeto.
 */
export async function calendariosDasTarefas(
  projetoId: string,
  usaDiasUteis: boolean,
): Promise<CalendariosDoProjeto> {
  if (!usaDiasUteis) {
    const corridos = diasCorridos();
    return { porTarefa: new Map(), padrao: corridos };
  }

  const [responsaveis, ausencias] = await Promise.all([
    responsaveisDoProjeto(projetoId),
    ausenciasDoProjeto(projetoId),
  ]);

  const padrao = aritmeticaDe(await calendarioDaLocalidade(null));

  if (responsaveis.length === 0) return { porTarefa: new Map(), padrao };

  // Um calendário por localidade envolvida, e não por recurso: dez
  // pessoas na mesma cidade compartilham o mesmo conjunto de feriados.
  const localidades = new Set<string | null>(responsaveis.map((r) => r.localidadeId));
  const calendarioPorLocalidade = new Map<
    string | null,
    Awaited<ReturnType<typeof calendarioDaLocalidade>>
  >();
  for (const loc of localidades) {
    calendarioPorLocalidade.set(loc, await calendarioDaLocalidade(loc));
  }

  // Ausências viram datas soltas, indexadas por recurso.
  const datasPorRecurso = new Map<string, string[]>();
  for (const a of ausencias) {
    const lista = datasPorRecurso.get(a.recursoId) ?? [];
    lista.push(...expandirPeriodo(new Date(a.inicio), new Date(a.fim)));
    datasPorRecurso.set(a.recursoId, lista);
  }

  const porRecursoDaTarefa = new Map<
    string,
    { recursoId: string; localidadeId: string | null }[]
  >();
  for (const r of responsaveis) {
    const lista = porRecursoDaTarefa.get(r.tarefaId) ?? [];
    lista.push({ recursoId: r.recursoId, localidadeId: r.localidadeId });
    porRecursoDaTarefa.set(r.tarefaId, lista);
  }

  const porTarefa = new Map<string, AritmeticaDeDias>();

  for (const [tarefaId, lista] of porRecursoDaTarefa) {
    // Ordem estável: sem ela, a mesma tarefa poderia pegar a localidade
    // de um responsável hoje e de outro amanhã, conforme a ordem em que
    // o banco devolvesse as linhas — e o cronograma mudaria sozinho.
    const ordenados = [...lista].sort((a, b) => a.recursoId.localeCompare(b.recursoId));
    const principal = ordenados[0];
    if (!principal) continue;

    const base = calendarioPorLocalidade.get(principal.localidadeId);
    if (!base) continue;

    const datas: string[] = [];
    for (const r of ordenados) datas.push(...(datasPorRecurso.get(r.recursoId) ?? []));

    porTarefa.set(tarefaId, aritmeticaDe(datas.length > 0 ? comAusencias(base, datas) : base));
  }

  return { porTarefa, padrao };
}
