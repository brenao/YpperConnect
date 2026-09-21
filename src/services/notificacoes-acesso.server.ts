import { enfileirar } from "@/repositories/notificacoes.repo";
import { dadosParaAviso } from "@/repositories/acesso-projeto.repo";

/**
 * Avisos de acesso a projeto. SOMENTE SERVIDOR.
 *
 * Entra na mesma fila dos lembretes de projeto, e não manda e-mail
 * direto: quem despacha é `processarFila`, chamado pelas rotinas. É o
 * que faz a solicitação valer mesmo com o relay fora do ar — o pedido
 * já está gravado, e o e-mail sai quando a fila rodar.
 *
 * Nenhuma das duas funções lança: o texto do e-mail é consequência da
 * solicitação, não condição dela. Quem chama registra a falha no log e
 * segue.
 */

/**
 * Avisa quem decide que há um pedido esperando.
 *
 * Sem gerente nem patrocinador cadastrados não há a quem avisar, e a
 * função apenas não enfileira nada — o pedido continua visível na aba
 * Acesso do projeto para qualquer administrador.
 */
export async function avisarGerenteDeSolicitacao(solicitacaoId: string): Promise<void> {
  const d = await dadosParaAviso(solicitacaoId);
  if (!d || !d.decisorId || !d.decisorEmail) return;

  // Ninguém pede acesso ao próprio projeto, mas concessão manual e
  // cadastro trocado acontecem: avisar a pessoa do pedido dela mesma
  // seria ruído.
  if (d.decisorId === d.solicitanteId) return;

  const origem = d.solicitanteDepartamento ? ` (${d.solicitanteDepartamento})` : "";

  await enfileirar({
    tipo: "acesso_solicitado",
    destinatarioId: d.decisorId,
    destinatarioEmail: d.decisorEmail,
    assunto: `[Acesso] ${d.solicitanteNome} pediu acesso a ${d.projetoNome}`,
    corpo:
      `${d.solicitanteNome}${origem} solicitou acesso ao projeto "${d.projetoNome}".\n\n` +
      (d.justificativa
        ? `Justificativa informada:\n${d.justificativa}\n\n`
        : "O pedido foi enviado sem justificativa.\n\n") +
      "Para aprovar ou recusar, abra o projeto no BeagleOne e vá até a aba Acesso.\n\n" +
      "Aprovar dá acesso de leitura: a pessoa passa a ver cronograma, riscos e " +
      "acompanhamento, mas não edita nada.",
    referenciaTipo: "solicitacao_acesso",
    referenciaId: d.solicitacaoId,
  });
}

/**
 * Devolve a resposta a quem pediu.
 *
 * A recusa vai com o motivo. Recusa silenciosa é o que faz a pessoa
 * pedir de novo na semana seguinte — e foi por isso que o motivo é
 * obrigatório no repositório.
 */
export async function avisarSolicitanteDaDecisao(solicitacaoId: string): Promise<void> {
  const d = await dadosParaAviso(solicitacaoId);
  if (!d || !d.solicitanteEmail) return;
  if (d.situacao !== "aprovada" && d.situacao !== "recusada") return;

  const porQuem = d.decididoPorNome ? ` por ${d.decididoPorNome}` : "";
  const aprovada = d.situacao === "aprovada";

  await enfileirar({
    tipo: "acesso_decidido",
    destinatarioId: d.solicitanteId,
    destinatarioEmail: d.solicitanteEmail,
    assunto: aprovada ? `[Acesso liberado] ${d.projetoNome}` : `[Acesso recusado] ${d.projetoNome}`,
    corpo: aprovada
      ? `Seu pedido de acesso ao projeto "${d.projetoNome}" foi aprovado${porQuem}.\n\n` +
        "O projeto já aparece para você no BeagleOne, com cronograma, riscos e " +
        "acompanhamento. O acesso é de leitura: alterações continuam com o gerente, " +
        "o patrocinador e os responsáveis pelas tarefas."
      : `Seu pedido de acesso ao projeto "${d.projetoNome}" foi recusado${porQuem}.\n\n` +
        (d.motivoRecusa ? `Motivo informado:\n${d.motivoRecusa}\n\n` : "") +
        "Se o acesso continuar sendo necessário, converse com quem responde pelo " +
        "projeto antes de solicitar de novo.",
    referenciaTipo: "solicitacao_acesso",
    referenciaId: d.solicitacaoId,
  });
}
