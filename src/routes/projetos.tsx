import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Eye,
  EyeOff,
  Loader2,
  ListChecks,
  Lock,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { KpisPortfolio, type ChaveKpi } from "@/views/kpis-portfolio";
import { ProjectDialog } from "@/views/project-dialogs";
import { DialogoSolicitarAcesso } from "@/views/dialogo-solicitar-acesso";
import { SeletorStatusProjeto } from "@/views/seletor-status-projeto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import type { ProjetoComProgresso } from "@/repositories/projetos.repo";
import {
  listarProjetosFn,
  listarProjetosSemAcessoFn,
  definirStatusProjetoFn,
  excluirProjetoFn,
  impedimentosDeExclusaoFn,
} from "@/services/projetos.functions";
import { usuarioAtualFn } from "@/services/cadastros.functions";
import { listarMinhasSolicitacoesFn } from "@/services/acesso-projeto.functions";
import { cn } from "@/lib/utils";

/**
 * Filtros do portfólio, guardados na URL.
 *
 * Na URL e não em estado de componente: assim o botão voltar do
 * navegador devolve a lista como estava ao sair do detalhe de um
 * projeto, o F5 preserva o recorte e o link pode ser mandado para um
 * colega já filtrado.
 *
 * Guardar em memória resolveria só o caso de voltar; guardar em
 * `sessionStorage` criaria a situação de abrir a tela do zero e
 * encontrar filtros de ontem sem entender de onde vieram.
 */
export interface FiltrosProjetos {
  busca: string;
  /** Nome do gerente. "todos" é o estado neutro. */
  gp: string;
  /** Departamento de quem gerencia — de que área é quem TOCA. */
  departamento: string;
  /** Área que pediu o projeto — de quem PEDIU. */
  area: string;
  status: "todos" | ProjectStatus;
  kpi: ChaveKpi | null;
  encerrados: boolean;
}

const FILTROS_VAZIOS: FiltrosProjetos = {
  busca: "",
  gp: "todos",
  departamento: "todos",
  area: "todos",
  status: "todos",
  kpi: null,
  encerrados: false,
};

/**
 * Lê a URL sem confiar nela.
 *
 * Qualquer pessoa pode editar a barra de endereços, e um valor estranho
 * não pode derrubar a tela: o que não for reconhecido cai no padrão.
 */
function lerFiltros(bruto: Record<string, unknown>): FiltrosProjetos {
  const texto = (v: unknown, padrao: string) =>
    typeof v === "string" && v.trim() !== "" ? v : padrao;

  const status = texto(bruto["status"], "todos");
  const statusValido =
    status === "todos" || Object.keys(PROJECT_STATUS_LABEL).includes(status)
      ? (status as FiltrosProjetos["status"])
      : "todos";

  return {
    busca: texto(bruto["busca"], "").slice(0, 120),
    gp: texto(bruto["gp"], "todos"),
    departamento: texto(bruto["departamento"], "todos"),
    area: texto(bruto["area"], "todos"),
    status: statusValido,
    kpi: typeof bruto["kpi"] === "string" ? (bruto["kpi"] as ChaveKpi) : null,
    encerrados: bruto["encerrados"] === true || bruto["encerrados"] === "true",
  };
}

/**
 * O que vai para a URL: só o que difere do padrão.
 *
 * Sem isso, a barra de endereços carregaria `?busca=&gp=todos&...` desde
 * a primeira visita — ilegível, e impossível de copiar para alguém sem
 * parecer que há filtro ativo.
 */
function escreverFiltros(f: FiltrosProjetos): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (f.busca.trim() !== "") s["busca"] = f.busca;
  if (f.gp !== "todos") s["gp"] = f.gp;
  if (f.departamento !== "todos") s["departamento"] = f.departamento;
  if (f.area !== "todos") s["area"] = f.area;
  if (f.status !== "todos") s["status"] = f.status;
  if (f.kpi !== null) s["kpi"] = f.kpi;
  if (f.encerrados) s["encerrados"] = true;
  return s;
}

export const Route = createFileRoute("/projetos")({
  validateSearch: (busca: Record<string, unknown>) => escreverFiltros(lerFiltros(busca)),
  head: () => ({
    meta: [
      { title: "Projetos e cronograma · BeagleOne" },
      {
        name: "description",
        content:
          "Portfólio de projetos de TI com semáforo de saúde, gerente responsável, atualização semanal e progresso do cronograma.",
      },
      { property: "og:title", content: "Projetos e cronograma · BeagleOne" },
      {
        property: "og:description",
        content: "Portfólio de projetos de TI com semáforo de saúde e progresso do cronograma.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Projetos,
});

type Saude = "no_prazo" | "atencao" | "atrasado" | "encerrado";

const saudeLabel: Record<Saude, string> = {
  no_prazo: "No prazo",
  atencao: "Atenção",
  atrasado: "Atrasado",
  encerrado: "Encerrado",
};

const saudeDot: Record<Saude, string> = {
  no_prazo: "bg-success",
  atencao: "bg-warning",
  atrasado: "bg-destructive",
  encerrado: "bg-muted-foreground",
};

const DIA_MS = 86_400_000;

/**
 * Semáforo por progresso esperado × real.
 *
 * Compara quanto do prazo já passou com quanto do trabalho foi feito.
 * Um projeto com 80% do tempo consumido e 30% entregue está atrasado,
 * mesmo sem ter estourado a data — que é o sinal que interessa à
 * diretoria antes de virar problema.
 */
function calcularSaude(p: ProjetoComProgresso): Saude {
  if (p.status === "concluido" || p.status === "cancelado") return "encerrado";

  const inicio = new Date(p.inicio).getTime();
  const fim = new Date(p.fim).getTime();
  const agora = Date.now();

  if (agora > fim) return "atrasado";

  const duracao = Math.max(1, fim - inicio);
  const decorrido = Math.max(0, agora - inicio);
  const esperado = (decorrido / duracao) * 100;
  const desvio = esperado - p.progresso;

  if (desvio > 25) return "atrasado";
  if (desvio > 10) return "atencao";
  return "no_prazo";
}

function fmtData(v: Date | string): string {
  return new Date(v).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function diasRestantes(fim: Date | string): number {
  return Math.ceil((new Date(fim).getTime() - Date.now()) / DIA_MS);
}

/** Vivo: ainda pede algo de alguém. Encerrado não entra em indicador de alerta. */
function estaVivo(p: ProjetoComProgresso): boolean {
  return p.status === "planejamento" || p.status === "execucao" || p.status === "paralisado";
}

/**
 * Traduz o indicador clicado num teste sobre a lista.
 *
 * As condições espelham o SQL do `resumoPortfolio`. Se divergirem, o
 * card dirá 5 e a lista mostrará 7 — e o número perde a credibilidade
 * inteira, não só naquele card.
 */
function passaNoKpi(p: ProjetoComProgresso, kpi: ChaveKpi): boolean {
  switch (kpi) {
    case "priorizados":
      return estaVivo(p);
    case "semCronograma":
      return estaVivo(p) && p.totalTarefas === 0;
    case "execucao":
      return p.status === "execucao";
    case "planejamento":
      return p.status === "planejamento";
    case "paralisado":
      return p.status === "paralisado";
    case "concluido":
      return p.status === "concluido";
    case "prazoEstourado":
      return estaVivo(p) && new Date(p.fim).getTime() < Date.now();
    case "semAcompanhamento": {
      if (!estaVivo(p)) return false;
      const ref = p.ultimaAtualizacao ?? p.criadoEm;
      return (Date.now() - new Date(ref).getTime()) / DIA_MS > 7;
    }
    case "semGerente":
      return estaVivo(p) && p.gerenteId === null;
    default:
      return true;
  }
}

function Projetos() {
  /**
   * Os filtros vêm da URL e voltam para ela.
   *
   * `replace: true` de propósito: cada tecla digitada na busca não pode
   * virar uma entrada no histórico, senão o botão voltar percorreria a
   * palavra letra por letra em vez de levar de volta ao detalhe do
   * projeto.
   */
  const navegar = Route.useNavigate();
  const filtros = lerFiltros(Route.useSearch() as Record<string, unknown>);

  const mudar = (parcial: Partial<FiltrosProjetos>) => {
    void navegar({
      search: escreverFiltros({ ...filtros, ...parcial }),
      replace: true,
    });
  };

  const usuario = useQuery({
    queryKey: ["usuario-atual"],
    queryFn: () => usuarioAtualFn(),
  });
  const q = useQuery({
    queryKey: ["projetos"],
    queryFn: () => listarProjetosFn(),
  });

  /**
   * O que está priorizado e esta pessoa não pode abrir.
   *
   * A porta de pedir acesso ficava só no Backlog, numa aba chamada "Já
   * priorizados" — e ninguém procura projeto em execução numa tela cujo
   * nome diz que ali está o que ainda não foi decidido. Quem enxerga
   * tudo recebe lista vazia e não vê seção nenhuma.
   */
  const semAcesso = useQuery({
    queryKey: ["projetos-sem-acesso"],
    queryFn: () => listarProjetosSemAcessoFn(),
  });

  // Pedido já enviado não pode oferecer "Solicitar acesso" de novo: a
  // pessoa pediria duas vezes e o gerente receberia duas notificações.
  const minhas = useQuery({
    queryKey: ["minhas-solicitacoes"],
    queryFn: () => listarMinhasSolicitacoesFn(),
  });

  const pedidosPendentes = useMemo(
    () =>
      new Set((minhas.data ?? []).filter((s) => s.situacao === "pendente").map((s) => s.projetoId)),
    [minhas.data],
  );

  // Cadastrar projeto é aberto a toda a empresa: quem cria vira gerente
  // e passa a poder montar o cronograma dele.
  const autenticado = usuario.data !== undefined;
  const projetos: ProjetoComProgresso[] = useMemo(() => q.data ?? [], [q.data]);

  /**
   * As opções de cada filtro saem da própria carteira.
   *
   * Listar departamentos ou áreas sem projeto nenhum daria opções que
   * sempre resultam em lista vazia — e a pessoa culparia o filtro, não
   * o cadastro.
   */
  const gerentes = useMemo(
    () => [...new Set(projetos.map((p) => p.gerenteNome).filter(Boolean))].sort() as string[],
    [projetos],
  );

  const departamentos = useMemo(
    () =>
      ([...new Set(projetos.map((p) => p.gerenteDepartamento).filter(Boolean))] as string[]).sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [projetos],
  );

  const areas = useMemo(
    () =>
      ([...new Set(projetos.map((p) => p.areaDemandante).filter(Boolean))] as string[]).sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [projetos],
  );

  const encerrados = useMemo(
    () => projetos.filter((p) => p.status === "cancelado" || p.status === "concluido").length,
    [projetos],
  );

  const filtrados = useMemo(() => {
    const t = filtros.busca.trim().toLowerCase();
    return projetos.filter((p) => {
      const encerrado = p.status === "cancelado" || p.status === "concluido";
      // Filtrar por um status encerrado é pedir para vê-lo: o filtro
      // explícito manda mais do que o padrão de esconder.
      const escondido = encerrado && !filtros.encerrados && filtros.status === "todos";

      return (
        !escondido &&
        (filtros.gp === "todos" || p.gerenteNome === filtros.gp) &&
        (filtros.departamento === "todos" || p.gerenteDepartamento === filtros.departamento) &&
        (filtros.area === "todos" || p.areaDemandante === filtros.area) &&
        (filtros.status === "todos" || p.status === filtros.status) &&
        (filtros.kpi === null || passaNoKpi(p, filtros.kpi)) &&
        (!t || `${p.nome} ${p.objetivo ?? ""}`.toLowerCase().includes(t))
      );
    });
  }, [projetos, filtros]);

  const atrasados = projetos.filter((p) => calcularSaude(p) === "atrasado").length;

  const temFiltro =
    filtros.gp !== "todos" ||
    filtros.departamento !== "todos" ||
    filtros.area !== "todos" ||
    filtros.status !== "todos" ||
    filtros.kpi !== null ||
    filtros.busca.trim() !== "";

  return (
    <AppShell
      title="Projetos"
      subtitle="Portfólio de iniciativas de TI com semáforo de prazo, atualização semanal e riscos"
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os projetos: {String(q.error)}
          </div>
        ) : null}

        {/* Quatro seletores não cabem numa linha só em tela de notebook:
            a busca fica larga em cima, com o botão de criar, e os
            filtros se distribuem abaixo.

            O botão fica junto da lista, não no cabeçalho: "Abrir
            chamado" é ação global de toda tela, e dois botões primários
            no mesmo canto competem por atenção. */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou objetivo..."
                value={filtros.busca}
                maxLength={120}
                onChange={(e) => mudar({ busca: e.target.value })}
                className="pl-8"
              />
            </div>
            {autenticado ? <ProjectDialog /> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Select value={filtros.gp} onValueChange={(v) => mudar({ gp: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Responsável (GP)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os GPs</SelectItem>
                {gerentes.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Duas perguntas diferentes, e por isso dois filtros: o
                departamento diz de que área é quem TOCA o projeto; a
                área demandante, de quem PEDIU. Numa TI que atende a
                empresa inteira, as duas quase nunca coincidem. */}
            <Select value={filtros.departamento} onValueChange={(v) => mudar({ departamento: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Departamento do GP" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os departamentos</SelectItem>
                {departamentos.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filtros.area} onValueChange={(v) => mudar({ area: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Área demandante" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as áreas</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filtros.status}
              onValueChange={(v) =>
                // Um filtro de situação de cada vez: escolher o status
                // desliga o indicador, senão a lista vem vazia sem
                // explicar por quê.
                mudar({ status: v as FiltrosProjetos["status"], kpi: null })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filtro ativo precisa se anunciar: com quatro seletores é
              fácil esquecer que um está ligado e concluir que o
              portfólio encolheu. */}
          {temFiltro ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Mostrando {filtrados.length} de {projetos.length} projeto(s).
              <button
                type="button"
                onClick={() => mudar(FILTROS_VAZIOS)}
                className="text-primary hover:underline"
              >
                Limpar filtros
              </button>
            </p>
          ) : null}
        </div>

        {/* Os números do topo vêm do servidor e valem para a carteira
            inteira que a pessoa enxerga — não para o resultado da busca.
            Clicar filtra a lista abaixo; clicar de novo desliga. */}
        <KpisPortfolio
          cards={["execucao", "prazoEstourado", "semAcompanhamento", "paralisado"]}
          ativo={filtros.kpi}
          onAlternar={(c) =>
            // Um filtro de situação de cada vez, nos dois sentidos.
            mudar({
              kpi: c,
              ...(c !== null ? { status: "todos" as const } : {}),
            })
          }
        />

        {projetos.length > 0 ? (
          <div className="panel flex flex-wrap items-center gap-4 p-4 text-sm">
            {atrasados > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="size-4" />
                {atrasados} com progresso abaixo do esperado
              </span>
            ) : null}
            {encerrados > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto gap-2 text-muted-foreground"
                onClick={() => mudar({ encerrados: !filtros.encerrados })}
              >
                {filtros.encerrados ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {filtros.encerrados
                  ? `Ocultar ${encerrados} encerrado(s)`
                  : `Mostrar ${encerrados} encerrado(s)`}
              </Button>
            ) : null}
          </div>
        ) : null}

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando projetos...
          </p>
        ) : filtrados.length === 0 ? (
          <div className="panel p-8 text-center">
            <ListChecks className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {projetos.length === 0 ? "Nenhum projeto cadastrado" : "Nenhum projeto encontrado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {projetos.length === 0
                ? "Cadastre o primeiro projeto para acompanhar cronograma, riscos e capacidade da equipe."
                : "Tente outros filtros."}
            </p>
            {projetos.length > 0 && temFiltro ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => mudar(FILTROS_VAZIOS)}
              >
                Limpar filtros
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtrados.map((p) => (
              <CardProjeto key={p.id} projeto={p} editavel={autenticado} />
            ))}
          </div>
        )}

        {/* Projetos que a pessoa vê pelo nome mas não pode abrir.

            Fica no fim de propósito: é o que ela NÃO tem, e abrir a tela
            com isso inverteria a prioridade da leitura. Mas fica nesta
            tela, e não só no backlog, porque é aqui que se procura
            projeto priorizado — era essa a porta que faltava. */}
        {(semAcesso.data ?? []).length > 0 ? (
          <section className="space-y-2 pt-2">
            <div>
              <h2 className="text-sm font-semibold">Projetos sem acesso</h2>
              <p className="text-xs text-muted-foreground">
                Priorizados, tocados por outras áreas. Você vê o nome para saber que existem; para
                abrir o cronograma, peça acesso ao gerente.
              </p>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              {(semAcesso.data ?? []).map((p) => (
                <article
                  key={p.id}
                  className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.gerenteNome ?? "Sem gerente"}
                      {p.areaDemandante ? ` · ${p.areaDemandante}` : ""}
                    </p>
                  </div>

                  {/* Três estados, não dois: sem o do meio, o botão
                      continuaria convidando a pedir depois de a pessoa
                      já ter pedido. */}
                  {pedidosPendentes.has(p.id) ? (
                    <span className="shrink-0 text-xs text-warning">Pedido em análise</span>
                  ) : (
                    <DialogoSolicitarAcesso
                      projetoId={p.id}
                      projetoNome={p.nome}
                      trigger={
                        <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
                          <Lock className="size-3.5" /> Solicitar acesso
                        </Button>
                      }
                    />
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

/**
 * Card do projeto.
 *
 * O card inteiro leva ao detalhe, mas situação e exclusão são ações que
 * moram aqui: são o que se faz varrendo a lista, sem querer entrar em
 * cada projeto.
 *
 * O link é uma camada absoluta por baixo do conteúdo, e o conteúdo não
 * captura ponteiro — só os controles voltam a capturar. Envolver tudo
 * num `<Link>` faria o seletor abrir e navegar ao mesmo tempo.
 */
function CardProjeto({
  projeto: p,
  editavel,
}: {
  projeto: ProjetoComProgresso;
  editavel: boolean;
}) {
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);

  const saude = calcularSaude(p);
  const dias = diasRestantes(p.fim);
  const encerrado = saude === "encerrado";

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["projeto", p.id] });
  };

  /**
   * O que impede apagar, buscado só quando a confirmação abre.
   *
   * Consultar para os dois cards da tela de uma vez seria uma requisição
   * por projeto sem que ninguém tenha pedido nada.
   */
  const impedimentos = useQuery({
    queryKey: ["projeto-impedimentos", p.id],
    queryFn: () => impedimentosDeExclusaoFn({ data: { id: p.id } }),
    enabled: confirmando,
  });

  const total = impedimentos.data
    ? impedimentos.data.tarefas +
      impedimentos.data.riscos +
      impedimentos.data.atencoes +
      impedimentos.data.atualizacoes +
      impedimentos.data.baselines
    : 0;

  const podeExcluir = impedimentos.isSuccess && total === 0;

  const excluir = useMutation({
    mutationFn: () => excluirProjetoFn({ data: { id: p.id } }),
    onSuccess: () => {
      setConfirmando(false);
      invalidar();
      toast.success("Projeto excluído");
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  /**
   * Cancelar continua aqui, e não no seletor compartilhado: é a saída
   * do diálogo de exclusão, com fechamento e mensagem próprios.
   */
  const cancelar = useMutation({
    mutationFn: () => definirStatusProjetoFn({ data: { id: p.id, status: "cancelado" } }),
    onSuccess: () => {
      setConfirmando(false);
      invalidar();
      toast.success("Projeto cancelado", {
        description: "Ele continua na lista, com a situação alterada.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  /** Descreve o que impede, para a pessoa saber o que existe ali dentro. */
  const oQueTem = impedimentos.data
    ? [
        impedimentos.data.tarefas ? `${impedimentos.data.tarefas} tarefa(s)` : "",
        impedimentos.data.riscos ? `${impedimentos.data.riscos} risco(s)` : "",
        impedimentos.data.atencoes ? `${impedimentos.data.atencoes} ponto(s) de atenção` : "",
        impedimentos.data.atualizacoes ? `${impedimentos.data.atualizacoes} acompanhamento(s)` : "",
        impedimentos.data.baselines ? `${impedimentos.data.baselines} baseline(s)` : "",
      ].filter(Boolean)
    : [];

  return (
    <article className="panel relative p-5 transition-colors hover:border-primary/40">
      <Link
        to="/projetos/$projectId"
        params={{ projectId: p.id }}
        aria-label={`Abrir ${p.nome}`}
        className="absolute inset-0 rounded-xl"
      />

      <div className="pointer-events-none relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{p.nome}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {p.gerenteNome ?? "Sem gerente"}
              {p.sponsorNome ? ` · patrocínio de ${p.sponsorNome}` : ""}
            </p>
          </div>

          <span className="pointer-events-auto flex shrink-0 items-center gap-1">
            {/* Mesmo componente do detalhe do projeto: a mutação, o
                toast e as chaves de invalidação vivem lá dentro. */}
            <SeletorStatusProjeto projetoId={p.id} status={p.status} editavel={editavel} />

            {editavel ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Excluir ou cancelar"
                onClick={() => setConfirmando(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </span>
        </div>

        {/* Área demandante ao lado do objetivo: é o que responde "de quem
            é este projeto" quando se varre a lista, e agora é filtro. */}
        {p.areaDemandante ? (
          <Badge variant="outline" className="mt-2 text-[10px]">
            {p.areaDemandante}
          </Badge>
        ) : null}

        {p.objetivo ? (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.objetivo}</p>
        ) : null}

        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", saudeDot[saude])} />
              <span
                className={cn(
                  saude === "atrasado"
                    ? "text-destructive"
                    : saude === "atencao"
                      ? "text-warning"
                      : "text-muted-foreground",
                )}
              >
                {saudeLabel[saude]}
              </span>
            </span>
            <span className="font-mono">{p.progresso}%</span>
          </div>
          <Progress value={p.progresso} />
          <p className="text-xs text-muted-foreground">
            {p.tarefasConcluidas} de {p.totalTarefas} tarefa(s) concluída(s)
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            {fmtData(p.inicio)} — {fmtData(p.fim)}
          </span>
          {!encerrado ? (
            <span className={cn(dias < 0 ? "text-destructive" : "")}>
              {dias < 0 ? `${Math.abs(dias)}d em atraso` : `${dias}d restantes`}
            </span>
          ) : null}
          {p.riscosAbertos > 0 ? (
            <Badge variant="outline" className="border-warning/40 text-xs text-warning">
              {p.riscosAbertos} risco(s)
            </Badge>
          ) : null}
          {p.atencoesAbertas > 0 ? (
            <Badge variant="outline" className="border-destructive/40 text-xs text-destructive">
              {p.atencoesAbertas} decisão(ões) pendente(s)
            </Badge>
          ) : null}
          {p.ultimaAtualizacao ? (
            <span className="ml-auto">Atualizado em {fmtData(p.ultimaAtualizacao)}</span>
          ) : (
            <span className="ml-auto text-warning">Sem atualização registrada</span>
          )}
        </div>
      </div>

      {/* Um diálogo só para os dois caminhos: a pessoa não precisa saber
          de antemão se o projeto pode ser apagado. Ela pede para remover,
          e o sistema responde com a saída possível. */}
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {impedimentos.isPending
                ? "Verificando..."
                : podeExcluir
                  ? `Excluir “${p.nome}”?`
                  : `Cancelar “${p.nome}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {impedimentos.isPending ? (
                "Conferindo se este projeto já tem histórico."
              ) : podeExcluir ? (
                <>
                  Este projeto não tem tarefas, riscos nem acompanhamento, então nada se perde. Ele
                  sai do banco de vez.
                </>
              ) : (
                <>
                  Este projeto já tem {oQueTem.join(", ")} e por isso não pode ser apagado — o
                  histórico do que aconteceu ficaria sem dono. O que dá para fazer é cancelá-lo: ele
                  continua na lista, com a situação alterada, e para de contar no acompanhamento.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            {impedimentos.isPending ? null : podeExcluir ? (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  excluir.mutate();
                }}
              >
                {excluir.isPending ? "Excluindo..." : "Excluir"}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  cancelar.mutate();
                }}
              >
                {cancelar.isPending ? "Cancelando..." : "Cancelar projeto"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
