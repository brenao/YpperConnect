import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Convite por e-mail de um usuário cadastrado pelo administrador.
 * SOMENTE SERVIDOR.
 *
 * Vai pela mesma fila das outras notificações (tipo boas_vindas) e é
 * enviado na hora. O link continua aparecendo na tela: se o e-mail
 * atrasar ou cair no spam, o administrador ainda pode repassá-lo.
 */
export async function enviarConvite(
  ctx: ContextoUsuario,
  d: { id: string; nome: string; email: string; link: string | null },
): Promise<void> {
  const { enfileirar } = await import("@/repositories/notificacoes.repo");
  const { urlDoApp } = await import("@/repositories/usuarios.repo");

  const primeiroNome = d.nome.trim().split(/\s+/)[0] ?? d.nome;
  const acesso = d.link
    ? `Defina sua senha e entre (o link vale uma vez e expira em 1 hora):\n${d.link}`
    : `Entre com a sua conta de sempre:\n${urlDoApp()}/login`;

  await enfileirar({
    tipo: "boas_vindas",
    destinatarioId: d.id,
    destinatarioEmail: d.email.trim().toLowerCase(),
    assunto: `Convite para ${ctx.tenantNome} no BeagleOne`,
    corpo:
      `Olá, ${primeiroNome}!\n\n` +
      `${ctx.nome} adicionou você à empresa ${ctx.tenantNome} no BeagleOne.\n\n` +
      `${acesso}\n\n—\nBeagleOne`,
  });

  // Falha de envio não desfaz o cadastro: a notificação fica na fila com
  // status de erro e é tentada de novo nas próximas passadas.
  const { processarFila } = await import("@/services/notificacoes.server");
  await processarFila();
}