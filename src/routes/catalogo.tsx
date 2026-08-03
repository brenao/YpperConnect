import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Clock, Users } from "lucide-react";
import { AppShell } from "@/components/itsm/app-shell";
import { TypeBadge } from "@/components/itsm/badges";
import { useItsm } from "@/lib/itsm-store";

export const Route = createFileRoute("/catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de serviços de TI · GovTI" },
      {
        name: "description",
        content:
          "Catálogo inicial de serviços de TI com categoria, classificação padrão, SLA e equipe responsável por cada serviço.",
      },
      { property: "og:title", content: "Catálogo de serviços de TI · GovTI" },
      {
        property: "og:description",
        content: "Serviços padronizados de TI com SLA e responsabilidades definidas.",
      },
    ],
  }),
  component: Catalogo,
});

function Catalogo() {
  const { services } = useItsm();
  const categorias = [...new Set(services.map((s) => s.categoria))];

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
                      {s.geradoPorIA ? (
                        <Sparkles className="size-4 shrink-0 text-primary" />
                      ) : null}
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