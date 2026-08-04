import { Link, useRouterState } from "@tanstack/react-router";
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
} from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/ypperconnect-logo.png";
import { cn } from "@/lib/utils";
import { NewTicketDialog } from "./new-ticket-dialog";
import { ThemeToggle } from "./theme-toggle";
import { RoleSwitch } from "./role-switch";

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
] as const;

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

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-3 px-2">
          <span className="grid size-9 place-items-center rounded-lg bg-hero ring-1 ring-primary/40">
            <img
              src={logo}
              alt="Logo YpperConnect"
              width={1024}
              height={1024}
              className="size-6"
            />
          </span>
          <span>
            <span className="block text-sm font-semibold text-sidebar-foreground">
              YpperConnect
            </span>
            <span className="block text-[11px] text-muted-foreground">Gestão de TI · ITIL</span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
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

        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
          <p className="text-xs text-muted-foreground">
            Registros do tipo <span className="text-warning">Problema</span> são exclusivos da
            equipe de TI.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle ? (
              <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <RoleSwitch />
            <ThemeToggle />
            <NewTicketDialog />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 lg:hidden">
          {nav.map((item) => (
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