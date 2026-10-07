import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { criarCheckoutFn, planosPublicosFn } from "@/services/checkout.functions";

export const Route = createFileRoute("/contratar")({
  head: () => ({
    meta: [
      { title: "Contratar · BeagleOne" },
      { name: "description", content: "Planos do BeagleOne: ITSM, Projetos ou a Suíte completa." },
    ],
  }),
  component: Contratar,
});

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function sugerirSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const MODULOS = [
  { id: "itsm", nome: "ITSM", resumo: "Chamados, SLA, catálogo e conhecimento" },
  { id: "projetos", nome: "Projetos", resumo: "Cronograma, Gantt, caminho crítico e recursos" },
  { id: "suite", nome: "Suíte", resumo: "ITSM + Projetos no mesmo lugar" },
];

function Contratar() {
  const planos = useQuery({ queryKey: ["planos-publicos"], queryFn: () => planosPublicosFn() });
  const [modulo, setModulo] = useState("suite");
  const [nivel, setNivel] = useState<"essencial" | "pro">("pro");
  const [ciclo, setCiclo] = useState<"mensal" | "anual">("anual");
  const [usuarios, setUsuarios] = useState(3);
  const [addonIa, setAddonIa] = useState(false);
  const [f, setF] = useState({ empresa: "", slug: "", nome: "", email: "", cpfCnpj: "" });
  const [slugEditado, setSlugEditado] = useState(false);
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);

  const plano = planos.data?.planos.find((p) => p.modulo === modulo && p.nivel === nivel);
  const total = useMemo(() => {
    if (!plano || !planos.data) return 0;
    const base = ciclo === "anual" ? plano.anualCentavos : plano.mensalCentavos;
    const ia =
      addonIa && !plano.iaIncluida
        ? ciclo === "anual"
          ? planos.data.addonIa.anualCentavos
          : planos.data.addonIa.mensalCentavos
        : 0;
    return Math.max(usuarios, 3) * (base + ia);
  }, [plano, planos.data, ciclo, usuarios, addonIa]);

  const contratar = useMutation({
    mutationFn: () =>
      criarCheckoutFn({
        data: {
          ...f,
          plano: plano!.codigo,
          ciclo,
          usuarios,
          addonIa: addonIa && nivel === "essencial",
        },
      }),
    onSuccess: (r) => setEnviadoPara(r.email),
    onError: (e: Error) => toast.error("Não foi possível concluir", { description: e.message }),
  });

  if (enviadoPara) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Check className="mx-auto size-10 text-success" />
        <h1 className="mt-4 text-2xl font-semibold">Empresa criada!</h1>
        <p className="mt-2 text-muted-foreground">
          Enviamos para <strong>{enviadoPara}</strong> o link para definir sua senha. Seus 14 dias
          de teste grátis já começaram; a primeira cobrança só vence no fim do teste.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Escolha seu plano</h1>
      <p className="mt-1 text-muted-foreground">
        14 dias grátis. Pague só por quem atende chamados ou gerencia projetos; quem só abre
        chamados não paga.
      </p>

      {planos.isPending ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando planos...
        </p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {MODULOS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModulo(m.id)}
                  className={cn(
                    "panel p-4 text-left transition-colors",
                    modulo === m.id ? "border-primary/60 bg-primary/5" : "hover:border-primary/30",
                  )}
                >
                  <p className="font-semibold">{m.nome}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.resumo}</p>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex rounded-lg border border-border p-1">
                {(["essencial", "pro"] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNivel(n)}
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm",
                      nivel === n ? "bg-primary text-primary-foreground" : "",
                    )}
                  >
                    {n === "pro" ? "Pro (com IA)" : "Essencial"}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border p-1">
                {(["anual", "mensal"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCiclo(c)}
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm",
                      ciclo === c ? "bg-primary text-primary-foreground" : "",
                    )}
                  >
                    {c === "anual" ? "Anual (≈2 meses grátis)" : "Mensal"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Usuários pagantes</Label>
                <Input
                  type="number"
                  min={3}
                  value={usuarios}
                  onChange={(e) => setUsuarios(Math.max(3, Number(e.target.value) || 3))}
                />
              </div>
              {nivel === "essencial" ? (
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <Switch checked={addonIa} onCheckedChange={setAddonIa} />
                  Adicionar BeagleOne IA
                </label>
              ) : null}
            </div>

            <div className="panel grid gap-4 p-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nome da empresa</Label>
                <Input
                  value={f.empresa}
                  onChange={(e) =>
                    setF({
                      ...f,
                      empresa: e.target.value,
                      slug: slugEditado ? f.slug : sugerirSlug(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Endereço</Label>
                <Input
                  className="font-mono"
                  value={f.slug}
                  onChange={(e) => {
                    setSlugEditado(true);
                    setF({ ...f, slug: e.target.value.toLowerCase() });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Seu nome</Label>
                <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Seu e-mail</Label>
                <Input
                  type="email"
                  value={f.email}
                  onChange={(e) => setF({ ...f, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>CPF ou CNPJ (para a cobrança)</Label>
                <Input
                  value={f.cpfCnpj}
                  onChange={(e) => setF({ ...f, cpfCnpj: e.target.value })}
                />
              </div>
            </div>
          </div>

          <aside className="panel h-fit space-y-3 p-5 lg:sticky lg:top-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Resumo</p>
            <p className="text-lg font-semibold">{plano?.nome ?? "—"}</p>
            <p className="text-sm text-muted-foreground">
              {Math.max(usuarios, 3)} usuários ·{" "}
              {ciclo === "anual" ? "plano anual" : "plano mensal"}
              {nivel === "pro" || addonIa ? " · com IA" : ""}
            </p>
            <p className="text-3xl font-semibold">
              {reais(total)}
              <span className="text-sm font-normal text-muted-foreground">/mês</span>
            </p>
            {ciclo === "anual" ? (
              <p className="text-xs text-muted-foreground">
                Cobrado anualmente: {reais(total * 12)}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={contratar.isPending || !plano}
              onClick={() => contratar.mutate()}
            >
              {contratar.isPending ? "Criando..." : "Começar 14 dias grátis"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Pix, boleto ou cartão. A primeira cobrança vence no fim do teste.
            </p>
            <p className="text-xs text-muted-foreground">
              Já tem conta?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Entrar
              </Link>
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}