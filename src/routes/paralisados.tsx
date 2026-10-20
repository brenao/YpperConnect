import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Inbox, Loader2, Lock, PlayCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { DialogoSolicitarAcesso } from "@/views/dialogo-solicitar-acesso";
import { Paginacao, usePaginacao } from "@/views/paginacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjetoBacklog } from "@/repositories/backlog.repo";
import { listarBacklogFn, devolverAoBacklogFn } from "@/services/backlog.functions";
import { definirStatusProjetoFn } from "@/services/projetos.functions";
import { idsComAcessoFn, listarMinhasSolicitacoesFn } from "@/services/acesso-projeto.functions";
import { fmt } from "@/lib/datas";
import { cn } from "@/lib/utils";

/**
 * Projetos paralisados.
 *
 * Ganharam tela própria porque estavam no pior lugar possível: no meio
 * da lista de projetos em andamento, onde somavam ao total de quem
 * pergunta "o que está acontecendo" sem na verdade estar acontecendo
 * nada. O gerente lia a lista inteira toda semana e passava por eles
 * sem agir, porque não havia o que fazer ali — e era justamente aí que
 * estava a decisão pendente.
 *
 * Esta tela faz uma pergunta só: cada um destes volta, ou vai para o
 * backlog? Por isso as duas ações ficam na linha, e por isso o número
 * que mais pesa é há quanto tempo o projeto está parado.
 */
export const Route = createFileRoute("/paralisados")({
  head: () => ({
    meta: [
      { title: "Projetos paralisados · BeagleOne" },
      {
        name: "description",
        content: "Projetos que começaram e pararam, com o tempo parado e a decisão pendente.",
      },
    ],
  }),
  component: Paralisados,
});

/** Três estados, como no backlog: sem acesso, pedido em análise, liberado. */
type EstadoAcesso = "liberado" | "pendente" | "bloqueado";

/**
 * Há quanto tempo o projeto não recebe nada.
 *
 * `atualizadoEm` serve de relógio porque toda mutação de cronograma
 * passa por `recalcularPeriodo`, que o atualiza. Um projeto parado há
 * três meses e um parado há três dias pedem conversas diferentes, e
 * essa é a única informação que esta tela tem de dar em destaque.
 */
function diasParado(d: ProjetoBacklog): number {
  const ms = Date.now() - new Date(d.atualizadoEm).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function Paralisados() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");

  const q = useQuery({
    queryKey: ["backlog"],
    queryFn: () => listarBacklogFn(),
  });
  const acessos = useQuery({
    queryKey: ["ids-com-acesso"],
    queryFn: () => idsComAcessoFn(),
  });
  const minhas = useQuery({
    queryKey: ["minhas-solicitacoes"],
    queryFn: () => listarMinhasSolicitacoesFn(),
  });

  const comAcesso = useMemo(() => new Set(acessos.data ?? []), [acessos.data]);
  const pendentes = useMemo(
    () =>
      new Set((minhas.data ?? []).filter((s) => s.situacao === "pendente").map((s) => s.projetoId)),
    [minhas.data],
  );
  const estadoDe = (id: string): EstadoAcesso =>
    comAcesso.has(id) ? "liberado" : pendentes.has(id) ? "pendente" : "bloqueado";

  const podeGerir = q.data?.podeGerir ?? false;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["resumo-portfolio"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const retomar = useMutation({
    mutationFn: (id: string) => definirStatusProjetoFn({ data: { id, status: "execucao" } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto retomado", {
        description: "Ele volta para a lista de projetos em andamento.",
      });
    },
    onError: erro,
  });

  const devolver = useMutation({
    mutationFn: (id: string) => devolverAoBacklogFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Projeto devolvido ao backlog", {
        description: "O cronograma fica guardado e volta se ele for priorizado de novo.",
      });
    },
    onError: erro,
  });

  /**
   * Só os paralisados, ordenados pelo tempo parado.
   *
   * O mais antigo primeiro, e não o alfabético: aqui a ordem é a da
   * urgência da decisão. Um projeto parado há seis meses no fim de uma
   * lista alfabética é um projeto que ninguém vai decidir.
   */
  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (q.data?.demandas ?? [])
      .filter((d) => d.status === "paralisado")
      .filter((d) =>
        t === ""
          ? true
          : `${d.nome} ${d.areaDemandante ?? ""} ${d.gerenteNome ?? ""}`.toLowerCase().includes(t),
      )
      .sort((a, b) => diasParado(b) - diasParado(a));
  }, [q.data, busca]);

  const pagina = usePaginacao(itens, `paralisados|${busca}`);

  return (
    <AppShell
      title="Projetos paralisados"
      subtitle="Começaram e pararam. Cada um aqui espera uma decisão: retomar ou devolver à fila."
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar: {String(q.error)}
          </div>
        ) : null}

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, área ou gerente..."
            className="pl-8"
          />
        </div>

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </p>
        ) : itens.length === 0 ? (
          /* O vazio aqui é boa notícia, e o texto diz isso. "Nenhum
             resultado" seria a leitura de uma busca frustrada. */
          <div className="panel px-5 py-12 text-center">
            <p className="text-sm font-medium">
              {busca ? "Nenhum paralisado com esse termo." : "Nenhum projeto paralisado."}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {busca
                ? "Tente outro nome, área ou gerente."
                : "Tudo o que foi priorizado está em movimento — ou na fila, esperando decisão."}
            </p>
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <Paginacao {...pagina.controles} rotulo="paralisados" posicao="topo" />
            <ul className="divide-y divide-border">
              {pagina.visiveis.map((d) => (
                <LinhaParalisado
                  key={d.id}
                  item={d}
                  acesso={estadoDe(d.id)}
                  podeGerir={podeGerir}
                  ocupado={retomar.isPending || devolver.isPending}
                  onRetomar={() => retomar.mutate(d.id)}
                  onDevolver={() => devolver.mutate(d.id)}
                />
              ))}
            </ul>
            <Paginacao {...pagina.controles} rotulo="paralisados" />
          </div>
        )}
      </div>
    </AppShell>
  );
}

function LinhaParalisado({
  item: d,
  acesso,
  podeGerir,
  ocupado,
  onRetomar,
  onDevolver,
}: {
  item: ProjetoBacklog;
  acesso: EstadoAcesso;
  podeGerir: boolean;
  ocupado: boolean;
  onRetomar: () => void;
  onDevolver: () => void;
}) {
  const liberado = acesso === "liberado";
  const dias = diasParado(d);

  /**
   * Três faixas de tempo, três leituras.
   *
   * Até um mês ainda é uma pausa; até três, começa a ser esquecimento;
   * acima disso, o projeto provavelmente não volta e ninguém assumiu
   * isso por escrito. A cor existe para que a lista ordenada por tempo
   * seja lida de relance, sem comparar números.
   */
  const faixa = dias >= 90 ? "text-destructive" : dias >= 30 ? "text-warning" : "text-foreground";

  return (
    <li className="flex items-start gap-4 p-4">
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

        {liberado ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/* O tempo parado vem primeiro e em destaque: é o número
                que decide se esta linha pede conversa hoje. */}
            <span className={cn("font-mono text-sm font-semibold", faixa)}>
              {dias} d parado{dias === 1 ? "" : "s"}
            </span>

            {/* O progresso congelado diz quanto se perde ao devolver ao
                backlog — 5% é recomeço, 70% é trabalho jogado fora. */}
            <span className="flex items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px]">
                {d.progresso}%
              </Badge>
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                <span
                  className="block h-full rounded-full bg-primary/70"
                  style={{ width: `${d.progresso}%` }}
                />
              </span>
            </span>

            <span className="text-[11px] text-muted-foreground">
              último movimento em {fmt(d.atualizadoEm)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {!liberado ? (
          acesso === "pendente" ? (
            <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
              Acesso em análise
            </Badge>
          ) : (
            <DialogoSolicitarAcesso
              projetoId={d.id}
              projetoNome={d.nome}
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Lock className="size-3.5" /> Solicitar acesso
                </Button>
              }
            />
          )
        ) : (
          <>
            <Link
              to="/projetos/$projectId"
              params={{ projectId: d.id }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:underline"
            >
              Cronograma <ArrowUpRight className="size-3.5" />
            </Link>

            {/* As duas saídas, lado a lado e com peso igual: a tela
                existe para que uma delas seja escolhida. Devolver ao
                backlog fica em variante neutra porque é a que desfaz
                uma priorização, não porque seja menos legítima. */}
            {podeGerir ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={ocupado}
                  title="Devolver à fila de priorização. O cronograma fica guardado."
                  onClick={onDevolver}
                >
                  <Inbox className="size-3.5" /> Ao backlog
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={ocupado}
                  title="Voltar para os projetos em andamento"
                  onClick={onRetomar}
                >
                  <PlayCircle className="size-3.5" /> Retomar
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
