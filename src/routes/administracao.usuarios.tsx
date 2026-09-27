import { createFileRoute } from "@tanstack/react-router";
import { Administracao } from "@/views/administracao";

export const Route = createFileRoute("/administracao/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários · Administração · BeagleOne" },
      { name: "description", content: "Quem acessa o sistema, perfil, equipe e administradores." },
    ],
  }),
  component: () => <Administracao secao="usuarios" />,
});
