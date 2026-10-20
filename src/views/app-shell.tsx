import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Ticket,
  BookOpen,
  Boxes,
  GanttChartSquare,
  Grid2x2,
  Inbox,
  PauseCircle,
  ShieldCheck,
  Sparkles,
  PieChart,
  Users,
  Settings,
  KeyRound,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/beagleone-logo.png";
import { cn } from "@/lib/utils";
import { NewTicketDialog } from "./new-ticket-dialog";
import { ThemeToggle } from "./theme-toggle";
import { minhasPermissoesFn, usuarioAtualFn } from "@/services/cadastros.functions";
import { resumoPortfolioFn } from "@/services/projetos.functions";
import type { ResumoPortfolio } from "@/repositories/projetos.repo";

/**
 * Portal externo de chamados. Mesma variável do botão "Abrir chamado".
 *
 * Quando existe, o atendimento mora fora deste sistema: o item Chamados
 * passa a ser uma saída para lá, e a Visão geral — que é um painel de
 * chamados — deixa de fazer sentido no menu.
 */
const PORTAL_CHAMADOS = (import.meta.env["VITE_URL_ABRIR_CHAMADO"] ?? "").trim();

/**
 * De onde sai o número ao lado do rótulo.
 *
 * Só as três listas de projeto têm contador, e cada uma conta um
 * conjunto que não se sobrepõe aos outros: o que aguarda decisão, o que
 * está andando e o que parou. Somados, são a carteira viva.
 *
 * Encerrados não entram em nenhum: eles vivem atrás do "mostrar
 * encerrados" da tela de projetos, e contá-los faria o menu crescer
 * para sempre com decisão que já aconteceu.
 *
 * Nenhum outro item recebe número. Contador em tudo vira ruído de
 * fundo, e aí ninguém lê nenhum.
 */
const CONTADOR: Partial<Record<string, (r: ResumoPortfolio) => number>> = {
  "/backlog": (r) => r.backlog,
  "/projetos": (r) => r.planejamento + r.execucao,
  "/paralisados": (r) => r.paralisado,
};

/**
 * A ordem do menu é a da jornada, não a do histórico do produto.
 *
 * Visão diretoria vem primeiro porque é a tela inicial de quem tem
 * acesso a ela — a raiz redireciona para lá. Um item de menu que é o
 * destino padrão e aparece no meio da lista faz a pessoa procurar onde
 * já está.
 *
 * As três listas de projeto vêm na ordem do ciclo de vida: o que
 * aguarda decisão, o que está andando, o que parou. A matriz fecha o
 * bloco porque é a única que olha as três ao mesmo tempo — ela não é
 * mais uma lista, é a visão de cima delas.
 */
const nav = [
  { to: "/diretoria", label: "Visão diretoria", icon: PieChart },
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/chamados", label: "Chamados", icon: Ticket },
  /**
   * Os rótulos das três listas repetiam "Projetos" e o do meio não
   * cabia na barra — virava "Projetos em andame…", que é pior do que
   * um nome curto. Lado a lado, o contexto já diz que são projetos: o
   * que distingue cada item é o estado, e é ele que fica visível.
   */
  { to: "/backlog", label: "Backlog", icon: Inbox },
  { to: "/projetos", label: "Proj. em Andamento", icon: GanttChartSquare },
  { to: "/paralisados", label: "Paralisados", icon: PauseCircle },
  { to: "/matriz", label: "Matriz de priorização", icon: Grid2x2 },
  { to: "/recursos", label: "Recursos e capacidade", icon: Users },
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

  const usuario = useQuery({
    queryKey: ["usuario-atual"],
    queryFn: () => usuarioAtualFn(),
  });
  const permissoes = useQuery({
    queryKey: ["minhas-permissoes"],
    queryFn: () => minhasPermissoesFn(),
  });

  /**
   * Números do menu: a mesma consulta que alimenta os cards das telas.
   *
   * Reaproveitada de propósito. Uma contagem própria aqui divergiria da
   * que a tela mostra assim que alguém mudasse uma regra — e aí o menu
   * diria 12, a tela diria 14, e nenhum dos dois seria confiável.
   *
   * Ela já respeita a visibilidade de cada pessoa: quem enxerga menos
   * projetos vê números menores, como deve ser.
   */
  const resumo = useQuery({
    queryKey: ["resumo-portfolio"],
    queryFn: () => resumoPortfolioFn(),
  });

  // Enquanto carrega, mostra o menu inteiro: esconder e depois revelar
  // produz um piscar desagradável a cada navegação.
  const modulos = permissoes.data?.modulos;
  const permitidos = modulos ? nav.filter((item) => modulos.includes(item.to)) : nav;

  // Com portal externo, a Visão geral sai: ela é o painel de chamados, e
  // a raiz virou apenas desvio para a tela de projetos.
  const visibleNav =
    PORTAL_CHAMADOS === "" ? permitidos : permitidos.filter((item) => item.to !== "/");

  /**
   * O número ao lado do rótulo, quando há um.
   *
   * Zero não aparece: "Paralisados 0" ocupa espaço para dizer que não
   * há nada — e a ausência diz isso melhor. Enquanto a consulta carrega
   * também não aparece nada, porque um número que muda sozinho um
   * segundo depois chama atenção para a coisa errada.
   */
  function contadorDe(to: string): number | null {
    const fn = CONTADOR[to];
    if (!fn || !resumo.data) return null;
    const n = fn(resumo.data);
    return n > 0 ? n : null;
  }

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
            const contador = contadorDe(item.to);

            const classe = cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            );

            /**
             * O número fica discreto e alinhado à direita.
             *
             * Sem badge colorido de propósito: badge é vocabulário de
             * "tem coisa nova para você", e aqui é só volume. Quem
             * precisa saber quantos projetos há não precisa ser
             * interrompido por isso.
             *
             * Fonte monoespaçada para os números não dançarem na
             * vertical quando um item tem 9 e o de baixo tem 14.
             */
            const conteudo = (
              <>
                <item.icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {contador !== null ? (
                  <span
                    aria-label={`${contador} projeto(s)`}
                    className={cn(
                      "shrink-0 font-mono text-xs tabular-nums",
                      active ? "text-sidebar-primary/70" : "text-muted-foreground/60",
                    )}
                  >
                    {contador}
                  </span>
                ) : null}
              </>
            );

            // Chamados sai do sistema quando há portal: <a> e não <Link>,
            // senão o router tentaria casar a URL com uma rota daqui.
            if (item.to === "/chamados" && PORTAL_CHAMADOS !== "") {
              return (
                <a key={item.to} href={PORTAL_CHAMADOS} className={classe}>
                  {conteudo}
                </a>
              );
            }

            return (
              <Link key={item.to} to={item.to} className={classe}>
                {conteudo}
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
            const contador = contadorDe(item.to);
            const classe =
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground";

            // No celular o número vem entre parênteses: não há espaço
            // para alinhá-lo à direita, e colado ao rótulo ele parece
            // parte do nome.
            const conteudo = (
              <>
                {item.label}
                {contador !== null ? (
                  <span className="font-mono tabular-nums text-muted-foreground/60">
                    ({contador})
                  </span>
                ) : null}
              </>
            );

            if (item.to === "/chamados" && PORTAL_CHAMADOS !== "") {
              return (
                <a key={item.to} href={PORTAL_CHAMADOS} className={classe}>
                  {conteudo}
                </a>
              );
            }

            return (
              <Link key={item.to} to={item.to} className={classe}>
                {conteudo}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
