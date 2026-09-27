import { createFileRoute } from "@tanstack/react-router";
import { Administracao } from "@/views/administracao";

export const Route = createFileRoute("/administracao/notificacoes")({
  head: () => ({
    meta: [
      { title: "Notificações · Administração · BeagleOne" },
      { name: "description", content: "Fila de e-mails, rotinas agendadas e servidor de envio." },
    ],
  }),
  component: () => <Administracao secao="notificacoes" />,
});
