/**
 * Seções de Administração: cada uma é um item do menu e uma página.
 *
 * Fonte única do título e da descrição. A página usa no cabeçalho, a
 * rota usa no <title> e na meta description — duas cópias do mesmo
 * texto divergiriam na primeira mudança.
 */
export type SecaoAdministracao =
  "usuarios" | "sistemas" | "calendario" | "fornecedores" | "notificacoes";

export const SECOES_ADMINISTRACAO: Record<
  SecaoAdministracao,
  { titulo: string; subtitulo: string }
> = {
  usuarios: {
    titulo: "Usuários",
    subtitulo: "Quem acessa o sistema, perfil, equipe e administradores",
  },
  sistemas: {
    titulo: "Sistemas",
    subtitulo: "Inventário, responsáveis e atribuição automática de chamados",
  },
  calendario: {
    titulo: "Calendário",
    subtitulo: "Localidades e feriados usados nos prazos e cronogramas",
  },
  fornecedores: {
    titulo: "Fornecedores",
    subtitulo: "Empresas que prestam serviço e fornecem recursos",
  },
  notificacoes: {
    titulo: "Notificações",
    subtitulo: "Fila de e-mails, rotinas agendadas e servidor de envio",
  },
};