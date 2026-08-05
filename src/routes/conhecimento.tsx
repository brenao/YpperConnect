import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, Eye, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import { useItsm } from "@/controllers/itsm-store";
import { generateKnowledgeArticle } from "@/services/ai-knowledge.functions";
import type { Article } from "@/models/itsm-types";
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

const statusStyle: Record<Article["status"], string> = {
  publicado: "bg-success/12 text-success border-success/30",
  revisar: "bg-warning/12 text-warning border-warning/30",
  rascunho: "bg-muted text-muted-foreground border-border",
};

function Conhecimento() {
  const { articles, addArticle, tickets } = useItsm();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [tema, setTema] = useState("");
  const [gerando, setGerando] = useState(false);

  const filtered = articles.filter((a) =>
    `${a.titulo} ${a.categoria} ${a.resumo}`.toLowerCase().includes(q.toLowerCase()),
  );

  async function gerarComIA() {
    if (tema.trim().length < 5) {
      toast.error("Descreva o tema do artigo.");
      return;
    }
    setGerando(true);
    try {
      const contexto = tickets
        .filter((t) => t.tipo === "incidente")
        .slice(0, 12)
        .map((t) => `- ${t.titulo} (${t.sistema ?? t.servico})`)
        .join("\n");
      const artigo = await generateKnowledgeArticle({
        data: { tema: tema.trim(), contexto },
      });
      addArticle({
        ...artigo,
        atualizadoEm: new Date().toISOString().slice(0, 10),
        status: "rascunho",
        geradoPorIA: true,
      });
      setOpen(false);
      setTema("");
      toast.success("Rascunho criado pela IA", {
        description: "Disponível para curadoria da equipe de TI.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o artigo.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <AppShell
      title="Base de conhecimento"
      subtitle="Procedimentos, orientações e soluções recorrentes em formato padronizado e de fácil consulta"
    >
      <div className="space-y-5">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              maxLength={80}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar artigo, categoria ou procedimento"
              className="pl-9"
            />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="gap-2">
                <Sparkles className="size-4" /> Gerar rascunho com IA
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gerar artigo com IA</DialogTitle>
                <DialogDescription>
                  A IA padroniza o procedimento em sintoma, causa, solução e escalonamento, usando
                  também os incidentes registrados como contexto.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={tema}
                maxLength={300}
                rows={4}
                onChange={(e) => setTema(e.target.value)}
                placeholder="Ex.: procedimento para falha de autenticação MFA na VPN"
              />
              <DialogFooter>
                <Button onClick={gerarComIA} disabled={gerando} className="gap-2">
                  {gerando ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Gerar rascunho
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="panel p-2">
            <Accordion type="single" collapsible>
              {filtered.map((a) => (
                <AccordionItem key={a.id} value={a.id} className="border-border px-3">
                  <AccordionTrigger className="text-left">
                    <span className="flex min-w-0 flex-1 flex-col gap-1 pr-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{a.id}</span>
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[11px]",
                            statusStyle[a.status],
                          )}
                        >
                          {a.status}
                        </span>
                        {a.geradoPorIA ? <Sparkles className="size-3.5 text-primary" /> : null}
                      </span>
                      <span className="truncate text-sm font-medium">{a.titulo}</span>
                      <span className="truncate text-xs text-muted-foreground">{a.resumo}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      {a.conteudo}
                    </p>
                    <p className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{a.categoria}</span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="size-3.5" /> {a.visualizacoes}
                      </span>
                      <span>Atualizado em {a.atualizadoEm}</span>
                    </p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <aside className="panel h-fit p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4 text-primary" /> Curadoria assistida
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="rounded-lg border border-border bg-surface p-3">
                A IA transforma procedimentos existentes em conteúdos padronizados.
              </li>
              <li className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-foreground">
                {articles.filter((a) => a.status === "revisar").length} artigo(s) sinalizado(s) como
                desatualizado(s) pela análise de recorrências.
              </li>
              <li className="rounded-lg border border-border bg-surface p-3">
                Soluções sugeridas para ocorrências recorrentes viram rascunhos para aprovação da
                equipe de TI.
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
