import { createFileRoute } from "@tanstack/react-router";
import { Administracao } from "@/views/administracao";

export const Route = createFileRoute("/administracao/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · Administração · BeagleOne" },
      {
        name: "description",
        content: "Localidades e feriados usados nos prazos de chamados e cronogramas.",
      },
    ],
  }),
  component: () => <Administracao secao="calendario" />,
});
