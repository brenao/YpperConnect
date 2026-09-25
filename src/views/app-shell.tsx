import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Ticket,
  BookOpen,
  Boxes,
  GanttChartSquare,
  Inbox,
  ShieldCheck,
  Sparkles,
  PieChart,
  Users,
  Settings,
  KeyRound,
  LogOut,
  Building2,
} from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/beagleone-logo.png";
import { cn } from "@/lib/utils";
import { NewTicketDialog } from "./new-ticket-dialog";
import { ThemeToggle } from "./theme-toggle";
import { minhasPermissoesFn, usuarioAtualFn } from "@/services/cadastros.functions";
import { sairFn, sessaoFn, trocarTenantFn } from "@/services/sessao.functions";

/**
 * Portal externo de chamados. Mesma variável do botão "Abrir chamado".
 *
 * Quando existe, o atendimento mora fora deste sistema: o item Chamados
 * passa a ser uma saída para lá, e a Visão geral — que é um painel de
 * chamados — deixa de fazer sentido no menu.
 */
const PORTAL_CHAMADOS = (import.meta.env["VITE_URL_ABRIR_CHAMADO"] ?? "").trim();

/**
 * A ordem do menu é a da jornada, não a do histórico do produto.
 *
 * Visão diretoria vem primeiro porque é a tela inicial de quem tem
 * acesso a ela — a raiz redireciona para lá. Um item de menu que é o
 * destino padrão e aparece no meio da lista faz a pessoa procurar onde
 * já está.
 */
const nav = [
  { to: "/diretoria", label: "Visão diretoria", icon: PieChart },
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/chamados", label: "Chamados", icon: Ticket },
  { to: "/backlog", label: "Backlog de Projetos", icon: Inbox },
  { to: "/projetos", label: "Projetos e cronograma", icon: GanttChartSquare },
  { to: "/recursos", label: "Recursos e capacidade", icon: Users },
  { to: "/catalogo", label: "Catálogo de serviços", icon: Boxes },
  { to: "/conhecimento", label: "Base de conhecimento", icon: BookOpen },
  { to: "/governanca", label: "Governança ITIL", icon: ShieldCheck },
  { to: "/assistente", label: "Assistente IA", icon: Sparkles },
  { to: "/administracao", label: "Administração", icon: Settings },
  { to: "/permissoes", label: "Perfis de acesso", icon: KeyRound },
] as const;

/**
 * Encerra a sessão e volta para o login.
 *
 * O cache do React Query é descartado junto: sem isso, a próxima pessoa
 * a usar o mesmo navegador veria por um instante os dados da anterior.
 */
function BotaoSair() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <button
      type="button"
      title="Sair"
      aria-label="Sair"
      onClick={async () => {
        await sairFn();
        queryClient.clear();
        await router.invalidate();
        await router.navigate({ to: "/login" });
      }}
      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <LogOut className="size-4" />
    </button>
  );
}

/**
 * Empresa em que a pessoa está trabalhando.
 *
 * Com uma empresa só (instalação de um cliente), é apenas o nome. Com várias, vira
 * seletor; trocar descarta todo o cache, para nenhum dado de uma empresa
 * aparecer na tela da outra.
 */
function SeletorEmpresa() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessao = useQuery({ queryKey: ["sessao"], queryFn: () => sessaoFn() });
  const atual = sessao.data?.tenant;
  const empresas = sessao.data?.tenants ?? [];

  if (!atual) return null;

  if (empresas.length <= 1) {
    return (
      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
        <Building2 className="size-3.5" />
        {atual.nome}
      </span>
    );
  }

  return (
    <label className="hidden items-center gap-1.5 md:inline-flex">
      <Building2 className="size-3.5 text-muted-foreground" />
      <span className="sr-only">Empresa</span>
      <select
        value={atual.slug}
        onChange={async (e) => {
          await trocarTenantFn({ data: { slug: e.target.value } });
          queryClient.clear();
          await router.invalidate();
        }}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {empresas.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.nome}
          </option>
        ))}
      </select>
    </label>
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
  const permitidos = modulos ? nav.filter((item) => modulos.includes(item.to)) : nav;

  // Com portal externo, a Visão geral sai: ela é o painel de chamados, e
  // a raiz virou apenas desvio para a tela de projetos.
  const visibleNav =
    PORTAL_CHAMADOS === "" ? permitidos : permitidos.filter((item) => item.to !== "/");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        {/* Sem divisória sob a marca: ela encontrava a borda da sidebar
            num T e o canto competia com o logotipo. A própria borda do
            <aside> já separa navegação de conteúdo, e o espaço abaixo
            faz o trabalho que a linha fazia — com menos ruído. */}
        <Link to="/" aria-label="BeagleOne" className="mb-8 flex justify-center">
          <img src={logo} alt="BeagleOne" width={1240} height={1240} className="h-24 w-auto" />
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {visibleNav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const classe = cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            );

            // Chamados sai do sistema quando há portal: <a> e não <Link>,
            // senão o router tentaria casar a URL com uma rota daqui.
            if (item.to === "/chamados" && PORTAL_CHAMADOS !== "") {
              return (
                <a key={item.to} href={PORTAL_CHAMADOS} className={classe}>
                  <item.icon className="size-4" />
                  {item.label}
                </a>
              );
            }

            return (
              <Link key={item.to} to={item.to} className={classe}>
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* O cabeçalho não quebra linha: telas com muitas ações — o
            projeto tem meia dúzia — faziam o grupo da direita cair para
            a segunda linha, e ali o justify-between deixava de empurrar
            para a borda. Título espremível e grupo com ml-auto colam a
            identidade na direita em qualquer largura. */}
        <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
            {actions}
            <ThemeToggle />
            <NewTicketDialog />

            {/* Identidade e saída ficam na ponta direita, separadas das
                ações da tela: são do usuário, não do que ele está vendo.
                A divisória marca essa troca de assunto. */}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
            <SeletorEmpresa />
            {usuario.data ? (
              <span className="hidden text-right sm:block">
                <span className="block text-xs font-medium leading-tight">{usuario.data.nome}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {usuario.data.admin ? "Administrador" : "Usuário"}
                </span>
              </span>
            ) : null}
            <BotaoSair />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 lg:hidden">
          {visibleNav.map((item) => {
            const classe = "whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground";

            if (item.to === "/chamados" && PORTAL_CHAMADOS !== "") {
              return (
                <a key={item.to} href={PORTAL_CHAMADOS} className={classe}>
                  {item.label}
                </a>
              );
            }

            return (
              <Link key={item.to} to={item.to} className={classe}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
