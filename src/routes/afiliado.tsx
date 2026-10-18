import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { meuPortalFn, salvarCarteiraFn } from "@/services/afiliado.functions";
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

function Recebimento({ carteira, comissaoPct }: { carteira: string | null; comissaoPct: number }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(carteira ?? "");
  const [editando, setEditando] = useState(!carteira);
  useEffect(() => {
    setValor(carteira ?? "");
    setEditando(!carteira);
  }, [carteira]);
  const formatoOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    valor.trim(),
  );
  const salvar = useMutation({
    mutationFn: (c: string) => salvarCarteiraFn({ data: { carteira: c } }),
    onSuccess: (_r, c) => {
      qc.invalidateQueries({ queryKey: ["portal-afiliado"] });
      toast.success(c ? "Carteira salva" : "Carteira removida", {
        description: c
          ? "As próximas cobranças dos seus clientes já trazem a sua comissão direto na sua conta Asaas."
          : "Suas comissões voltam a ser pagas manualmente pela BeagleOne.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Recebimento (carteira Asaas)</h2>
      </div>
      {carteira && !editando ? (
        <div className="space-y-2">
          <p className="text-sm">
            Split ativo: <span className="font-mono text-xs">{carteira}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            A cada pagamento dos seus clientes, {comissaoPct}% cai direto na sua conta Asaas. Não há
            repasse manual nem carência.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
              Trocar carteira
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={salvar.isPending}
              onClick={() => salvar.mutate("")}
            >
              Remover
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Informe o identificador da sua carteira (walletId) para receber a comissão
            automaticamente, direto na sua conta, a cada pagamento dos clientes que você indicou.
            Sem carteira, a BeagleOne paga manualmente, 30 dias após cada pagamento.
          </p>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>Crie sua conta grátis em asaas.com (se ainda não tiver) e conclua a aprovação.</li>
            <li>No app ou site do Asaas, abra Integrações (menu da conta).</li>
            <li>Copie o campo "Wallet ID" (formato 00000000-0000-0000-0000-000000000000).</li>
          </ol>
          <div className="flex gap-2">
            <Input
              className="font-mono text-xs"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={valor}
              aria-invalid={valor.trim().length > 0 && !formatoOk}
              onChange={(e) => setValor(e.target.value)}
            />
            <Button
              disabled={!formatoOk || salvar.isPending}
              onClick={() => salvar.mutate(valor.trim())}
            >
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
            {carteira ? (
              <Button variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
            ) : null}
          </div>
          {valor.trim().length > 0 && !formatoOk ? (
            <p className="text-xs text-destructive">
              Formato inválido. Cole o Wallet ID exatamente como aparece no Asaas.
            </p>
          ) : null}
        </div>
      )}
    </section>
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
  // O link só preenche o cupom; o que vale é o cupom informado na compra.
  const link = p ? `${origem}/contratar?cupom=${encodeURIComponent(p.codigo)}` : "";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Portal do afiliado</h1>
          {p ? (
            <p className="text-sm text-muted-foreground">
              {p.nome} · {p.tipo === "parceiro" ? "Parceiro implantador" : "Afiliado"} ·{" "}
              {p.comissaoPct}% recorrente por {p.mesesRecorrencia} meses
              {p.descontoPct > 0 ? ` · cliente ganha ${p.descontoPct}% de desconto` : ""}
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
            <p className="text-sm font-medium">
              Seu cupom: <span className="font-mono text-base">{p.codigo}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Peça para o cliente informar o cupom na contratação. Ou envie o link abaixo, que já
              abre com o cupom preenchido.
            </p>
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
              O cupom informado na compra é o que vale; sem cupom, conta o último clique no link em
              até 90 dias. Com a carteira Asaas informada, a comissão cai na hora, a cada pagamento;
              sem ela, é liberada 30 dias após cada pagamento do cliente.
            </p>
          </section>

          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Vendas</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao
              label="Clientes ativos"
              valor={String(p.vendas.ativas)}
              dica={`${p.vendas.canceladas} cancelados`}
            />
            <Cartao label="Em teste" valor={String(p.vendas.emTeste)} dica="ainda não pagaram" />
            <Cartao
              label="Receita mensal"
              valor={reais(p.vendas.receitaMensalCentavos)}
              dica="dos seus clientes ativos"
            />
            <Cartao
              label="Cliques no link"
              valor={String(p.cliques30d)}
              dica={`últimos 30 dias · ${p.cliquesTotal} no total`}
            />
          </div>

          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Comissões</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao label="Este mês" valor={reais(p.totais.mes)} />
            <Cartao label="Previstas" valor={reais(p.totais.prevista)} dica="em carência" />
            <Cartao label="A receber" valor={reais(p.totais.liberada)} dica="liberadas" />
            <Cartao label="Recebidas" valor={reais(p.totais.paga)} dica="inclui split" />
          </div>

          <Recebimento carteira={p.carteira} comissaoPct={p.comissaoPct} />

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              Clientes indicados
            </h2>
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Empresa</th>
                    <th className="px-4 py-2 font-medium">Plano</th>
                    <th className="px-4 py-2 font-medium">Situação</th>
                    <th className="px-4 py-2 font-medium">Mensal</th>
                    <th className="px-4 py-2 font-medium">Sua comissão</th>
                    <th className="px-4 py-2 font-medium">Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {p.clientes.map((c, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-4 py-2">
                        {c.empresa}
                        {c.cupom ? (
                          <span className="block font-mono text-[11px] text-muted-foreground">
                            cupom {c.cupom}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        {c.plano}
                        <span className="block text-[11px] text-muted-foreground">
                          {c.usuarios} usuários · {c.ciclo}
                        </span>
                      </td>
                      <td className="px-4 py-2">{STATUS_CLIENTE[c.status] ?? c.status}</td>
                      <td className="px-4 py-2">{reais(c.valorMensalCentavos)}</td>
                      <td className="px-4 py-2">
                        {reais(c.comissoesCentavos)}
                        <span className="block text-[11px] text-muted-foreground">
                          até {dataBr(c.comissaoAte)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{dataBr(c.desde)}</td>
                    </tr>
                  ))}
                  {p.clientes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        Nenhum cliente ainda. Compartilhe seu link!
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              Histórico de comissões
            </h2>
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
                      <td className="px-4 py-2">
                        {STATUS_COMISSAO[c.status] ?? c.status}
                        {c.viaSplit ? (
                          <span className="block text-[11px] text-muted-foreground">
                            direto na sua conta (split)
                          </span>
                        ) : null}
                      </td>
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