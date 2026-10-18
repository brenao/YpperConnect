import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { documentoValido, formatarDocumento, somenteDigitos } from "@/lib/documento";
import { mensagemErro } from "@/lib/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { criarCheckoutFn, planosPublicosFn, validarCupomFn } from "@/services/checkout.functions";

export const Route = createFileRoute("/contratar")({
  head: () => ({
    meta: [
      { title: "Contratar · BeagleOne" },
      { name: "description", content: "Planos do BeagleOne: ITSM, Projetos ou a Suíte completa." },
    ],
  }),
  // ?cupom=LUCIANA20 chega do link do afiliado e preenche o campo.
  validateSearch: (s: Record<string, unknown>): { cupom?: string | undefined } => ({
    cupom: typeof s["cupom"] === "string" ? s["cupom"] : undefined,
  }),
  component: Contratar,
});

/** Só letras, números e hífen, em maiúsculas (o formato do código). */
const limparCupom = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 30);

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

  // Cupom de indicação: digitado ou vindo do link. Confere com pausa,
  // para não consultar o servidor a cada tecla.
  const search = Route.useSearch();
  const [cupom, setCupom] = useState(() => limparCupom(search.cupom ?? ""));
  const [cupomEstavel, setCupomEstavel] = useState(cupom);
  const [emailEstavel, setEmailEstavel] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setCupomEstavel(cupom);
      setEmailEstavel(f.email.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [cupom, f.email]);
  const cupomQuery = useQuery({
    queryKey: ["cupom", cupomEstavel, emailEstavel],
    queryFn: () =>
      validarCupomFn({
        data: { codigo: cupomEstavel, ...(emailEstavel ? { email: emailEstavel } : {}) },
      }),
    enabled: cupomEstavel.length >= 3,
    staleTime: 60_000,
  });
  const cupomDigitado = cupom.length > 0;
  const conferindoCupom =
    cupomDigitado && (cupom !== cupomEstavel || cupomQuery.isFetching || cupom.length < 3);
  const cupomOk =
    cupomDigitado && !conferindoCupom && cupomQuery.data?.valido === true ? cupomQuery.data : null;
  const cupomRecusado = cupomDigitado && !conferindoCupom && !cupomOk;
  const descontoPct = cupomOk?.descontoPct ?? 0;

  const docDigitado = somenteDigitos(f.cpfCnpj).length > 0;
  const docOk = documentoValido(f.cpfCnpj);

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
  // Mesma conta do banco (valor_mensal_assinatura): arredonda o total.
  const totalComDesconto = Math.round((total * (100 - descontoPct)) / 100);

  const contratar = useMutation({
    mutationFn: () =>
      criarCheckoutFn({
        data: {
          ...f,
          plano: plano!.codigo,
          ciclo,
          usuarios,
          addonIa: addonIa && nivel === "essencial",
          ...(cupomOk?.codigo ? { cupom: cupomOk.codigo } : {}),
        },
      }),
    onSuccess: (r) => setEnviadoPara(r.email),
    onError: (e: Error) =>
      toast.error("Não foi possível concluir", { description: mensagemErro(e) }),
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
                  inputMode="numeric"
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  value={f.cpfCnpj}
                  aria-invalid={docDigitado && !docOk}
                  onChange={(e) => setF({ ...f, cpfCnpj: formatarDocumento(e.target.value) })}
                />
                {docDigitado && !docOk ? (
                  <p className="text-xs text-destructive">CPF ou CNPJ inválido.</p>
                ) : null}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  Cupom de indicação{" "}
                  <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  className="font-mono uppercase"
                  placeholder="Ex.: LUCIANA20"
                  value={cupom}
                  aria-invalid={cupomRecusado}
                  onChange={(e) => setCupom(limparCupom(e.target.value))}
                />
                {conferindoCupom ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Conferindo cupom...
                  </p>
                ) : cupomOk ? (
                  <p className="text-xs text-success">
                    ✓ Indicação de {cupomOk.afiliado}
                    {descontoPct > 0 ? ` · ${descontoPct}% de desconto na assinatura` : ""}
                  </p>
                ) : cupomRecusado ? (
                  <p className="text-xs text-destructive">
                    {cupomQuery.data?.motivo ?? "Cupom inválido."} Corrija ou apague o campo.
                  </p>
                ) : null}
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
            {descontoPct > 0 ? (
              <p className="text-sm text-muted-foreground">
                <span className="line-through">{reais(total)}</span>{" "}
                <span className="font-medium text-success">
                  cupom {cupomOk?.codigo} · −{descontoPct}%
                </span>
              </p>
            ) : null}
            <p className="text-3xl font-semibold">
              {reais(totalComDesconto)}
              <span className="text-sm font-normal text-muted-foreground">/mês</span>
            </p>
            {ciclo === "anual" ? (
              <p className="text-xs text-muted-foreground">
                Cobrado anualmente: {reais(totalComDesconto * 12)}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={contratar.isPending || !plano || !docOk || conferindoCupom || cupomRecusado}
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