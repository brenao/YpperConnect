import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Loader2 } from "lucide-react";
import { AppShell } from "@/views/app-shell";
import { Badge } from "@/components/ui/badge";
import { sessaoFn } from "@/services/sessao.functions";
import type { SituacaoPlano } from "@/models/plano";

export const Route = createFileRoute("/assinatura")({
  head: () => ({ meta: [{ title: "Assinatura · BeagleOne" }] }),
  component: Assinatura,
});

const NOME_PLANO: Record<string, string> = {
  itsm_essencial: "ITSM Essencial",
  itsm_pro: "ITSM Pro",
  projetos_essencial: "Projetos Essencial",
  projetos_pro: "Projetos Pro",
  suite_essencial: "Suíte Essencial",
  suite_pro: "Suíte Pro",
};

const STATUS: Record<string, string> = {
  teste: "Teste grátis",
  ativa: "Ativa",
  inadimplente: "Pagamento pendente",
  somente_leitura: "Somente leitura",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
  sem_assinatura: "Sem assinatura",
};

function mensagem(p: SituacaoPlano): string {
  if (p.status === "teste" && p.acesso === "bloqueado") {
    return "O período de teste terminou. Contrate um plano para continuar usando o BeagleOne.";
  }
  if (p.acesso === "bloqueado") {
    return "O acesso está suspenso. Regularize a assinatura para voltar a usar o sistema. Nenhum dado foi perdido.";
  }
  if (p.acesso === "somente_leitura") {
    return "Há um pagamento em atraso: o sistema está em modo somente leitura até a regularização.";
  }
  if (p.acesso === "total_com_aviso") {
    return "Há um pagamento pendente. Regularize para evitar o modo somente leitura.";
  }
  return "Sua assinatura está em dia.";
}

function Assinatura() {
  const sessao = useQuery({ queryKey: ["sessao"], queryFn: () => sessaoFn() });
  const p = sessao.data?.plano;

  return (
    <AppShell title="Assinatura" subtitle="Plano, módulos e usuários contratados">
      {!p ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </p>
      ) : (
        <div className="max-w-2xl space-y-4">
          <section className="panel p-5">
            <div className="flex items-center gap-3">
              <CreditCard className="size-5 text-primary" />
              <div className="flex-1">
                <p className="text-lg font-semibold">
                  {p.plano ? (NOME_PLANO[p.plano] ?? p.plano) : "Nenhum plano"}
                  {p.cortesia ? (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      cortesia
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">{STATUS[p.status] ?? p.status}</p>
              </div>
            </div>
            <p className="mt-4 text-sm">{mensagem(p)}</p>
          </section>

          <section className="panel grid gap-4 p-5 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Módulos</p>
              <p className="mt-1 text-sm">
                {[
                  p.modulos.includes("itsm") ? "ITSM" : null,
                  p.modulos.includes("projetos") ? "Projetos" : null,
                  p.ia ? "IA" : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Usuários pagantes
              </p>
              <p className="mt-1 text-sm">
                {p.usuariosPagantes} de {p.cortesia ? "ilimitados" : p.usuariosContratados}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {p.status === "teste" ? "Teste até" : "Renovação"}
              </p>
              <p className="mt-1 text-sm">
                {(p.status === "teste" ? p.testeAte : p.periodoFim)
                  ? new Date(
                      `${(p.status === "teste" ? p.testeAte : p.periodoFim)!}T00:00:00`,
                    ).toLocaleDateString("pt-BR")
                  : "—"}
              </p>
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            Usuário pagante é quem atende chamados (tem equipe), gerencia projetos ou é
            administrador. Quem só abre chamados não conta. A contratação e a troca de plano pela
            tela chegam em breve; até lá, fale com a equipe BeagleOne.
          </p>
        </div>
      )}
    </AppShell>
  );
}