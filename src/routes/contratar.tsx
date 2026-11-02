import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { documentoValido, formatarDocumento, somenteDigitos } from "@/lib/documento";
import { mensagemErro } from "@/lib/mensagem-erro";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { criarCheckoutFn, planosPublicosFn, validarCupomFn } from "@/services/checkout.functions";

/**
 * Contratação pública. Segue o visual do site institucional (tema claro,
 * mesma tipografia e botões), porque é a continuação da seção de preços.
 *
 * O site manda a escolha pela URL:
 *   /contratar?modulo=suite&nivel=pro&ciclo=anual&usuarios=5&ia=1&cupom=NOME20
 * Todos os parâmetros são opcionais.
 */

/** Endereço do site institucional (links de volta, Termos e Privacidade). */
const SITE_URL = (
  (import.meta.env["VITE_SITE_URL"] as string | undefined) || "https://beagleone.com.br"
).replace(/\/$/, "");

type Modulo = "itsm" | "projetos" | "suite";
type Nivel = "essencial" | "pro";
type Ciclo = "mensal" | "anual";

interface BuscaContratar {
  cupom?: string | undefined;
  modulo?: Modulo | undefined;
  nivel?: Nivel | undefined;
  ciclo?: Ciclo | undefined;
  usuarios?: number | undefined;
  ia?: boolean | undefined;
}

const um = <T extends string>(v: unknown, opcoes: readonly T[]): T | undefined =>
  typeof v === "string" && (opcoes as readonly string[]).includes(v) ? (v as T) : undefined;

export const Route = createFileRoute("/contratar")({
  head: () => ({
    meta: [
      { title: "Contratar · BeagleOne" },
      { name: "description", content: "Planos do BeagleOne: ITSM, Projetos ou a Suíte completa." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): BuscaContratar => {
    const qtd = Number(s["usuarios"]);
    const ia = s["ia"];
    return {
      cupom: typeof s["cupom"] === "string" ? s["cupom"] : undefined,
      modulo: um(s["modulo"], ["itsm", "projetos", "suite"] as const),
      nivel: um(s["nivel"], ["essencial", "pro"] as const),
      ciclo: um(s["ciclo"], ["mensal", "anual"] as const),
      usuarios:
        Number.isFinite(qtd) && qtd > 0 ? Math.min(500, Math.max(3, Math.round(qtd))) : undefined,
      ia: ia === true || ia === 1 || ia === "1" || ia === "true" ? true : undefined,
    };
  },
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
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const MODULOS: { id: Modulo; nome: string; resumo: string }[] = [
  { id: "itsm", nome: "ITSM", resumo: "Chamados, SLA, catálogo e base de conhecimento" },
  { id: "projetos", nome: "Projetos", resumo: "Portfólio, cronograma, backlog e capacidade" },
  { id: "suite", nome: "Suíte", resumo: "ITSM e Projetos juntos, com a mesma equipe" },
];

const campo =
  "h-12 w-full rounded-xl border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15 aria-[invalid=true]:border-destructive";

function Pilulas<T extends string>(props: {
  rotulo: string;
  valor: T;
  opcoes: { id: T; texto: string; extra?: string | undefined }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={props.rotulo}
      className="inline-flex gap-1 rounded-full border border-border bg-card p-1"
    >
      {props.opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={props.valor === o.id}
          onClick={() => props.onChange(o.id)}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors",
            props.valor === o.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.texto}
          {o.extra ? (
            <span
              className={cn("ml-1.5 text-xs", props.valor === o.id ? "opacity-80" : "text-success")}
            >
              {o.extra}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Etapa(props: { n: number; titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <h2 className="flex items-center gap-3 text-xl font-medium tracking-tight">
        <span className="grid size-8 place-items-center rounded-full bg-foreground text-sm text-background">
          {props.n}
        </span>
        {props.titulo}
      </h2>
      <div className="mt-6">{props.children}</div>
    </section>
  );
}

function Campo(props: {
  id: string;
  rotulo: string;
  dica?: string | undefined;
  erro?: string | null | undefined;
  ajuda?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", props.className)}>
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.rotulo}
        {props.dica ? (
          <span className="ml-1 font-normal text-muted-foreground">{props.dica}</span>
        ) : null}
      </label>
      {props.children}
      {props.erro ? (
        <p className="text-xs text-destructive">{props.erro}</p>
      ) : props.ajuda ? (
        <p className="text-xs text-muted-foreground">{props.ajuda}</p>
      ) : null}
    </div>
  );
}

function Marca() {
  return (
    <a
      href={SITE_URL}
      className="flex items-center gap-2.5 text-[19px] font-semibold tracking-tight"
      aria-label="BeagleOne, voltar ao site"
    >
      <img src={`${import.meta.env.BASE_URL}beagleone-mark.svg`} alt="" width={30} height={30} />
      BeagleOne
    </a>
  );
}

function Contratar() {
  const search = Route.useSearch();
  const planos = useQuery({ queryKey: ["planos-publicos"], queryFn: () => planosPublicosFn() });
  const [modulo, setModulo] = useState<Modulo>(search.modulo ?? "suite");
  const [nivel, setNivel] = useState<Nivel>(search.nivel ?? "pro");
  const [ciclo, setCiclo] = useState<Ciclo>(search.ciclo ?? "anual");
  const [usuarios, setUsuarios] = useState(search.usuarios ?? 3);
  const [addonIa, setAddonIa] = useState(
    search.ia === true && (search.nivel ?? "pro") === "essencial",
  );
  const [aceite, setAceite] = useState(false);
  const [f, setF] = useState({ empresa: "", slug: "", nome: "", email: "", cpfCnpj: "" });
  const [slugEditado, setSlugEditado] = useState(false);
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);

  // Cupom de indicação: digitado ou vindo do link. Confere com pausa,
  // para não consultar o servidor a cada tecla.
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
  const param = planos.data?.parametros;
  const diasTeste = param?.diasTeste ?? 14;
  const diasGratisAnual = param?.diasGratisAnual ?? 60;
  const qtd = Math.max(usuarios, 3);
  const comIa = nivel === "pro" || addonIa;

  // Mesma conta do banco (valor_mensal_assinatura). Descontos não somam:
  // no anual vale o maior entre o preço anual e o cupom sobre o mensal.
  const precos = useMemo(() => {
    if (!plano || !planos.data) return { cheio: 0, final: 0, vale: "nenhum" as const };
    const ia = addonIa && !plano.iaIncluida;
    const mensal = qtd * (plano.mensalCentavos + (ia ? planos.data.addonIa.mensalCentavos : 0));
    const anual = qtd * (plano.anualCentavos + (ia ? planos.data.addonIa.anualCentavos : 0));
    const comCupom = (mensal * (100 - descontoPct)) / 100;
    if (ciclo === "anual") {
      return comCupom >= anual
        ? { cheio: anual, final: anual, vale: "anual" as const }
        : { cheio: mensal, final: Math.round(comCupom), vale: "cupom" as const };
    }
    return descontoPct > 0
      ? { cheio: mensal, final: Math.round(comCupom), vale: "cupom" as const }
      : { cheio: mensal, final: mensal, vale: "nenhum" as const };
  }, [plano, planos.data, ciclo, qtd, addonIa, descontoPct]);

  /** Preço por usuário de um módulo, no nível e ciclo escolhidos (cards). */
  const precoModulo = (m: Modulo) => {
    const p = planos.data?.planos.find((x) => x.modulo === m && x.nivel === nivel);
    return p ? (ciclo === "anual" ? p.anualCentavos : p.mensalCentavos) : null;
  };

  const faltando = [
    !f.empresa.trim() && "nome da empresa",
    !f.slug.trim() && "endereço",
    !f.nome.trim() && "seu nome",
    !/^\S+@\S+\.\S+$/.test(f.email.trim()) && "e-mail",
    !docOk && "CPF ou CNPJ",
    !aceite && "aceite dos termos",
  ].filter(Boolean) as string[];

  const contratar = useMutation({
    mutationFn: () =>
      criarCheckoutFn({
        data: {
          ...f,
          plano: plano!.codigo,
          ciclo,
          usuarios: qtd,
          addonIa: addonIa && nivel === "essencial",
          ...(cupomOk?.codigo ? { cupom: cupomOk.codigo } : {}),
          aceiteTermos: true as const,
        },
      }),
    onSuccess: (r) => setEnviadoPara(r.email),
    onError: (e: Error) =>
      toast.error("Não foi possível concluir", { description: mensagemErro(e) }),
  });

  const podeEnviar =
    !contratar.isPending && !!plano && faltando.length === 0 && !conferindoCupom && !cupomRecusado;

  return (
    // Tema claro só nesta tela: as variáveis de cor da classe .light valem para tudo abaixo.
    <div className="light flex min-h-screen flex-col bg-background text-foreground [color-scheme:light]">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-5">
          <Marca />
          <p className="text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link
              to="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Entrar
            </Link>
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-12">
        {enviadoPara ? (
          <div className="mx-auto max-w-xl rounded-3xl border border-border bg-card p-10 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-success/15 text-success">
              <Check className="size-7" />
            </span>
            <h1 className="mt-6 text-3xl font-medium tracking-tight">Empresa criada!</h1>
            <p className="mt-3 text-muted-foreground">
              Enviamos para <strong className="text-foreground">{enviadoPara}</strong> o link para
              definir sua senha. Seus {diasTeste} dias de teste grátis já começaram; a primeira
              cobrança só vence no fim do teste.
            </p>
            <p className="mt-6 text-sm text-muted-foreground">
              Não recebeu? Confira a caixa de spam.
            </p>
          </div>
        ) : (
          <>
            <div className="max-w-2xl">
              <p className="text-[15px] text-primary">Contratação</p>
              <h1 className="mt-2 text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
                Comece seus {diasTeste} dias grátis
              </h1>
              <p className="mt-4 text-lg text-muted-foreground">
                Você paga só por quem atende chamados ou gerencia projetos. Quem só abre chamados
                não entra na conta.
              </p>
            </div>

            {planos.isPending ? (
              <p className="flex items-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando planos...
              </p>
            ) : planos.isError ? (
              <p className="py-16 text-destructive">
                Não foi possível carregar os planos. Recarregue a página.
              </p>
            ) : (
              <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
                  <Etapa n={1} titulo="Escolha o plano">
                    <div className="grid gap-3 sm:grid-cols-3">
                      {MODULOS.map((m) => {
                        const preco = precoModulo(m.id);
                        const ativo = modulo === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            aria-pressed={ativo}
                            onClick={() => setModulo(m.id)}
                            className={cn(
                              "relative rounded-2xl border p-5 text-left transition-colors",
                              ativo
                                ? "border-primary bg-primary/[0.06] ring-1 ring-primary"
                                : "border-border hover:border-muted-foreground/40",
                            )}
                          >
                            {m.id === "suite" ? (
                              <span className="absolute right-4 top-4 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                                Mais completo
                              </span>
                            ) : null}
                            <p className="text-lg font-medium">{m.nome}</p>
                            <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                              {m.resumo}
                            </p>
                            {preco !== null ? (
                              <p className="mt-4 font-mono text-sm">
                                <span className="text-xl font-medium">{reais(preco)}</span>
                                <span className="text-muted-foreground"> /usuário/mês</span>
                              </p>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <Pilulas
                        rotulo="Nível do plano"
                        valor={nivel}
                        onChange={(n) => {
                          setNivel(n);
                          if (n === "pro") setAddonIa(false);
                        }}
                        opcoes={[
                          { id: "essencial", texto: "Essencial" },
                          { id: "pro", texto: "Pro", extra: "com IA" },
                        ]}
                      />
                      <Pilulas
                        rotulo="Forma de pagamento"
                        valor={ciclo}
                        onChange={setCiclo}
                        opcoes={[
                          { id: "anual", texto: "Anual", extra: `${diasGratisAnual} dias grátis` },
                          { id: "mensal", texto: "Mensal" },
                        ]}
                      />
                    </div>

                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium" id="rotulo-usuarios">
                          Usuários pagantes{" "}
                          <span className="font-normal text-muted-foreground">(mínimo 3)</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label="Diminuir usuários"
                            onClick={() => setUsuarios((u) => Math.max(3, u - 1))}
                            className="grid size-12 place-items-center rounded-xl border border-border bg-card hover:border-muted-foreground/40"
                          >
                            <Minus className="size-4" />
                          </button>
                          <input
                            id="usuarios"
                            aria-labelledby="rotulo-usuarios"
                            type="number"
                            inputMode="numeric"
                            min={3}
                            max={500}
                            value={usuarios}
                            onChange={(e) =>
                              setUsuarios(Math.min(500, Math.max(3, Number(e.target.value) || 3)))
                            }
                            className={cn(campo, "w-24 text-center font-mono")}
                          />
                          <button
                            type="button"
                            aria-label="Aumentar usuários"
                            onClick={() => setUsuarios((u) => Math.min(500, u + 1))}
                            className="grid size-12 place-items-center rounded-xl border border-border bg-card hover:border-muted-foreground/40"
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                      </div>
                      {nivel === "essencial" && planos.data ? (
                        <label className="flex cursor-pointer items-start gap-3 self-end rounded-2xl border border-border p-4 hover:border-muted-foreground/40">
                          <Checkbox
                            checked={addonIa}
                            onCheckedChange={(v) => setAddonIa(v === true)}
                            className="mt-0.5"
                          />
                          <span className="text-sm">
                            <span className="flex items-center gap-1.5 font-medium">
                              <Sparkles className="size-4 text-primary" /> Adicionar BeagleOne IA
                            </span>
                            <span className="text-muted-foreground">
                              +
                              {reais(
                                ciclo === "anual"
                                  ? planos.data.addonIa.anualCentavos
                                  : planos.data.addonIa.mensalCentavos,
                              )}{" "}
                              /usuário/mês
                            </span>
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </Etapa>

                  <Etapa n={2} titulo="Empresa e responsável">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Campo id="empresa" rotulo="Nome da empresa">
                        <input
                          id="empresa"
                          className={campo}
                          autoComplete="organization"
                          value={f.empresa}
                          onChange={(e) =>
                            setF({
                              ...f,
                              empresa: e.target.value,
                              slug: slugEditado ? f.slug : sugerirSlug(e.target.value),
                            })
                          }
                        />
                      </Campo>
                      <Campo
                        id="slug"
                        rotulo="Endereço no sistema"
                        ajuda="Só letras minúsculas, números e hífen."
                      >
                        <input
                          id="slug"
                          className={cn(campo, "font-mono")}
                          value={f.slug}
                          onChange={(e) => {
                            setSlugEditado(true);
                            setF({ ...f, slug: e.target.value.toLowerCase() });
                          }}
                        />
                      </Campo>
                      <Campo id="nome" rotulo="Seu nome">
                        <input
                          id="nome"
                          className={campo}
                          autoComplete="name"
                          value={f.nome}
                          onChange={(e) => setF({ ...f, nome: e.target.value })}
                        />
                      </Campo>
                      <Campo id="email" rotulo="Seu e-mail" dica="(receberá o acesso)">
                        <input
                          id="email"
                          type="email"
                          className={campo}
                          autoComplete="email"
                          value={f.email}
                          onChange={(e) => setF({ ...f, email: e.target.value })}
                        />
                      </Campo>
                      <Campo
                        id="doc"
                        rotulo="CPF ou CNPJ"
                        dica="(para a cobrança)"
                        erro={docDigitado && !docOk ? "CPF ou CNPJ inválido." : null}
                      >
                        <input
                          id="doc"
                          inputMode="numeric"
                          className={campo}
                          placeholder="00.000.000/0000-00"
                          value={f.cpfCnpj}
                          aria-invalid={docDigitado && !docOk}
                          onChange={(e) =>
                            setF({ ...f, cpfCnpj: formatarDocumento(e.target.value) })
                          }
                        />
                      </Campo>
                      <Campo id="cupom" rotulo="Cupom de parceiro" dica="(opcional)">
                        <input
                          id="cupom"
                          className={cn(campo, "font-mono uppercase")}
                          placeholder="Ex.: NOME20"
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
                            {descontoPct > 0 ? ` · ${descontoPct}% de desconto` : ""}
                          </p>
                        ) : cupomRecusado ? (
                          <p className="text-xs text-destructive">
                            {cupomQuery.data?.motivo ?? "Cupom inválido."} Corrija ou apague o
                            campo.
                          </p>
                        ) : null}
                      </Campo>
                    </div>
                  </Etapa>
                </div>

                <aside className="rounded-3xl border border-border bg-card p-6 shadow-[0_24px_60px_-28px_oklch(0.3_0.04_250/0.28)] sm:p-7 lg:sticky lg:top-[96px]">
                  <p className="text-sm text-muted-foreground">Resumo</p>
                  <p className="mt-1 text-2xl font-medium tracking-tight">{plano?.nome ?? "—"}</p>
                  <ul className="mt-4 space-y-2 border-y border-border py-4 text-sm">
                    <li className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Usuários pagantes</span>
                      <span className="font-mono">{qtd}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Pagamento</span>
                      <span>{ciclo === "anual" ? "Anual" : "Mensal"}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span className="text-muted-foreground">BeagleOne IA</span>
                      <span>{comIa ? (nivel === "pro" ? "Incluída" : "Adicional") : "Não"}</span>
                    </li>
                    {cupomOk ? (
                      <li className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Cupom</span>
                        <span className="font-mono">{cupomOk.codigo}</span>
                      </li>
                    ) : null}
                  </ul>

                  <div className="mt-5">
                    {precos.vale === "cupom" ? (
                      <p className="font-mono text-sm text-muted-foreground line-through">
                        {reais(precos.cheio)}
                      </p>
                    ) : null}
                    <p className="font-mono text-4xl font-medium tracking-tight">
                      {reais(precos.final)}
                      <span className="ml-1 font-sans text-base font-normal text-muted-foreground">
                        /mês
                      </span>
                    </p>
                    {precos.vale === "cupom" ? (
                      <p className="mt-1 text-sm text-success">
                        −{descontoPct}% por {param?.mesesDescontoCupom ?? 12} meses
                      </p>
                    ) : descontoPct > 0 && precos.vale === "anual" ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        O desconto do anual é maior que o do cupom; os descontos não se somam.
                      </p>
                    ) : null}
                    {ciclo === "anual" ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Cobrado anualmente: {reais(precos.final * 12)}
                      </p>
                    ) : null}
                  </div>

                  <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
                    <Checkbox
                      checked={aceite}
                      onCheckedChange={(v) => setAceite(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-muted-foreground">
                      Li e aceito os{" "}
                      <a
                        href={`${SITE_URL}/termos`}
                        target="_blank"
                        rel="noopener"
                        className="text-foreground underline underline-offset-2"
                      >
                        Termos de uso
                      </a>{" "}
                      e a{" "}
                      <a
                        href={`${SITE_URL}/privacidade`}
                        target="_blank"
                        rel="noopener"
                        className="text-foreground underline underline-offset-2"
                      >
                        Política de privacidade
                      </a>
                      .
                    </span>
                  </label>

                  <button
                    type="button"
                    disabled={!podeEnviar}
                    onClick={() => contratar.mutate()}
                    className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-[16px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {contratar.isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Criando sua empresa...
                      </>
                    ) : (
                      <>
                        Começar {diasTeste} dias grátis <ArrowRight className="size-4" />
                      </>
                    )}
                  </button>
                  {faltando.length > 0 && !contratar.isPending ? (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Falta: {faltando.join(", ")}.
                    </p>
                  ) : null}

                  <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" /> A primeira cobrança
                      vence no fim do teste.
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {ciclo === "anual"
                        ? "Anual: 12 meses de acesso, renovado automaticamente."
                        : "Mensal: renova a cada mês; cancele quando quiser."}
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" /> Pix, boleto ou
                      cartão.
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" /> Solicitantes não
                      pagam.
                    </li>
                  </ul>
                </aside>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-6 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} BFA DIGITAL LTDA · CNPJ 66.773.637/0001-29</span>
          <nav className="flex gap-5" aria-label="Legal">
            <a href={`${SITE_URL}/termos`} className="hover:text-foreground">
              Termos de uso
            </a>
            <a href={`${SITE_URL}/privacidade`} className="hover:text-foreground">
              Política de privacidade
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}