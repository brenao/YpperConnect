import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Lock, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
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
import {
  QUADRANTE_LABEL,
  calcularScore,
  quadranteDe,
  rotuloEsforco,
  type ModeloPriorizacao,
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

/**
 * Backlog: só o que ainda aguarda decisão.
 *
 * A tela listava a carteira inteira em abas — fila, priorizados e
 * matriz. Funcionava, e era o lugar errado para duas das três: quem
 * abre o backlog quer decidir o que entra, não revisar o que já entrou.
 *
 * O que já foi priorizado mora em Projetos em andamento; o que parou,
 * em Paralisados; a matriz ganhou tela própria, porque é a única visão
 * que precisa das três ao mesmo tempo.
 *
 * A consulta continua trazendo a carteira toda — é a mesma que alimenta
 * as outras telas —, e o recorte é feito aqui. Uma consulta por tela
 * economizaria bytes e criaria quatro versões da mesma regra para
 * divergir.
 */
export const Route = createFileRoute("/backlog")({
  head: () => ({
    meta: [
      { title: "Backlog de projetos · BeagleOne" },
      {
        name: "description",
        content: "Demandas registradas aguardando priorização, com pontuação por valor e esforço.",
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

function Backlog() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtroGerente, setFiltroGerente] = useState(TODOS);
  const [filtroSponsor, setFiltroSponsor] = useState(TODOS);

  // Uma instância só do formulário, aberta pela linha clicada. Um
  // diálogo por linha seria centenas de componentes montados só para
  // esperar um clique.
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
   * Duas consultas que separam "vejo o nome" de "posso abrir".
   *
   * O backlog mostra o nome de todo projeto não sigiloso a qualquer
   * usuário — é o que evita duas áreas cadastrarem a mesma demanda sem
   * saber uma da outra. Abrir o conteúdo é outra permissão.
   *
   * Vêm de uma vez, e não por linha: são centenas de projetos na tela, e
   * uma consulta por cartão seria uma enxurrada para responder algo que
   * cabe em dois conjuntos.
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

  /** Só a fila: o resto da carteira tem tela própria. */
  const naFila = useMemo(
    () => (q.data?.demandas ?? []).filter((d) => d.status === "backlog"),
    [q.data],
  );

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["resumo-portfolio"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const promover = useMutation({
    mutationFn: (id: string) => promoverDemandaFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto priorizado", {
        description: "Ele saiu da fila e agora aparece em Projetos em andamento.",
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

  const gerentes = useMemo(() => pessoasDe(naFila, "gerenteId", "gerenteNome"), [naFila]);
  const patrocinadores = useMemo(() => pessoasDe(naFila, "sponsorId", "sponsorNome"), [naFila]);

  const temFiltro = busca.trim() !== "" || filtroGerente !== TODOS || filtroSponsor !== TODOS;

  function limparFiltros() {
    setBusca("");
    setFiltroGerente(TODOS);
    setFiltroSponsor(TODOS);
  }

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
   * onde valor e esforço posicionam cada projeto.
   *
   * `localeCompare` com sensibilidade de base resolve acento e caixa:
   * "Órion" e "orion" caem lado a lado, e não em pontas opostas.
   */
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return naFila
      .filter((d) => {
        if (filtroGerente !== TODOS && d.gerenteId !== filtroGerente) return false;
        if (filtroSponsor !== TODOS && d.sponsorId !== filtroSponsor) return false;
        if (!t) return true;
        return `${d.nome} ${d.objetivo ?? ""} ${d.areaDemandante ?? ""} ${d.justificativa ?? ""}`
          .toLowerCase()
          .includes(t);
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  }, [naFila, busca, filtroGerente, filtroSponsor]);

  const pagina = usePaginacao(filtrados, `fila|${busca}|${filtroGerente}|${filtroSponsor}`);

  return (
    <AppShell
      title="Backlog de projetos"
      subtitle="O que foi pedido e ainda não foi decidido. Priorizar aqui move o projeto para a carteira."
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar o backlog: {String(q.error)}
          </div>
        ) : null}

        {/* Sem faixa de indicadores: a tela tem um assunto só, e o
            número que importa — quantos aguardam decisão — já está no
            menu lateral e na paginação. Um card repetindo isso ocuparia
            o espaço mais nobre para dizer o que a lista já diz. */}

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
            Filtro ativo: {filtrados.length} de {naFila.length} na fila.
            <button type="button" onClick={limparFiltros} className="text-primary hover:underline">
              Limpar filtros
            </button>
          </p>
        ) : null}

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando backlog...
          </p>
        ) : filtrados.length === 0 ? (
          <div className="panel px-5 py-12 text-center">
            <p className="text-sm font-medium">
              {temFiltro ? "Nenhum projeto na fila com esses filtros." : "Nada aguardando decisão."}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {temFiltro
                ? "Tente outro nome, gerente ou patrocinador."
                : "Registre aqui o que foi pedido mas ainda não foi decidido. Projeto na fila não cobra acompanhamento semanal nem ocupa a capacidade da equipe — e entra na carteira no dia em que for priorizado."}
            </p>
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <Paginacao {...pagina.controles} rotulo="na fila" posicao="topo" />
            <ol className="divide-y divide-border">
              {pagina.visiveis.map((d, i) => (
                <LinhaBacklog
                  key={d.id}
                  posicao={pagina.controles.primeiro + i}
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
            <Paginacao {...pagina.controles} rotulo="na fila" />
          </div>
        )}
      </div>

      {/* Fora da lista: é a linha que o abre, e mantê-lo aqui evita
          remontá-lo a cada troca de página. */}
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
              title="Mover para Projetos em andamento e começar o cronograma"
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
