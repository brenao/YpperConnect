import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Loader2, Lock, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { KpisPortfolio, type ChaveKpi } from "@/views/kpis-portfolio";
import { ProjectDialog } from "@/views/project-dialogs";
import { DialogoSolicitarAcesso } from "@/views/dialogo-solicitar-acesso";
import { Paginacao, usePaginacao } from "@/views/paginacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import {
  QUADRANTE_LABEL,
  calcularScore,
  quadranteDe,
  rotuloEsforco,
  type ModeloPriorizacao,
  type Quadrante,
} from "@/services/priorizacao";
import type { ProjetoBacklog } from "@/repositories/backlog.repo";
import type { Projeto } from "@/repositories/projetos.repo";
import {
  listarBacklogFn,
  promoverDemandaFn,
  descartarDemandaFn,
} from "@/services/backlog.functions";
import { idsComAcessoFn, listarMinhasSolicitacoesFn } from "@/services/acesso-projeto.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/backlog")({
  head: () => ({
    meta: [
      { title: "Backlog de projetos · BeagleOne" },
      {
        name: "description",
        content:
          "Projetos aguardando priorização, com pontuação por valor e esforço e matriz de decisão.",
      },
    ],
  }),
  component: Backlog,
});

/** Radix não aceita SelectItem com value vazio. */
const TODOS = "__todos__";

/**
 * O item do backlog é um projeto: mesmos campos, mesmo formulário.
 *
 * O cast existe porque a consulta do backlog traz um subconjunto tipado
 * à parte — sem tarefas, sem progresso — e o diálogo espera o tipo
 * completo. É seguro porque o diálogo só lê os campos que o SELECT
 * garante.
 */
function comoProjeto(p: ProjetoBacklog): Projeto {
  return p as unknown as Projeto;
}

/** Cor da tarja por situação: verde anda, vermelho parou, cinza encerrou. */
function classeStatus(status: string): string {
  switch (status) {
    case "execucao":
      return "border-success/40 text-success";
    case "planejamento":
      return "border-info/40 text-info";
    case "paralisado":
      return "border-warning/40 text-warning";
    case "cancelado":
      return "border-destructive/40 text-destructive";
    default:
      return "";
  }
}

/** Pessoas que aparecem como gerente ou patrocinador, para os filtros. */
function pessoasDe(
  itens: ProjetoBacklog[],
  campoId: "gerenteId" | "sponsorId",
  campoNome: "gerenteNome" | "sponsorNome",
): { id: string; nome: string }[] {
  const mapa = new Map<string, string>();
  for (const d of itens) {
    const id = d[campoId];
    if (id) mapa.set(id, d[campoNome] ?? "Sem nome");
  }
  return [...mapa].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * O que a pessoa pode fazer com aquela linha.
 *
 * Três estados, e não dois: sem acesso, pedido em análise, e acesso
 * liberado. O estado do meio existe porque, sem ele, o botão continuaria
 * dizendo "Solicitar acesso" depois de a pessoa já ter solicitado — e
 * ela pediria de novo.
 */
type EstadoAcesso = "liberado" | "pendente" | "bloqueado";

/**
 * A matriz virou aba, e não um modo de exibição da fila.
 *
 * Enquanto mostrava só o que aguarda decisão, ela cabia dentro da aba
 * da fila. Agora que posiciona também o que já foi priorizado, ela
 * responde outra pergunta — "o que aprovamos tinha mesmo o melhor
 * retorno?" —, e essa pergunta não pertence a nenhuma das duas listas.
 */
type Aba = "fila" | "priorizados" | "matriz";

function Backlog() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtroGerente, setFiltroGerente] = useState(TODOS);
  const [filtroSponsor, setFiltroSponsor] = useState(TODOS);
  const [aba, setAba] = useState<Aba>("fila");

  /**
   * Indicador ativo na faixa de cima.
   *
   * Aqui ele também troca de aba: clicar em "em execução" e continuar na
   * aba da fila mostraria uma lista vazia sem dizer por quê — e a pessoa
   * concluiria que o número do card está errado.
   */
  const [kpi, setKpi] = useState<ChaveKpi | null>(null);
  // Uma instância só do formulário, aberta pela linha clicada. Um
  // diálogo por linha seria centenas de componentes montados só para
  // esperar um clique — o mesmo motivo que tirou o Dialog de dentro da
  // tabela de usuários em Administração.
  const [editando, setEditando] = useState<ProjetoBacklog | undefined>(undefined);
  const [edicaoAberta, setEdicaoAberta] = useState(false);

  function abrirEdicao(d: ProjetoBacklog) {
    setEditando(d);
    setEdicaoAberta(true);
  }

  const q = useQuery({
    queryKey: ["backlog"],
    queryFn: () => listarBacklogFn(),
  });

  /**
   * O backlog passou a listar a carteira inteira, e não só o que a
   * pessoa pode abrir: ver o nome de todos os projetos é o que evita
   * duas áreas cadastrarem a mesma demanda sem saber uma da outra.
   *
   * Estas duas consultas são o que separa "vejo o nome" de "posso
   * abrir". Vêm de uma vez, e não por linha: são centenas de projetos na
   * tela, e uma consulta por cartão seria uma enxurrada para responder
   * algo que cabe em dois conjuntos.
   */
  const acessos = useQuery({
    queryKey: ["ids-com-acesso"],
    queryFn: () => idsComAcessoFn(),
  });
  const minhas = useQuery({
    queryKey: ["minhas-solicitacoes"],
    queryFn: () => listarMinhasSolicitacoesFn(),
  });

  const comAcesso = useMemo(() => new Set(acessos.data ?? []), [acessos.data]);
  const pedidosPendentes = useMemo(
    () =>
      new Set((minhas.data ?? []).filter((s) => s.situacao === "pendente").map((s) => s.projetoId)),
    [minhas.data],
  );

  const estadoDe = (id: string): EstadoAcesso =>
    comAcesso.has(id) ? "liberado" : pedidosPendentes.has(id) ? "pendente" : "bloqueado";

  const modelo: ModeloPriorizacao = q.data?.modelo ?? "simples";
  const podeGerir = q.data?.podeGerir ?? false;
  const itens = useMemo(() => q.data?.demandas ?? [], [q.data]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const promover = useMutation({
    mutationFn: (id: string) => promoverDemandaFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto priorizado", {
        description: "Ele saiu da fila e agora aparece entre os projetos em andamento.",
      });
    },
    onError: erro,
  });

  const descartar = useMutation({
    mutationFn: (id: string) => descartarDemandaFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto descartado");
    },
    onError: erro,
  });

  const gerentes = useMemo(() => pessoasDe(itens, "gerenteId", "gerenteNome"), [itens]);
  const patrocinadores = useMemo(() => pessoasDe(itens, "sponsorId", "sponsorNome"), [itens]);

  const temFiltro = busca.trim() !== "" || filtroGerente !== TODOS || filtroSponsor !== TODOS;

  function limparFiltros() {
    setBusca("");
    setFiltroGerente(TODOS);
    setFiltroSponsor(TODOS);
  }

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return itens.filter((d) => {
      if (filtroGerente !== TODOS && d.gerenteId !== filtroGerente) return false;
      if (filtroSponsor !== TODOS && d.sponsorId !== filtroSponsor) return false;
      if (!t) return true;
      return `${d.nome} ${d.objetivo ?? ""} ${d.areaDemandante ?? ""} ${d.justificativa ?? ""}`
        .toLowerCase()
        .includes(t);
    });
  }, [itens, busca, filtroGerente, filtroSponsor]);

  /**
   * A fila é ordenada pelo nome.
   *
   * O arrastar-e-soltar saiu junto com a paginação: mover um item para
   * uma posição que está em outra página é operação que ninguém
   * consegue conferir. A ordem alfabética é a que sobra sendo previsível
   * — a pessoa que procura um projeto sabe onde ele está sem precisar
   * entender o critério, e a lista não se reorganiza sozinha quando
   * alguém edita uma pontuação.
   *
   * Quem decide prioridade não usa esta lista para isso: usa a matriz,
   * onde valor e esforço posicionam cada projeto. Ordenar aqui por score
   * seria repetir mal o que a matriz faz bem.
   *
   * `localeCompare` com sensibilidade de base resolve acento e caixa:
   * "Órion" e "orion" caem lado a lado, e não em pontas opostas.
   */
  const naFila = useMemo(() => {
    return filtrados
      .filter((d) => d.status === "backlog")
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  }, [filtrados]);

  /**
   * Priorizados: em ordem alfabética e recortados pelo indicador ativo.
   *
   * A ordenação é a mesma da fila. Sem ela, a lista vinha na ordem em
   * que o banco devolveu — estável o bastante para não parecer
   * aleatória, e imprevisível o bastante para ninguém achar um projeto
   * pelo nome.
   *
   * Os três indicadores desta tela são de situação, então o recorte
   * cabe numa comparação direta com o status.
   */
  const priorizados = useMemo(() => {
    const base = filtrados
      .filter((d) => d.status !== "backlog")
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

    if (kpi === null || kpi === "backlog") return base;
    return base.filter((d) => d.status === kpi);
  }, [filtrados, kpi]);

  /**
   * O que a matriz posiciona: a fila e o que já foi priorizado.
   *
   * Concluído e cancelado ficam de fora. Eles ainda têm valor e esforço
   * gravados e cairiam num quadrante, ocupando espaço com decisão que
   * já aconteceu e não volta atrás — a matriz existe para o que ainda
   * dá para mudar.
   */
  const paraMatriz = useMemo(
    () => filtrados.filter((d) => d.status !== "concluido" && d.status !== "cancelado"),
    [filtrados],
  );

  // A chave inclui a aba: com a mesma chave nas duas listas, trocar de
  // aba deixaria a segunda aberta numa página que só a primeira tinha.
  const paginaFila = usePaginacao(naFila, `fila|${busca}|${filtroGerente}|${filtroSponsor}`);
  const paginaPriorizados = usePaginacao(
    priorizados,
    `prio|${busca}|${filtroGerente}|${filtroSponsor}|${kpi ?? ""}`,
  );

  return (
    <AppShell
      title="Backlog de projetos"
      subtitle="A carteira inteira num lugar só: o que aguarda decisão e o que já foi priorizado."
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar o backlog: {String(q.error)}
          </div>
        ) : null}

        {/* Os números vêm do servidor e valem para a carteira inteira
            que a pessoa enxerga — não para o resultado da busca. Clicar
            leva à aba certa e filtra; clicar de novo desliga.

            O modelo de priorização não está aqui: era um rótulo de
            configuração no meio de uma faixa de magnitudes, e quebrava a
            varredura. Ele aparece na matriz, que é onde a pontuação de
            fato é usada. */}
        <KpisPortfolio
          cards={["backlog", "execucao", "planejamento"]}
          ativo={kpi}
          onAlternar={(c) => {
            setKpi(c);
            if (c === "backlog") setAba("fila");
            else if (c !== null) setAba("priorizados");
          }}
        />

        {/* Uma linha só: a busca ocupa o que sobra, os seletores têm
            largura fixa. Crescer a barra em duas linhas faria o filtro
            competir com a lista pelo primeiro olhar. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, objetivo, área ou justificativa..."
              className="pl-8"
            />
          </div>

          <Select value={filtroGerente} onValueChange={setFiltroGerente}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Gerente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os gerentes</SelectItem>
              {gerentes.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroSponsor} onValueChange={setFiltroSponsor}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Patrocinador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os patrocinadores</SelectItem>
              {patrocinadores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ProjectDialog statusInicial="backlog" modelo={modelo} />
        </div>

        {/* Sem este aviso, filtrar e esquecer faz a pessoa concluir que
            o backlog esvaziou. */}
        {temFiltro ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Filtro ativo: {naFila.length} na fila e {priorizados.length} priorizado(s) de{" "}
            {itens.length} projeto(s).
            <button type="button" onClick={limparFiltros} className="text-primary hover:underline">
              Limpar filtros
            </button>
          </p>
        ) : null}

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando backlog...
          </p>
        ) : itens.length === 0 ? (
          <div className="panel px-5 py-12 text-center">
            <p className="text-sm font-medium">Nenhum projeto cadastrado.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Registre aqui o que foi pedido mas ainda não foi decidido. Projeto na fila não cobra
              acompanhamento semanal nem ocupa a capacidade da equipe — e entra na carteira no dia
              em que for priorizado.
            </p>
          </div>
        ) : (
          <Tabs value={aba} onValueChange={(v) => setAba(v as "fila" | "priorizados")}>
            <TabsList>
              <TabsTrigger value="fila">Na fila ({naFila.length})</TabsTrigger>
              <TabsTrigger value="priorizados">Já priorizados ({priorizados.length})</TabsTrigger>
              <TabsTrigger value="matriz">Matriz ({paraMatriz.length})</TabsTrigger>
            </TabsList>

            {/* ------------------------------------------------- na fila */}
            <TabsContent value="fila" className="mt-4">
              {naFila.length === 0 ? (
                <div className="panel px-5 py-10 text-center text-sm text-muted-foreground">
                  {temFiltro
                    ? "Nenhum projeto da fila corresponde aos filtros."
                    : "Nada aguardando decisão no momento."}
                </div>
              ) : (
                <div className="panel overflow-hidden">
                  <Paginacao {...paginaFila.controles} rotulo="na fila" posicao="topo" />
                  <ol className="divide-y divide-border">
                    {paginaFila.visiveis.map((d, i) => (
                      <LinhaBacklog
                        key={d.id}
                        posicao={paginaFila.controles.primeiro + i}
                        item={d}
                        modelo={modelo}
                        podeGerir={podeGerir}
                        acesso={estadoDe(d.id)}
                        promovendo={promover.isPending}
                        onEditar={() => abrirEdicao(d)}
                        onPromover={() => promover.mutate(d.id)}
                        onDescartar={() => descartar.mutate(d.id)}
                      />
                    ))}
                  </ol>
                  <Paginacao {...paginaFila.controles} rotulo="na fila" />
                </div>
              )}
            </TabsContent>

            {/* -------------------------------------------- priorizados */}
            <TabsContent value="priorizados" className="mt-4">
              {priorizados.length === 0 ? (
                <div className="panel px-5 py-10 text-center text-sm text-muted-foreground">
                  {kpi !== null
                    ? "Nenhum projeto nessa situação."
                    : temFiltro
                      ? "Nenhum projeto priorizado corresponde aos filtros."
                      : "Nenhum projeto priorizado ainda."}
                </div>
              ) : (
                <div className="panel overflow-hidden">
                  <Paginacao {...paginaPriorizados.controles} rotulo="priorizados" posicao="topo" />
                  <ul className="divide-y divide-border">
                    {paginaPriorizados.visiveis.map((d) => (
                      <LinhaPriorizada
                        key={d.id}
                        item={d}
                        acesso={estadoDe(d.id)}
                        onEditar={() => abrirEdicao(d)}
                      />
                    ))}
                  </ul>
                  <Paginacao {...paginaPriorizados.controles} rotulo="priorizados" />
                </div>
              )}
            </TabsContent>

            {/* ------------------------------------------------- matriz */}
            <TabsContent value="matriz" className="mt-4">
              <Matriz itens={paraMatriz} modelo={modelo} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Fora das abas: é a linha da lista que o abre, e mantê-lo aqui
          evita remontá-lo a cada troca de aba ou de página. */}
      <ProjectDialog
        project={editando ? comoProjeto(editando) : undefined}
        modelo={modelo}
        open={edicaoAberta}
        onOpenChange={(v) => {
          setEdicaoAberta(v);
          if (!v) setEditando(undefined);
        }}
      />
    </AppShell>
  );
}

/**
 * Ações de uma linha para quem ainda não tem acesso.
 *
 * O estado fica na própria linha, e não numa caixa de entrada separada:
 * a pessoa descobre que o pedido está em análise no mesmo lugar onde
 * ela pediu, sem precisar lembrar de visitar outra tela.
 */
function AcoesSemAcesso({ item: d, acesso }: { item: ProjetoBacklog; acesso: EstadoAcesso }) {
  if (acesso === "pendente") {
    return (
      <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
        Acesso em análise
      </Badge>
    );
  }
  return (
    <DialogoSolicitarAcesso
      projetoId={d.id}
      projetoNome={d.nome}
      trigger={
        <Button variant="outline" size="sm" className="gap-1.5">
          <Lock className="size-3.5" /> Solicitar acesso
        </Button>
      }
    />
  );
}

function LinhaBacklog({
  posicao,
  item: d,
  modelo,
  podeGerir,
  acesso,
  promovendo,
  onPromover,
  onDescartar,
  onEditar,
}: {
  posicao: number;
  item: ProjetoBacklog;
  modelo: ModeloPriorizacao;
  podeGerir: boolean;
  acesso: EstadoAcesso;
  promovendo: boolean;
  onPromover: () => void;
  onDescartar: () => void;
  onEditar: () => void;
}) {
  const score = calcularScore(modelo, d);
  const quadrante = quadranteDe(d);
  const liberado = acesso === "liberado";
  // Sem acesso, o resumo não aparece: o combinado é que todo mundo veja
  // o nome para não cadastrar em duplicidade, não que todo mundo leia o
  // objetivo e a justificativa de qualquer área.
  const resumo = liberado ? (d.objetivo ?? d.justificativa) : null;

  return (
    /* A linha inteira abre a edição: o lápis era um alvo de 14px numa
       linha de 900, e quem quer editar clica no nome. As ações param a
       propagação para não abrir o formulário junto. Sem acesso não há o
       que editar, e aí a linha não é clicável. */
    <li
      onClick={liberado ? onEditar : undefined}
      className={cn(
        "flex items-start gap-3 p-4",
        liberado ? "cursor-pointer transition-colors hover:bg-secondary/40" : "",
      )}
    >
      <span className="mt-0.5 w-6 shrink-0 font-mono text-sm text-muted-foreground">{posicao}</span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {d.nome}
          {d.sigiloso ? <Lock className="size-3 shrink-0 text-warning" /> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {d.areaDemandante ?? "Sem área"}
          {d.gerenteNome ? ` · ${d.gerenteNome}` : ""}
          {d.sponsorNome ? ` · patrocínio de ${d.sponsorNome}` : ""}
        </p>
        {resumo ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{resumo}</p>
        ) : null}

        {liberado ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {score === null ? (
              <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
                Sem pontuação
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px]">
                score {score}
              </Badge>
            )}
            {d.valor !== null ? (
              <Badge variant="outline" className="text-[10px]">
                valor {d.valor}
              </Badge>
            ) : null}
            {d.esforco !== null ? (
              <Badge variant="outline" className="text-[10px]">
                esforço {rotuloEsforco(modelo, d.esforco)}
              </Badge>
            ) : null}
            {quadrante ? (
              <Badge variant="outline" className="text-[10px]">
                {QUADRANTE_LABEL[quadrante]}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!liberado ? (
          <span onClick={(e) => e.stopPropagation()}>
            <AcoesSemAcesso item={d} acesso={acesso} />
          </span>
        ) : podeGerir ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Descartar"
              onClick={(e) => {
                e.stopPropagation();
                onDescartar();
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={promovendo}
              title="Mover para Projetos e começar o cronograma"
              onClick={(e) => {
                e.stopPropagation();
                onPromover();
              }}
            >
              Priorizar <ArrowRight className="size-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Linha do que já saiu da fila.
 *
 * Sem priorizar e sem descartar: aqui a decisão já foi tomada, e as
 * ações da fila não fazem mais sentido. O que interessa é a situação e
 * o quanto andou — e o caminho para o cronograma.
 */
function LinhaPriorizada({
  item: d,
  acesso,
  onEditar,
}: {
  item: ProjetoBacklog;
  acesso: EstadoAcesso;
  onEditar: () => void;
}) {
  const encerrado = d.status === "concluido" || d.status === "cancelado";
  const liberado = acesso === "liberado";
  const resumo = liberado ? (d.objetivo ?? d.justificativa) : null;

  return (
    <li
      onClick={liberado ? onEditar : undefined}
      className={cn(
        "flex items-start gap-3 p-4",
        encerrado ? "opacity-60" : "",
        liberado ? "cursor-pointer transition-colors hover:bg-secondary/40" : "",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {d.nome}
          {d.sigiloso ? <Lock className="size-3 shrink-0 text-warning" /> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {d.areaDemandante ?? "Sem área"}
          {d.gerenteNome ? ` · ${d.gerenteNome}` : ""}
          {d.sponsorNome ? ` · patrocínio de ${d.sponsorNome}` : ""}
        </p>
        {resumo ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{resumo}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("text-[10px]", classeStatus(d.status))}>
            {PROJECT_STATUS_LABEL[d.status as ProjectStatus] ?? d.status}
          </Badge>
          {/* Progresso só para quem tem acesso: é número de andamento
              interno, não identificação do projeto. */}
          {liberado ? (
            <>
              <Badge variant="outline" className="font-mono text-[10px]">
                {d.progresso}%
              </Badge>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                <span
                  className="block h-full rounded-full bg-primary/70"
                  style={{ width: `${d.progresso}%` }}
                />
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!liberado ? (
          <span onClick={(e) => e.stopPropagation()}>
            <AcoesSemAcesso item={d} acesso={acesso} />
          </span>
        ) : (
          /* O link navega; sem parar a propagação ele abriria o
             formulário de edição no caminho de saída. */
          <Link
            to="/projetos/$projectId"
            params={{ projectId: d.id }}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:underline"
          >
            Cronograma <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * Matriz valor × esforço.
 *
 * É o artefato que funciona numa reunião de priorização: mostra de
 * relance o que é ganho rápido e o que é aposta cara. Só entra quem tem
 * pontuação — posicionar o não avaliado em algum canto sugeriria uma
 * avaliação que ninguém fez.
 *
 * Posiciona a fila E o que já foi priorizado. Enquanto mostrava só o
 * que aguarda decisão, ela respondia "o que fazer agora?" e deixava sem
 * resposta a pergunta seguinte, que é a que ensina: "o que já foi
 * aprovado estava mesmo nos melhores quadrantes?". Um projeto em
 * execução no canto de questionar é a conversa mais útil que esta tela
 * pode provocar.
 *
 * O modelo em uso aparece aqui, e só aqui: é nesta visão que a fórmula
 * muda o que se vê, e saber que "esforço 3" vem do RICE ou do modelo
 * simples é o que permite discordar da posição de um quadrante.
 */
function Matriz({ itens, modelo }: { itens: ProjetoBacklog[]; modelo: ModeloPriorizacao }) {
  const porQuadrante = useMemo(() => {
    const m = new Map<Quadrante, ProjetoBacklog[]>();
    for (const d of itens) {
      const q = quadranteDe(d);
      if (!q) continue;
      m.set(q, [...(m.get(q) ?? []), d]);
    }
    return m;
  }, [itens]);

  const semPontuacao = itens.filter((d) => quadranteDe(d) === null);

  // A ordem desenha o plano cartesiano: valor alto em cima, esforço
  // baixo à esquerda.
  const ordem: { q: Quadrante; classe: string }[] = [
    { q: "ganho_rapido", classe: "border-success/40" },
    { q: "aposta", classe: "border-info/40" },
    { q: "preencher", classe: "border-border" },
    { q: "descartar", classe: "border-warning/40" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pontuação por{" "}
        <strong className="font-medium text-foreground">
          {modelo === "rice" ? "RICE" : "valor ÷ esforço"}
        </strong>
        {modelo === "rice"
          ? " — alcance × impacto × confiança ÷ esforço."
          : " — modelo simples, definido em Administração."}{" "}
        Concluídos e cancelados ficam de fora: a matriz é sobre o que ainda dá para mudar.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {ordem.map(({ q, classe }) => {
          const lista = porQuadrante.get(q) ?? [];
          return (
            <section key={q} className={cn("panel p-4", classe)}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{QUADRANTE_LABEL[q]}</h2>
                {/* Quantos do quadrante já saíram da fila: é o número
                    que diz se a decisão seguiu a matriz ou não. */}
                <span className="font-mono text-xs text-muted-foreground">
                  {lista.length}
                  {lista.some((d) => d.status !== "backlog")
                    ? ` · ${lista.filter((d) => d.status !== "backlog").length} priorizado(s)`
                    : ""}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {q === "ganho_rapido"
                  ? "Muito valor, pouco esforço. Faça agora."
                  : q === "aposta"
                    ? "Muito valor, muito esforço. Precisa de decisão."
                    : q === "preencher"
                      ? "Pouco valor, pouco esforço. Encaixa nas folgas."
                      : "Pouco valor, muito esforço. Vale perguntar por quê."}
              </p>

              <ul className="mt-3 space-y-1.5">
                {lista.map((d) => {
                  const naFila = d.status === "backlog";
                  return (
                    /* Priorizado ganha fundo e tarja com a situação; a
                       fila continua com o cartão vazado. A situação vai
                       por escrito, e não só por cor: quem imprime a
                       matriz para a reunião perde a cor, e "priorizado"
                       responde menos do que "em execução". */
                    <li
                      key={d.id}
                      className={cn(
                        "rounded-md border p-2",
                        naFila ? "border-border" : "border-primary/30 bg-primary/5",
                      )}
                    >
                      <p className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="truncate">{d.nome}</span>
                        {d.sigiloso ? <Lock className="size-3 shrink-0 text-warning" /> : null}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {!naFila ? (
                          <Badge
                            variant="outline"
                            className={cn("text-[10px]", classeStatus(d.status))}
                          >
                            {PROJECT_STATUS_LABEL[d.status as ProjectStatus] ?? d.status}
                          </Badge>
                        ) : null}
                        <span className="truncate">
                          {d.areaDemandante ?? "Sem área"} · score {calcularScore(modelo, d) ?? "—"}
                        </span>
                      </p>
                    </li>
                  );
                })}
                {lista.length === 0 ? (
                  <li className="py-3 text-center text-xs text-muted-foreground">Vazio</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Legenda: a cor sozinha não carrega a informação — quem imprime
          a matriz para a reunião a perde inteira. */}
      <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] border border-border" /> aguardando decisão
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] border border-primary/30 bg-primary/5" /> já
          priorizado
        </span>
        {semPontuacao.length > 0 ? (
          <span>
            {semPontuacao.length} projeto(s) fora da matriz por falta de valor ou esforço.
          </span>
        ) : null}
      </p>
    </div>
  );
}
