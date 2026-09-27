import { createFileRoute } from "@tanstack/react-router";
import { Administracao } from "@/views/administracao";

export const Route = createFileRoute("/administracao/sistemas")({
  head: () => ({
    meta: [
      { title: "Sistemas · Administração · BeagleOne" },
      {
        name: "description",
        content: "Inventário de sistemas, responsáveis e atribuição automática de chamados.",
      },
    ],
  }),
  component: () => <Administracao secao="sistemas" />,
});
