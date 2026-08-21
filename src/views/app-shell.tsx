import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Ticket,
  BookOpen,
  Boxes,
  GanttChartSquare,
  ShieldCheck,
  Sparkles,
  PieChart,
  Users,
  Settings,
  KeyRound,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/ypperconnect-logo.png";
import { cn } from "@/lib/utils";
import { NewTicketDialog } from "./new-ticket-dialog";
import { ThemeToggle } from "./theme-toggle";
import { minhasPermissoesFn, usuarioAtualFn } from "@/services/cadastros.functions";

const nav = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/chamados", label: "Chamados", icon: Ticket },
  { to: "/projetos", label: "Projetos e cronograma", icon: GanttChartSquare },
  { to: "/recursos", label: "Recursos e capacidade", icon: Users },
  { to: "/diretoria", label: "Visão diretoria", icon: PieChart },
  { to: "/catalogo", label: "Catálogo de serviços", icon: Boxes },
  { to: "/conhecimento", label: "Base de conhecimento", icon: BookOpen },
  { to: "/governanca", label: "Governança ITIL", icon: ShieldCheck },
  { to: "/assistente", label: "Assistente IA", icon: Sparkles },
  { to: "/administracao", label: "Administração", icon: Settings },
  { to: "/permissoes", label: "Perfis de acesso", icon: KeyRound },
] as const;

/**
 * Encerra a sessão no /vuelogin, que é quem a mantém.
 *
 * Quem autentica é o OpenResty; a aplicação não tem sessão própria para
 * limpar. Sair é derrubar o token no sistema de login — depois disso, a
 * próxima visita a /ypper é barrada pelo check-token.lua e redirecionada
 * para a tela de login.
 *
 * A URL é montada a partir da origem porque /vuelogin e /ypper são
 * caminhos do mesmo domínio: assim teste e produção funcionam sem
 * configuração, e não há endereço fixo para alguém esquecer de trocar.
 */
function BotaoSair() {
  return (
    <button
      type="button"
      title="Sair"
      aria-label="Sair"
      onClick={() => {
        window.location.href = `${window.location.origin}/vuelogin/logout`;
      }}
      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <LogOut className="size-4" />
    </button>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const permissoes = useQuery({
    queryKey: ["minhas-permissoes"],
    queryFn: () => minhasPermissoesFn(),
  });

  // Enquanto carrega, mostra o menu inteiro: esconder e depois revelar
  // produz um piscar desagradável a cada navegação.
  const modulos = permissoes.data?.modulos;
  const visibleNav = modulos ? nav.filter((item) => modulos.includes(item.to)) : nav;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-3 px-2">
          <span className="grid size-9 place-items-center rounded-lg bg-hero ring-1 ring-primary/40">
            <img src={logo} alt="Logo YpperConnect" width={1024} height={1024} className="size-6" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-sidebar-foreground">
              YpperConnect
            </span>
            <span className="block text-[11px] text-muted-foreground">Gestão de TI · ITIL</span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {visibleNav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {/* Identidade real, vinda do banco. Substituiu o RoleSwitch,
                que trocava papel por clique e passou a conflitar com o
                perfil do usuário autenticado. */}
            {usuario.data ? (
              <span className="hidden text-right sm:block">
                <span className="block text-xs font-medium leading-tight">{usuario.data.nome}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {usuario.data.admin ? "Administrador" : "Usuário"}
                </span>
              </span>
            ) : null}
            <BotaoSair />
            <ThemeToggle />
            <NewTicketDialog />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 lg:hidden">
          {visibleNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
