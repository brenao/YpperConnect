import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /administracao virou um grupo de páginas. O endereço antigo continua
 * valendo (favoritos, links em e-mails) e leva à primeira delas.
 */
export const Route = createFileRoute("/administracao/")({
  beforeLoad: () => {
    throw redirect({ to: "/administracao/usuarios" });
  },
});
