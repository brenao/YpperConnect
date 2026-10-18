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
/**
 * Convite do afiliado para o portal. Afiliado não pertence a nenhuma
 * empresa, então não passa pela fila (que é por empresa): envia direto.
 * Quem chama trata a falha — o link continua na tela para o operador.
 */
export async function enviarConviteAfiliado(d: {
  nome: string;
  email: string;
  codigo: string;
  descontoPct: number;
  link: string | null;
}): Promise<void> {
  const { provedorEmail } = await import("@/services/notificacoes.server");
  const { urlDoApp } = await import("@/repositories/usuarios.repo");

  const primeiroNome = d.nome.trim().split(/\s+/)[0] ?? d.nome;
  const acesso = d.link
    ? `Defina sua senha e acesse o portal (o link vale uma vez e expira em 1 hora):\n${d.link}`
    : `Acesse o portal com a sua conta de sempre:\n${urlDoApp()}/afiliado`;
  const beneficio =
    d.descontoPct > 0
      ? ` Quem usar o cupom ganha ${d.descontoPct}% de desconto na assinatura.`
      : "";

  await provedorEmail().enviar({
    id: `afiliado-${d.codigo}`,
    para: d.email.trim().toLowerCase(),
    assunto: "Seu cupom de parceiro BeagleOne",
    texto:
      `Olá, ${primeiroNome}!\n\n` +
      `Você agora é parceiro do BeagleOne. Seu cupom de indicação é ${d.codigo}: ` +
      `peça para o cliente informá-lo na contratação.${beneficio}\n\n` +
      `Link direto, que já preenche o cupom:\n${urlDoApp()}/contratar?cupom=${d.codigo}\n\n` +
      `${acesso}\n\n—\nBeagleOne`,
  });
}