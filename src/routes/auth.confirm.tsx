import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import logo from "@/assets/beagleone-logo.png";
import { confirmarLinkFn } from "@/services/sessao.functions";

type TipoLink = "invite" | "email" | "recovery";

/**
 * Destino dos links de convite e de acesso.
 *
 * Troca o token por sessão no servidor e manda a pessoa definir a senha.
 * Tudo no beforeLoad: quando a página chega ao navegador, o cookie de
 * sessão já está gravado — ou o erro já está na tela.
 */
export const Route = createFileRoute("/auth/confirm")({
  head: () => ({ meta: [{ title: "Acessar · BeagleOne" }] }),
  validateSearch: (s: Record<string, unknown>): { token_hash: string; type: TipoLink } => {
    const tipo = s["type"];
    return {
      token_hash: typeof s["token_hash"] === "string" ? s["token_hash"] : "",
      type: tipo === "invite" || tipo === "recovery" ? tipo : "email",
    };
  },
  beforeLoad: async ({ search }) => {
    if (!search.token_hash) return { erro: "Link incompleto. Peça um novo ao administrador." };
    const r = await confirmarLinkFn({ data: { tokenHash: search.token_hash, tipo: search.type } });
    if (r.erro) return { erro: r.erro };
    throw redirect({ to: "/definir-senha" });
  },
  component: ConfirmarLink,
});

function ConfirmarLink() {
  const { erro } = Route.useRouteContext();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <img
          src={logo}
          alt="BeagleOne"
          width={1240}
          height={1240}
          className="mx-auto mb-8 h-24 w-auto"
        />
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">Não foi possível acessar</h1>
          <p className="mt-2 text-sm text-muted-foreground">{erro}</p>
          <Link to="/login" className="mt-6 inline-block text-sm text-primary hover:underline">
            Ir para o login
          </Link>
        </div>
      </div>
    </div>
  );
}
