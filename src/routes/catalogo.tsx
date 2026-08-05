import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Clock, Loader2, Users, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/itsm/app-shell";
import { TypeBadge } from "@/components/itsm/badges";
import { ServiceDialog } from "@/components/itsm/catalog-forms";
import { Button } from "@/components/ui/button";
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
import { suggestCatalogServices } from "@/lib/ai-catalog.functions";
import { useItsm } from "@/lib/itsm-store";

export const Route = createFileRoute("/catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de serviços de TI · YpperConnect" },
      {
        name: "description",
        content:
          "Catálogo inicial de serviços de TI com categoria, classificação padrão, SLA e equipe responsável por cada serviço.",
      },
      { property: "og:title", content: "Catálogo de serviços de TI · YpperConnect" },
      {
        property: "og:description",
        content: "Serviços padronizados de TI com SLA e responsabilidades definidas.",
      },
    ],
  }),
  component: Catalogo,
});

function Catalogo() {
  const { services, addService, removeService, role, isAdmin } = useItsm();
  const categorias = [...new Set(services.map((s) => s.categoria))];
  const [open, setOpen] = useState(false);
  const [contexto, setContexto] = useState("");
  const [gerando, setGerando] = useState(false);

  async function gerar() {
    if (contexto.trim().length < 10) {
      toast.error("Descreva os serviços prestados pela área.");
      return;
    }
    setGerando(true);
    try {
      const { servicos } = await suggestCatalogServices({
        data: { contexto: contexto.trim(), existentes: services.map((s) => s.nome) },
      });
      servicos.forEach((s) => addService({ ...s, geradoPorIA: true }));
      setOpen(false);
      setContexto("");
      toast.success(`${servicos.length} serviço(s) sugerido(s) pela IA`, {
        description: "Revise e ajuste antes de publicar para os usuários.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sugerir serviços.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <AppShell
      title="Catálogo de serviços de TI"
      subtitle="Primeira versão estruturada com apoio de IA generativa a partir dos serviços prestados pela área"
    >
      <div className="space-y-6">
        <div className="panel flex flex-wrap items-center gap-4 p-4 text-sm">
          <span className="text-muted-foreground">
            {services.length} serviços · {categorias.length} categorias
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
            <Sparkles className="size-3.5" />
            {services.filter((s) => s.geradoPorIA).length} rascunhos gerados por IA em curadoria
          </span>
          {isAdmin ? (
            <ServiceDialog
              trigger={
                <Button size="sm" className="ml-auto gap-2">
                  <Plus className="size-4" /> Novo serviço
                </Button>
              }
            />
          ) : null}
          {role === "ti" ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm" className={isAdmin ? "gap-2" : "ml-auto gap-2"}>
                  <Sparkles className="size-4" /> Sugerir serviços com IA
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ampliar catálogo com IA</DialogTitle>
                  <DialogDescription>
                    Descreva os serviços prestados hoje pela área de TI. A IA propõe itens de
                    catálogo com categoria, classificação padrão, SLA e equipe.
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
                  <Button onClick={gerar} disabled={gerando} className="gap-2">
                    {gerando ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Gerar sugestões
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        {categorias.map((cat) => (
          <section key={cat}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {cat}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {services
                .filter((s) => s.categoria === cat)
                .map((s) => (
                  <article key={s.id} className="panel flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold">{s.nome}</h3>
                      <div className="flex shrink-0 items-center gap-1">
                        {s.geradoPorIA ? <Sparkles className="size-4 text-primary" /> : null}
                        {isAdmin ? (
                          <>
                            <ServiceDialog
                              service={s}
                              trigger={
                                <Button variant="ghost" size="icon" className="size-7" title="Editar serviço">
                                  <Pencil className="size-3.5" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive"
                              title="Excluir serviço"
                              onClick={() => {
                                removeService(s.id);
                                toast.success("Serviço removido do catálogo");
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <p className="flex-1 text-sm text-muted-foreground">{s.descricao}</p>
                    <TypeBadge value={s.tipoPadrao} />
                    <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3.5" /> SLA {s.slaHoras}h
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3.5" /> {s.equipe}
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