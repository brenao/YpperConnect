import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Clock, Loader2, Users, Plus, Pencil, EyeOff, Eye } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/views/app-shell";
import { TypeBadge } from "@/views/badges";
import { ServiceDialog } from "@/views/catalog-forms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { suggestCatalogServices } from "@/services/ai-catalog.functions";
import type { Servico } from "@/repositories/catalogo.repo";
import {
  listarServicosAdminFn,
  listarCategoriasFn,
  listarEquipesFn,
  criarServicoFn,
  definirServicoAtivoFn,
  type ServicoInput,
  type AtivoInput,
} from "@/services/cadastros.functions";
import { usuarioAtualFn } from "@/services/cadastros.functions";

export const Route = createFileRoute("/catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de serviços de TI · Beagle One" },
      {
        name: "description",
        content:
          "Catálogo de serviços de TI com categoria, classificação padrão, SLA e equipe responsável por cada serviço.",
      },
      { property: "og:title", content: "Catálogo de serviços de TI · Beagle One" },
      {
        property: "og:description",
        content: "Serviços padronizados de TI com SLA e responsabilidades definidas.",
      },
    ],
  }),
  component: Catalogo,
});

/**
 * Casa nome livre devolvido pela IA com um registro do banco.
 * Ignora caixa e acento; devolve null se não achar, e o admin ajusta.
 */
function casarPorNome<T extends { id: string; nome: string }>(
  lista: T[] | undefined,
  nome: string | undefined,
): string | null {
  if (!lista?.length || !nome?.trim()) return null;
  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const alvo = normalizar(nome);
  return lista.find((x) => normalizar(x.nome) === alvo)?.id ?? null;
}

function Catalogo() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [contexto, setContexto] = useState("");
  const [gerando, setGerando] = useState(false);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const servicosQuery = useQuery({
    queryKey: ["servicos-admin"],
    queryFn: () => listarServicosAdminFn(),
  });
  const categorias = useQuery({
    queryKey: ["categorias", "servico"],
    queryFn: () => listarCategoriasFn({ data: { escopo: "servico" } }),
  });
  const equipes = useQuery({ queryKey: ["equipes"], queryFn: () => listarEquipesFn() });

  const sugerirServicos = useServerFn(suggestCatalogServices);

  const isAdmin = usuario.data?.admin ?? false;
  const isTi = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;

  const todos: Servico[] = useMemo(() => servicosQuery.data ?? [], [servicosQuery.data]);
  const visiveis = useMemo(
    () => (mostrarInativos ? todos : todos.filter((s) => s.ativo)),
    [todos, mostrarInativos],
  );

  /** Agrupa por categoria; serviços sem categoria caem num grupo próprio. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Servico[]>();
    visiveis.forEach((s) => {
      const chave = s.categoriaNome ?? "Sem categoria";
      mapa.set(chave, [...(mapa.get(chave) ?? []), s]);
    });
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visiveis]);

  const criar = useMutation({
    mutationFn: (v: ServicoInput) => criarServicoFn({ data: v }),
    onError: (e: Error) => toast.error("Falha ao criar serviço", { description: e.message }),
  });

  const alternarAtivo = useMutation({
    mutationFn: (v: AtivoInput) => definirServicoAtivoFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["servicos-admin"] });
      qc.invalidateQueries({ queryKey: ["servicos"] });
      toast.success(v.ativo ? "Serviço reativado" : "Serviço desativado", {
        description: v.ativo
          ? undefined
          : "Ele some dos formulários, mas continua legível nos chamados antigos.",
      });
    },
    onError: (e: Error) => toast.error("Falha ao alterar", { description: e.message }),
  });

  async function gerar() {
    if (contexto.trim().length < 10) {
      toast.error("Descreva os serviços prestados pela área.");
      return;
    }
    setGerando(true);
    try {
      const { servicos } = await sugerirServicos({
        data: { contexto: contexto.trim(), existentes: todos.map((s) => s.nome) },
      });

      // A IA devolve categoria e equipe como texto. O que casar com o
      // cadastro vira FK; o resto fica nulo para o admin completar.
      for (const s of servicos) {
        await criar.mutateAsync({
          nome: s.nome,
          descricao: s.descricao,
          tipoPadrao: s.tipoPadrao,
          slaHoras: s.slaHoras,
          categoriaId: casarPorNome(categorias.data, s.categoria),
          equipeId: casarPorNome(equipes.data, s.equipe),
        });
      }

      qc.invalidateQueries({ queryKey: ["servicos-admin"] });
      qc.invalidateQueries({ queryKey: ["servicos"] });
      setOpen(false);
      setContexto("");
      toast.success(`${servicos.length} serviço(s) criado(s) pela IA`, {
        description: "Revise categoria e equipe: o que a IA não reconheceu ficou em branco.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sugerir serviços.");
    } finally {
      setGerando(false);
    }
  }

  const carregando = servicosQuery.isPending || usuario.isPending;

  return (
    <AppShell
      title="Catálogo de serviços de TI"
      subtitle="Serviços padronizados com SLA, classificação e equipe responsável — é o catálogo que roteia os chamados"
    >
      <div className="space-y-6">
        {servicosQuery.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar o catálogo: {String(servicosQuery.error)}
          </div>
        ) : null}

        <div className="panel flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="text-muted-foreground">
            {todos.filter((s) => s.ativo).length} ativos · {grupos.length} categorias
          </span>
          {todos.some((s) => s.geradoPorIa) ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
              <Sparkles className="size-3.5" />
              {todos.filter((s) => s.geradoPorIa).length} gerados por IA
            </span>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setMostrarInativos((v) => !v)}
          >
            {mostrarInativos ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {mostrarInativos ? "Ocultar inativos" : "Mostrar inativos"}
          </Button>

          {isAdmin ? (
            <ServiceDialog
              trigger={
                <Button size="sm" className="ml-auto gap-2">
                  <Plus className="size-4" /> Novo serviço
                </Button>
              }
            />
          ) : null}

          {isTi ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className={isAdmin ? "gap-2" : "ml-auto gap-2"}
                >
                  <Sparkles className="size-4" /> Sugerir com IA
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ampliar catálogo com IA</DialogTitle>
                  <DialogDescription>
                    Descreva os serviços prestados hoje pela área de TI. A IA propõe itens com
                    categoria, classificação padrão, SLA e equipe.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={5}
                  maxLength={3000}
                  value={contexto}
                  onChange={(e) => setContexto(e.target.value)}
                  placeholder="Ex.: suporte a estações Windows, acessos ao ERP, telefonia, backup, redes das lojas..."
                />
                <DialogFooter>
                  <Button onClick={() => void gerar()} disabled={gerando} className="gap-2">
                    {gerando ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    Gerar e cadastrar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        {carregando ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando catálogo...
          </p>
        ) : null}

        {!carregando && visiveis.length === 0 ? (
          <p className="panel px-5 py-10 text-center text-sm text-muted-foreground">
            Nenhum serviço cadastrado. Sem catálogo, os chamados não têm roteamento automático para
            as equipes.
          </p>
        ) : null}

        {grupos.map(([cat, lista]) => (
          <section key={cat}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {cat}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {lista.map((s) => (
                <article
                  key={s.id}
                  className={`panel flex flex-col gap-3 p-5 ${s.ativo ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold">{s.nome}</h3>
                    <div className="flex shrink-0 items-center gap-1">
                      {s.geradoPorIa ? <Sparkles className="size-4 text-primary" /> : null}
                      {isAdmin ? (
                        <>
                          <ServiceDialog
                            service={s}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                title="Editar serviço"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title={s.ativo ? "Desativar serviço" : "Reativar serviço"}
                            disabled={alternarAtivo.isPending}
                            onClick={() => alternarAtivo.mutate({ id: s.id, ativo: !s.ativo })}
                          >
                            {s.ativo ? (
                              <EyeOff className="size-3.5 text-muted-foreground" />
                            ) : (
                              <Eye className="size-3.5 text-success" />
                            )}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {!s.ativo ? (
                    <Badge variant="outline" className="w-fit text-xs">
                      Inativo
                    </Badge>
                  ) : null}

                  <p className="flex-1 text-sm text-muted-foreground">{s.descricao ?? "—"}</p>
                  <TypeBadge value={s.tipoPadrao} />

                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5" /> SLA {s.slaHoras}h úteis
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {s.equipeNome ?? "Sem equipe"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
