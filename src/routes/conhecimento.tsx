import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/views/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateKnowledgeArticle } from "@/services/ai-knowledge.functions";
import type { Artigo, StatusArtigo } from "@/repositories/artigos.repo";
import {
  listarArtigosFn,
  criarArtigoFn,
  atualizarArtigoFn,
  registrarVisualizacaoFn,
  type ArtigoInput,
  type ArtigoUpdateInput,
} from "@/services/conhecimento.functions";
import { listarCategoriasFn, usuarioAtualFn } from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/conhecimento")({
  head: () => ({
    meta: [
      { title: "Base de conhecimento · YpperConnect" },
      {
        name: "description",
        content:
          "Procedimentos, orientações e soluções recorrentes de TI padronizados, com curadoria apoiada por IA generativa.",
      },
      { property: "og:title", content: "Base de conhecimento · YpperConnect" },
      {
        property: "og:description",
        content: "Procedimentos e soluções recorrentes de TI em formato padronizado.",
      },
    ],
  }),
  component: Conhecimento,
});

const statusStyle: Record<StatusArtigo, string> = {
  publicado: "bg-success/12 text-success border-success/30",
  revisar: "bg-warning/12 text-warning border-warning/30",
  rascunho: "bg-muted text-muted-foreground border-border",
};

const statusLabel: Record<StatusArtigo, string> = {
  publicado: "Publicado",
  revisar: "Revisar",
  rascunho: "Rascunho",
};

/** Radix não aceita SelectItem com value vazio. */
const SEM_CATEGORIA = "__nenhum__";

function Conhecimento() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [tema, setTema] = useState("");
  const [gerando, setGerando] = useState(false);
  /** Evita contar visualização mais de uma vez por sessão. */
  const [vistos, setVistos] = useState<Set<string>>(new Set());

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const artigosQuery = useQuery({ queryKey: ["artigos"], queryFn: () => listarArtigosFn() });
  const categorias = useQuery({
    queryKey: ["categorias", "artigo"],
    queryFn: () => listarCategoriasFn({ data: { escopo: "artigo" } }),
  });

  const gerarArtigo = useServerFn(generateKnowledgeArticle);
  const isTi = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;
  const artigos: Artigo[] = useMemo(() => artigosQuery.data ?? [], [artigosQuery.data]);

  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: ArtigoInput) => criarArtigoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artigos"] }),
    onError: erro,
  });

  const atualizar = useMutation({
    mutationFn: (v: ArtigoUpdateInput) => atualizarArtigoFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artigos"] });
      toast.success("Artigo atualizado");
    },
    onError: erro,
  });

  const contar = useMutation({
    mutationFn: (id: string) => registrarVisualizacaoFn({ data: { id } }),
  });

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return artigos;
    return artigos.filter((a) =>
      `${a.titulo} ${a.resumo ?? ""} ${a.conteudo} ${a.categoriaNome ?? ""}`
        .toLowerCase()
        .includes(t),
    );
  }, [artigos, q]);

  async function gerar() {
    if (tema.trim().length < 5) {
      toast.error("Descreva o tema do artigo.");
      return;
    }
    setGerando(true);
    try {
      const r = await gerarArtigo({ data: { tema: tema.trim() } });

      // Casa a categoria sugerida pela IA com o cadastro; se não achar,
      // fica sem categoria para o revisor definir.
      const norm = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const cat = categorias.data?.find((c) => norm(c.nome) === norm(r.categoria));

      await criar.mutateAsync({
        titulo: r.titulo,
        resumo: r.resumo,
        conteudo: r.conteudo,
        categoriaId: cat?.id ?? null,
        geradoPorIa: true,
      });

      setOpen(false);
      setTema("");
      toast.success("Artigo gerado", {
        description: "Entrou como 'Revisar' — leia antes de publicar.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o artigo.");
    } finally {
      setGerando(false);
    }
  }

  function aoAbrir(id: string) {
    if (vistos.has(id)) return;
    setVistos((s) => new Set(s).add(id));
    contar.mutate(id);
  }

  const publicados = artigos.filter((a) => a.status === "publicado").length;
  const pendentes = artigos.length - publicados;

  return (
    <AppShell
      title="Base de conhecimento"
      subtitle="Procedimentos, orientações e soluções recorrentes em formato padronizado"
    >
      <div className="space-y-4">
        {artigosQuery.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os artigos: {String(artigosQuery.error)}
          </div>
        ) : null}

        {/* Ação de coleção fica junto da coleção. O cabeçalho é reservado
            à identidade e ao "Abrir chamado", que é global de toda tela. */}
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={q}
              maxLength={120}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por título, conteúdo ou categoria"
              className="pl-8"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {publicados} publicado(s) · {pendentes} pendente(s)
          </span>
          {isTi ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Sparkles className="size-4" /> Gerar com IA
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Gerar artigo com IA</DialogTitle>
                  <DialogDescription>
                    Descreva o tema. O artigo é criado com sintoma, causa provável, solução passo a
                    passo e critério de escalonamento — e entra como &ldquo;Revisar&rdquo;.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={3}
                  maxLength={300}
                  value={tema}
                  onChange={(e) => setTema(e.target.value)}
                  placeholder="Ex.: como proceder quando a VPN cai repetidamente"
                />
                <DialogFooter>
                  <Button onClick={() => void gerar()} disabled={gerando} className="gap-2">
                    {gerando ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    Gerar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        {artigosQuery.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando artigos...
          </p>
        ) : filtrados.length === 0 ? (
          <div className="panel p-8 text-center">
            <BookOpen className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {artigos.length === 0 ? "Base vazia" : "Nenhum artigo encontrado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {artigos.length === 0
                ? "Artigos reduzem chamados repetidos: o solicitante resolve sozinho antes de abrir."
                : "Tente outros termos de busca."}
            </p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="space-y-3">
            {filtrados.map((a) => (
              <AccordionItem
                key={a.id}
                value={a.id}
                className="panel border px-5 data-[state=open]:border-primary/30"
              >
                <AccordionTrigger onClick={() => aoAbrir(a.id)} className="hover:no-underline">
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pr-3 text-left">
                    <span className="text-sm font-medium">{a.titulo}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[11px]",
                          statusStyle[a.status],
                        )}
                      >
                        {statusLabel[a.status]}
                      </span>
                      {a.categoriaNome ? <span>{a.categoriaNome}</span> : null}
                      {a.geradoPorIa ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Sparkles className="size-3" /> IA
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <Eye className="size-3" /> {a.visualizacoes}
                      </span>
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pb-5">
                  {a.resumo ? <p className="text-sm text-muted-foreground">{a.resumo}</p> : null}
                  <p className="whitespace-pre-line rounded-lg border border-border bg-surface p-4 text-sm">
                    {a.conteudo}
                  </p>

                  {isTi ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Situação</span>
                        <Select
                          value={a.status}
                          disabled={atualizar.isPending}
                          onValueChange={(v) =>
                            atualizar.mutate({ id: a.id, status: v as StatusArtigo })
                          }
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(statusLabel) as StatusArtigo[]).map((s) => (
                              <SelectItem key={s} value={s}>
                                {statusLabel[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Categoria</span>
                        <Select
                          value={a.categoriaId ?? SEM_CATEGORIA}
                          disabled={atualizar.isPending}
                          onValueChange={(v) =>
                            atualizar.mutate({
                              id: a.id,
                              categoriaId: v === SEM_CATEGORIA ? null : v,
                            })
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Sem categoria" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SEM_CATEGORIA}>Sem categoria</SelectItem>
                            {(categorias.data ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <span className="ml-auto text-xs text-muted-foreground">
                        {a.autorNome ? `por ${a.autorNome}` : ""}
                      </span>
                    </div>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </AppShell>
  );
}
