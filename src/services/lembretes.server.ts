/**
 * Rotinas periódicas. SOMENTE SERVIDOR.
 *
 * Não há agendador dentro da aplicação: quem chama é o cron do sistema
 * ou o Jenkins, batendo em `/api/rotinas`. Colocar `setInterval` no
 * processo do Nitro faria cada réplica do container disparar o mesmo
 * lembrete, e o gerente receberia o e-mail em duplicata.
 */

import { enfileirar } from "@/repositories/notificacoes.repo";
import {
  paralisarProjetosSemMovimento,
  projetosSemAtualizacao,
} from "@/repositories/projetos.repo";

/**
 * A partir de quantos dias sem atualização o gerente é cobrado.
 *
 * A regra é acompanhamento semanal; o aviso sai um dia antes de vencer,
 * para o gerente ainda ter tempo de registrar dentro da semana.
 */
const DIAS_PARA_AVISAR = 6;

/**
 * A partir de quantos dias parado o projeto é dado como paralisado.
 *
 * Bem mais folgado que o prazo do lembrete, e de propósito: o e-mail
 * cobra um registro esquecido, enquanto mudar o status é afirmar que o
 * projeto de fato parou. Duas semanas e meia sem nenhum movimento — nem
 * de cronograma, nem de progresso, nem de cadastro — é tempo suficiente
 * para essa afirmação não ser precipitada.
 *
 * Sair de paralisado não depende de prazo nenhum: o primeiro percentual
 * lançado devolve o projeto para execução, pelo ajuste automático que
 * roda a cada mudança de cronograma.
 */
const DIAS_PARA_PARALISAR = 15;

export interface ResultadoLembretes {
  avaliados: number;
  enfileirados: number;
  semGerente: number;
  jaAvisadosHoje: number;
  /** Projetos que a rotina marcou como paralisados nesta passada. */
  paralisados: number;
}

/**
 * Gera os lembretes de atualização de projeto.
 *
 * Um por projeto por dia, garantido pela própria fila de notificações:
 * a partir de 6 dias o aviso passa a sair todo dia até alguém registrar
 * a atualização. Rodar a rotina duas vezes no mesmo dia não duplica.
 *
 * A revisão de projetos parados vem antes da varredura, e não depois:
 * assim o lembrete que sai nesta mesma execução já reflete a situação
 * que a rotina acabou de gravar, em vez de descrever um estado que
 * deixou de valer segundos atrás.
 */
export async function gerarLembretesProjeto(): Promise<ResultadoLembretes> {
  const paralisados = await paralisarProjetosSemMovimento(DIAS_PARA_PARALISAR);

  const projetos = await projetosSemAtualizacao(DIAS_PARA_AVISAR);
  const r: ResultadoLembretes = {
    avaliados: projetos.length,
    enfileirados: 0,
    semGerente: 0,
    jaAvisadosHoje: 0,
    paralisados,
  };

  for (const p of projetos) {
    if (p.avisadoHoje) {
      r.jaAvisadosHoje += 1;
      continue;
    }
    // Sem gerente não há a quem cobrar. Fica registrado no retorno para
    // a Administração mostrar que existe projeto órfão.
    if (!p.gerenteId || !p.gerenteEmail) {
      r.semGerente += 1;
      continue;
    }

    const vencido = p.diasSemAtualizar > 7;

    await enfileirar({
      tipo: "projeto_lembrete",
      destinatarioId: p.gerenteId,
      destinatarioEmail: p.gerenteEmail,
      assunto: vencido
        ? `[Projeto atrasado] ${p.nome} — ${p.diasSemAtualizar} dias sem atualização`
        : `[Projeto] ${p.nome} — atualização semanal pendente`,
      corpo:
        `O projeto "${p.nome}" está há ${p.diasSemAtualizar} dias sem atualização de status.\n\n` +
        (vencido
          ? "Passou de uma semana: este lembrete será enviado diariamente até o registro.\n\n"
          : "O acompanhamento é semanal.\n\n") +
        "Registre o andamento, as últimas entregas e as próximas entregas na aba Tarefas do projeto.",
      referenciaTipo: "projeto",
      referenciaId: p.id,
    });
    r.enfileirados += 1;
  }

  return r;
}
