import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sessaoFn } from "@/services/sessao.functions";
import { DialogLink } from "@/views/dialog-link";
import {
  atualizarAssinaturaFn,
  criarAfiliadoFn,
  marcarComissaoPagaFn,
  painelComercialFn,
} from "@/services/comercial.functions";
import type { LinhaAssinatura, Plano } from "@/repositories/comercial.repo";

export const Route = createFileRoute("/plataforma/comercial")({
  head: () => ({ meta: [{ title: "Comercial · Plataforma · BeagleOne" }] }),
  component: Comercial,
});

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBr = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR") : "—";

const STATUS = ["teste", "ativa", "inadimplente", "somente_leitura", "suspensa", "cancelada"];
const STATUS_LABEL: Record<string, string> = {
  teste: "Teste",
  ativa: "Ativa",
  inadimplente: "Pagamento pendente",
  somente_leitura: "Somente leitura",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
};

function Kpi({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
    </div>
  );
}

function erro(e: Error) {
  toast.error("Não foi possível concluir", { description: e.message });
}

function DialogAssinatura({
  linha,
  planos,
  onFechar,
}: {
  linha: LinhaAssinatura;
  planos: Plano[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    plano: linha.plano ?? planos[0]?.codigo ?? "",
    ciclo: linha.ciclo ?? "anual",
    usuarios: linha.usuariosContratados || 3,
    addonIa: linha.addonIa,
    status: linha.status ?? "ativa",
    cortesia: linha.cortesia,
    periodoFim: linha.periodoFim ?? "",
    afiliadoCodigo: linha.afiliadoCodigo ?? "",
  });
  const salvar = useMutation({
    mutationFn: () =>
      atualizarAssinaturaFn({
        data: {
          tenantId: linha.tenantId,
          plano: f.plano,
          ciclo: f.ciclo,
          usuarios: f.usuarios,
          addonIa: f.addonIa,
          status: f.status as never,
          cortesia: f.cortesia,
          periodoFim: f.periodoFim || null,
          afiliadoCodigo: f.afiliadoCodigo.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["painel-comercial"] });
      toast.success("Assinatura atualizada");
      onFechar();
    },
    onError: erro,
  });

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assinatura · {linha.empresa}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Plano</Label>
            <Select value={f.plano} onValueChange={(v) => setF({ ...f, plano: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {planos.map((p) => (
                  <SelectItem key={p.codigo} value={p.codigo}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ciclo</Label>
            <Select
              value={f.ciclo}
              onValueChange={(v) => setF({ ...f, ciclo: v as "mensal" | "anual" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anual">Anual</SelectItem>
                <SelectItem value="mensal">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Usuários pagantes</Label>
            <Input
              type="number"
              min={3}
              value={f.usuarios}
              onChange={(e) => setF({ ...f, usuarios: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Vigente até</Label>
            <Input
              type="date"
              value={f.periodoFim}
              onChange={(e) => setF({ ...f, periodoFim: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Código do afiliado (opcional)</Label>
            <Input
              value={f.afiliadoCodigo}
              onChange={(e) => setF({ ...f, afiliadoCodigo: e.target.value })}
              placeholder="ex.: parceiro-x"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.addonIa} onCheckedChange={(v) => setF({ ...f, addonIa: v })} />
            Add-on IA (planos Essencial)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.cortesia} onCheckedChange={(v) => setF({ ...f, cortesia: v })} />
            Cortesia (sem cobrança)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogAfiliado({
  onFechar,
  onLink,
}: {
  onFechar: () => void;
  onLink: (url: string) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({ codigo: "", nome: "", email: "", tipo: "afiliado" as const });
  const criar = useMutation({
    mutationFn: () => criarAfiliadoFn({ data: f }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["painel-comercial"] });
      toast.success("Afiliado cadastrado");
      onFechar();
      if (r.link) onLink(r.link);
    },
    onError: erro,
  });
  return (
    <Dialog open onOpenChange={(v) => (v ? null : onFechar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo afiliado</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Código (vai no link de indicação)</Label>
            <Input
              className="font-mono"
              value={f.codigo}
              onChange={(e) => setF({ ...f, codigo: e.target.value.toLowerCase() })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v as never })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="afiliado">Afiliado · 20% por 12 meses</SelectItem>
                <SelectItem value="parceiro">Parceiro implantador · 30% por 12 meses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={criar.isPending} onClick={() => criar.mutate()}>
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Comercial() {
  const qc = useQueryClient();
  const sessao = useQuery({ queryKey: ["sessao"], queryFn: () => sessaoFn() });
  const operador = sessao.data?.adminPlataforma === true;
  const painel = useQuery({
    queryKey: ["painel-comercial"],
    queryFn: () => painelComercialFn(),
    enabled: operador,
  });
  const [editando, setEditando] = useState<LinhaAssinatura | null>(null);
  const [novoAfiliado, setNovoAfiliado] = useState(false);
  const [link, setLink] = useState<{ url: string; titulo: string } | null>(null);
  const pagar = useMutation({
    mutationFn: (id: string) => marcarComissaoPagaFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["painel-comercial"] });
      toast.success("Comissão marcada como paga");
    },
    onError: erro,
  });

  const d = painel.data;
  const pagantes = (d?.assinaturas ?? []).filter(
    (a) => !a.cortesia && (a.status === "ativa" || a.status === "inadimplente"),
  );
  const mrr = pagantes.reduce((s, a) => s + a.valorMensalCentavos, 0);
  const aPagar = (d?.comissoes ?? [])
    .filter((c) => c.status === "liberada")
    .reduce((s, c) => s + c.valorCentavos, 0);

  return (
    <AppShell trilha="Plataforma" title="Comercial" subtitle="Assinaturas, receita e afiliados">
      {sessao.isPending ? null : !operador ? (
        <div className="panel p-4 text-sm text-muted-foreground">
          Esta área é exclusiva dos operadores da plataforma.
        </div>
      ) : !d ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </p>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="MRR" valor={reais(mrr)} />
            <Kpi
              label="Ativas"
              valor={String(d.assinaturas.filter((a) => a.status === "ativa").length)}
            />
            <Kpi
              label="Em teste"
              valor={String(d.assinaturas.filter((a) => a.status === "teste").length)}
            />
            <Kpi
              label="Inadimplentes"
              valor={String(
                d.assinaturas.filter((a) =>
                  ["inadimplente", "somente_leitura", "suspensa"].includes(a.status ?? ""),
                ).length,
              )}
            />
            <Kpi label="Comissões a pagar" valor={reais(aPagar)} />
          </div>

          <Tabs defaultValue="assinaturas">
            <TabsList>
              <TabsTrigger value="assinaturas">Assinaturas</TabsTrigger>
              <TabsTrigger value="afiliados">Afiliados e comissões</TabsTrigger>
            </TabsList>

            <TabsContent value="assinaturas" className="mt-4">
              <div className="panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Empresa</th>
                      <th className="px-4 py-2 font-medium">Plano</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Usuários</th>
                      <th className="px-4 py-2 font-medium">Mensal</th>
                      <th className="px-4 py-2 font-medium">Teste / vigência</th>
                      <th className="px-4 py-2 font-medium">Afiliado</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.assinaturas.map((a) => (
                      <tr key={a.tenantId} className="border-b border-border/60">
                        <td className="px-4 py-2">{a.empresa}</td>
                        <td className="px-4 py-2">
                          {d.planos.find((p) => p.codigo === a.plano)?.nome ?? "—"}
                          {a.addonIa ? " + IA" : ""}
                          <span className="block text-[11px] text-muted-foreground">{a.ciclo}</span>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {a.cortesia ? "Cortesia" : (STATUS_LABEL[a.status ?? ""] ?? "—")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          {a.usuariosPagantes} / {a.cortesia ? "∞" : a.usuariosContratados}
                        </td>
                        <td className="px-4 py-2">{reais(a.valorMensalCentavos)}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {a.status === "teste" ? dataBr(a.testeAte) : dataBr(a.periodoFim)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{a.afiliadoCodigo ?? "—"}</td>
                        <td className="px-4 py-2 text-right">
                          {a.plano ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              title="Ajustar assinatura"
                              onClick={() => setEditando(a)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="afiliados" className="mt-4 space-y-4">
              <Button size="sm" className="gap-2" onClick={() => setNovoAfiliado(true)}>
                <Plus className="size-4" /> Novo afiliado
              </Button>
              <div className="panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Afiliado</th>
                      <th className="px-4 py-2 font-medium">Código</th>
                      <th className="px-4 py-2 font-medium">Tipo</th>
                      <th className="px-4 py-2 font-medium">Comissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.afiliados.map((a) => (
                      <tr key={a.id} className="border-b border-border/60">
                        <td className="px-4 py-2">
                          {a.nome}
                          <span className="block text-[11px] text-muted-foreground">{a.email}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{a.codigo}</td>
                        <td className="px-4 py-2">
                          {a.tipo === "parceiro" ? "Parceiro" : "Afiliado"}
                        </td>
                        <td className="px-4 py-2">
                          {a.comissaoPct}% · {a.mesesRecorrencia} meses
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Comissões</h2>
              <div className="panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Afiliado</th>
                      <th className="px-4 py-2 font-medium">Empresa</th>
                      <th className="px-4 py-2 font-medium">Valor</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Libera em</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.comissoes.map((c) => (
                      <tr key={c.id} className="border-b border-border/60">
                        <td className="px-4 py-2">{c.afiliadoNome}</td>
                        <td className="px-4 py-2">{c.empresa}</td>
                        <td className="px-4 py-2">{reais(c.valorCentavos)}</td>
                        <td className="px-4 py-2 capitalize">{c.status}</td>
                        <td className="px-4 py-2 text-muted-foreground">{dataBr(c.liberarEm)}</td>
                        <td className="px-4 py-2 text-right">
                          {c.status === "liberada" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pagar.isPending}
                              onClick={() => pagar.mutate(c.id)}
                            >
                              Marcar como paga
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {d.comissoes.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                          Nenhuma comissão ainda.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>

          {editando ? (
            <DialogAssinatura
              linha={editando}
              planos={d.planos}
              onFechar={() => setEditando(null)}
            />
          ) : null}
          {novoAfiliado ? (
            <DialogAfiliado
              onFechar={() => setNovoAfiliado(false)}
              onLink={(url) => setLink({ url, titulo: "Convite do afiliado (portal)" })}
            />
          ) : null}
          <DialogLink link={link} onFechar={() => setLink(null)} />
        </>
      )}
    </AppShell>
  );
}