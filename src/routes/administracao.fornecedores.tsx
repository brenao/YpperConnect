import { createFileRoute } from "@tanstack/react-router";
import { rotaAdministracao } from "@/views/administracao-rota";

export const Route = createFileRoute("/administracao/fornecedores")(
  rotaAdministracao("fornecedores"),
);
