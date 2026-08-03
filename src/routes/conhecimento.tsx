import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, Eye, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/itsm/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useItsm } from "@/lib/itsm-store";
import type { Article } from "@/lib/itsm-types";
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
  const { articles, addArticle } = useItsm();
  const [q, setQ] = useState("");

  const filtered = articles.filter((a) =>
    `${a.titulo} ${a.categoria} ${a.resumo}`.toLowerCase().includes(q.toLowerCase()),
  );

  function gerarComIA() {
    addArticle({
      titulo: "Erros recorrentes de conexão VPN: solução padronizada",
      categoria: "Infraestrutura",
      resumo:
        "Rascunho gerado por IA a partir do histórico de incidentes correlatos dos últimos 30 dias.",
      conteudo:
        "Sintoma: falha de autenticação MFA após atualização do cliente.\nSolução: reinstalar o cliente homologado, sincronizar horário do dispositivo e revalidar o token. Escalar para Infraestrutura caso o erro persista após duas tentativas.",
      atualizadoEm: new Date().toISOString().slice(0, 10),
      status: "rascunho",
      geradoPorIA: true,
    });
    toast.success("Rascunho criado pela IA", {
      description: "Disponível para curadoria da equipe de TI.",
    });
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
          <Button variant="secondary" className="gap-2" onClick={gerarComIA}>
            <Sparkles className="size-4" /> Gerar rascunho com IA
          </Button>
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
                {articles.filter((a) => a.status === "revisar").length} artigo(s) sinalizado(s)
                como desatualizado(s) pela análise de recorrências.
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