import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { meuPortalFn } from "@/services/afiliado.functions";
import { sairFn } from "@/services/sessao.functions";

export const Route = createFileRoute("/afiliado")({
  head: () => ({ meta: [{ title: "Portal do afiliado · BeagleOne" }] }),
  component: Portal,
});

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR") : "—";

const STATUS_CLIENTE: Record<string, string> = {
  teste: "Em teste",
  ativa: "Ativo",
  inadimplente: "Pagamento pendente",
  somente_leitura: "Pagamento pendente",
  suspensa: "Suspenso",
  cancelada: "Cancelado",
};
const STATUS_COMISSAO: Record<string, string> = {
  prevista: "Prevista",
  liberada: "Liberada",
  paga: "Paga",
  estornada: "Estornada",
};

function Cartao({ label, valor, dica }: { label: string; valor: string; dica?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
      {dica ? <p className="text-xs text-muted-foreground">{dica}</p> : null}
    </div>
  );
}

function Portal() {
  const router = useRouter();
  const portal = useQuery({ queryKey: ["portal-afiliado"], queryFn: () => meuPortalFn() });
  const [origem, setOrigem] = useState("");
  const [copiado, setCopiado] = useState(false);
  useEffect(() => setOrigem(window.location.origin), []);
  const sair = useMutation({
    mutationFn: () => sairFn(),
    onSuccess: () => router.navigate({ to: "/login" }),
  });

  const p = portal.data;
  const link = p ? `${origem}/indicacao/${p.codigo}` : "";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Portal do afiliado</h1>
          {p ? (
            <p className="text-sm text-muted-foreground">
              {p.nome} · {p.tipo === "parceiro" ? "Parceiro implantador" : "Afiliado"} ·{" "}
              {p.comissaoPct}% recorrente por {p.mesesRecorrencia} meses
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => sair.mutate()}>
          <LogOut className="size-4" /> Sair
        </Button>
      </div>

      {portal.isPending ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </p>
      ) : portal.isError ? (
        <p className="panel p-4 text-sm text-muted-foreground">{portal.error.message}</p>
      ) : p ? (
        <div className="space-y-6">
          <section className="panel space-y-2 p-5">
            <p className="text-sm font-medium">Seu link de indicação</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button
                variant="outline"
                className="gap-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 2000);
                }}
              >
                {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Vale a última indicação em até 90 dias. A comissão é liberada 30 dias após cada
              pagamento do cliente.
            </p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Cartao
              label="Cliques"
              valor={String(p.cliques30d)}
              dica={`${p.cliquesTotal} no total`}
            />
            <Cartao
              label="Clientes"
              valor={String(p.clientes.length)}
              dica={`${p.clientes.filter((c) => c.status === "ativa").length} ativos`}
            />
            <Cartao label="Previstas" valor={reais(p.totais.prevista)} dica="em carência" />
            <Cartao label="A receber" valor={reais(p.totais.liberada)} dica="liberadas" />
            <Cartao label="Recebidas" valor={reais(p.totais.paga)} />
          </div>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              Clientes indicados
            </h2>
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Empresa</th>
                    <th className="px-4 py-2 font-medium">Situação</th>
                    <th className="px-4 py-2 font-medium">Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {p.clientes.map((c, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-4 py-2">{c.empresa}</td>
                      <td className="px-4 py-2">{STATUS_CLIENTE[c.status] ?? c.status}</td>
                      <td className="px-4 py-2 text-muted-foreground">{dataBr(c.desde)}</td>
                    </tr>
                  ))}
                  {p.clientes.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                        Nenhum cliente ainda. Compartilhe seu link!
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Comissões</h2>
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Empresa</th>
                    <th className="px-4 py-2 font-medium">Competência</th>
                    <th className="px-4 py-2 font-medium">Valor</th>
                    <th className="px-4 py-2 font-medium">Situação</th>
                    <th className="px-4 py-2 font-medium">Libera / pago em</th>
                  </tr>
                </thead>
                <tbody>
                  {p.comissoes.map((c, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-4 py-2">{c.empresa}</td>
                      <td className="px-4 py-2">{dataBr(c.competencia)}</td>
                      <td className="px-4 py-2">{reais(c.valorCentavos)}</td>
                      <td className="px-4 py-2">{STATUS_COMISSAO[c.status] ?? c.status}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {c.status === "paga" ? dataBr(c.pagoEm) : dataBr(c.liberarEm)}
                      </td>
                    </tr>
                  ))}
                  {p.comissoes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        Nenhuma comissão ainda.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}