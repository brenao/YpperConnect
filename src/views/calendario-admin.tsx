import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { Feriado, Localidade, TipoFeriado } from "@/repositories/calendario.repo";
import {
  listarLocalidadesAdminFn,
  criarLocalidadeFn,
  atualizarLocalidadeFn,
  definirLocalidadePadraoFn,
  definirLocalidadeAtivaFn,
  listarFeriadosFn,
  criarFeriadoFn,
  atualizarFeriadoFn,
  definirFeriadoAtivoFn,
  excluirFeriadoFn,
  type LocalidadeInput,
  type LocalidadeUpdateInput,
  type FeriadoInput,
  type FeriadoUpdateInput,
} from "@/services/calendario.functions";
import { cn } from "@/lib/utils";

/**
 * Calendário da instalação: localidades e feriados.
 *
 * É o que faz o cronograma respeitar o feriado municipal de cada
 * unidade. Sem este cadastro, o sistema trata a empresa inteira como se
 * estivesse numa cidade só — que é como ele funcionava antes.
 *
 * Fica em Administração porque muda as datas de todo projeto da
 * empresa: é configuração de instalação, não decisão de quem toca um
 * projeto.
 */

const TIPOS: { valor: TipoFeriado; rotulo: string }[] = [
  { valor: "nacional", rotulo: "Nacional" },
  { valor: "estadual", rotulo: "Estadual / regional" },
  { valor: "municipal", rotulo: "Municipal" },
];

const ROTULO_TIPO = new Map(TIPOS.map((t) => [t.valor, t.rotulo]));

/** "YYYY-MM-DD" para o input de data, sem passar pelo fuso. */
function paraCampo(d: Date | string): string {
  const data = new Date(d);
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${m}-${dia}`;
}

/**
 * Data exibida na lista.
 *
 * O recorrente mostra só dia e mês: o ano gravado nele é marcador, e
 * exibi-lo faria parecer que o Natal de 2000 está cadastrado por engano.
 */
function formatar(d: Date | string, recorrente: boolean): string {
  const data = new Date(d);
  const base = data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return recorrente ? base : `${base}/${data.getFullYear()}`;
}

export function PainelCalendario({ isAdmin }: { isAdmin: boolean }) {
  const [ano, setAno] = useState(new Date().getFullYear());

  const localidades = useQuery({
    queryKey: ["localidades-admin"],
    queryFn: () => listarLocalidadesAdminFn(),
  });

  const feriados = useQuery({
    queryKey: ["feriados", ano],
    queryFn: () => listarFeriadosFn({ data: { ano } }),
  });

  const lista = useMemo(() => localidades.data?.localidades ?? [], [localidades.data]);

  // Anos oferecidos: o atual e os dois seguintes. Feriado móvel é
  // cadastrado com antecedência; olhar para trás não muda cronograma.
  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Localidades</h2>
            <p className="text-xs text-muted-foreground">
              De onde as pessoas trabalham. Cada recurso aponta para uma, e é ela que decide quais
              feriados valem no cronograma dele.
            </p>
          </div>
          {isAdmin ? (
            <DialogoLocalidade
              trigger={
                <Button size="sm" className="gap-2">
                  <Plus className="size-4" /> Nova localidade
                </Button>
              }
            />
          ) : null}
        </div>

        {localidades.isPending ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </p>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Localidade</th>
                  <th className="px-4 py-2 font-medium">País / região</th>
                  <th className="w-24 px-4 py-2 font-medium">Recursos</th>
                  <th className="w-24 px-4 py-2 font-medium">Feriados</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <LinhaLocalidade key={l.id} item={l} isAdmin={isAdmin} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Feriados</h2>
            <p className="text-xs text-muted-foreground">
              Nacional vale para todos. Estadual e municipal só para a localidade que os cadastrou —
              é o que impede o feriado de uma cidade de parar o cronograma de outra.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anos.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin ? (
              <DialogoFeriado
                localidades={lista}
                trigger={
                  <Button size="sm" className="gap-2">
                    <Plus className="size-4" /> Novo feriado
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>

        {feriados.isPending ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </p>
        ) : (feriados.data?.feriados.length ?? 0) === 0 ? (
          <div className="panel px-5 py-8 text-center text-sm text-muted-foreground">
            Nenhum feriado cadastrado para {ano}. Sem feriados, o cronograma trata todo dia útil
            como dia de trabalho.
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-24 px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Feriado</th>
                  <th className="px-4 py-2 font-medium">Abrangência</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {(feriados.data?.feriados ?? []).map((f) => (
                  <LinhaFeriado key={f.id} item={f} localidades={lista} isAdmin={isAdmin} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------- localidades

function LinhaLocalidade({ item: l, isAdmin }: { item: Localidade; isAdmin: boolean }) {
  const qc = useQueryClient();
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["localidades-admin"] });
    qc.invalidateQueries({ queryKey: ["localidades"] });
    qc.invalidateQueries({ queryKey: ["feriados"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível alterar", { description: e.message });

  const eleger = useMutation({
    mutationFn: () => definirLocalidadePadraoFn({ data: { id: l.id } }),
    onSuccess: () => {
      invalidar();
      toast.success(`${l.nome} passou a ser a localidade padrão`, {
        description: "Vale para quem não tem localidade própria cadastrada.",
      });
    },
    onError: erro,
  });

  const alternar = useMutation({
    mutationFn: (ativo: boolean) => definirLocalidadeAtivaFn({ data: { id: l.id, ativo } }),
    onSuccess: invalidar,
    onError: erro,
  });

  return (
    <tr className={cn("border-b border-border/60", l.ativo ? "" : "opacity-60")}>
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          <MapPin className="size-3.5 text-muted-foreground" />
          {l.nome}
          {l.padrao ? (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Star className="size-3" /> padrão
            </Badge>
          ) : null}
        </span>
        {l.cidade ? (
          <span className="block pl-5 text-[11px] text-muted-foreground">{l.cidade}</span>
        ) : null}
      </td>
      <td className="px-4 py-2 text-muted-foreground">
        {l.pais}
        {l.regiao ? ` · ${l.regiao}` : ""}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{l.recursos}</td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{l.feriados}</td>
      <td className="px-4 py-2">
        {isAdmin ? (
          <span className="flex justify-end gap-1">
            {!l.padrao && l.ativo ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title="Tornar a localidade padrão"
                disabled={eleger.isPending}
                onClick={() => eleger.mutate()}
              >
                <Star className="size-3.5 text-muted-foreground" />
              </Button>
            ) : null}
            <DialogoLocalidade
              localidade={l}
              trigger={
                <Button variant="ghost" size="icon" className="size-7" title="Editar">
                  <Pencil className="size-3.5" />
                </Button>
              }
            />
            {/* A padrão não desativa: é para ela que todo mundo cai. */}
            {!l.padrao ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={l.ativo ? "Desativar" : "Reativar"}
                disabled={alternar.isPending}
                onClick={() => alternar.mutate(!l.ativo)}
              >
                {l.ativo ? (
                  <EyeOff className="size-3.5 text-muted-foreground" />
                ) : (
                  <Eye className="size-3.5 text-success" />
                )}
              </Button>
            ) : null}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

interface FormLocalidade {
  nome: string;
  pais: string;
  regiao: string;
  cidade: string;
}

const localidadeVazia: FormLocalidade = { nome: "", pais: "BR", regiao: "", cidade: "" };

function DialogoLocalidade({
  localidade,
  trigger,
}: {
  localidade?: Localidade | undefined;
  trigger: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormLocalidade>(localidadeVazia);

  useEffect(() => {
    if (!open) return;
    setForm(
      localidade
        ? {
            nome: localidade.nome,
            pais: localidade.pais,
            regiao: localidade.regiao ?? "",
            cidade: localidade.cidade ?? "",
          }
        : localidadeVazia,
    );
  }, [open, localidade]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["localidades-admin"] });
    qc.invalidateQueries({ queryKey: ["localidades"] });
    toast.success(localidade ? "Localidade atualizada" : "Localidade cadastrada");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: LocalidadeInput) => criarLocalidadeFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: LocalidadeUpdateInput) => atualizarLocalidadeFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;

  function salvar() {
    if (form.nome.trim().length < 2) {
      toast.error("Informe o nome da localidade.");
      return;
    }
    const payload: LocalidadeInput = {
      nome: form.nome.trim(),
      pais: form.pais.trim().toUpperCase() || "BR",
      regiao: form.regiao.trim() || null,
      cidade: form.cidade.trim() || null,
    };
    const id = localidade?.id;
    if (id) atualizar.mutate({ id, ...payload });
    else criar.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{localidade ? "Editar localidade" : "Nova localidade"}</DialogTitle>
          <DialogDescription>
            Uma localidade por lugar onde a empresa tem gente. É a ela que os feriados regionais e
            municipais se amarram.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="loc-nome">Nome</Label>
            <Input
              id="loc-nome"
              maxLength={160}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Matriz, Fábrica Caxias"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="loc-pais">País</Label>
              <Input
                id="loc-pais"
                maxLength={2}
                value={form.pais}
                onChange={(e) => setForm({ ...form, pais: e.target.value.toUpperCase() })}
                placeholder="BR"
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-regiao">Estado / região</Label>
              <Input
                id="loc-regiao"
                maxLength={80}
                value={form.regiao}
                onChange={(e) => setForm({ ...form, regiao: e.target.value })}
                placeholder="Ex.: RS, SP"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loc-cidade">Cidade</Label>
            <Input
              id="loc-cidade"
              maxLength={120}
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Duas letras no país (BR, PT, US). O campo de região aceita estado, província ou
              condado — o nome varia por país.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- feriados

function LinhaFeriado({
  item: f,
  localidades,
  isAdmin,
}: {
  item: Feriado;
  localidades: Localidade[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["feriados"] });
    qc.invalidateQueries({ queryKey: ["localidades-admin"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível alterar", { description: e.message });

  const alternar = useMutation({
    mutationFn: (ativo: boolean) => definirFeriadoAtivoFn({ data: { id: f.id, ativo } }),
    onSuccess: () => {
      invalidar();
      toast.success("Calendário atualizado", {
        description: "Os cronogramas passam a considerar a mudança no próximo recálculo.",
      });
    },
    onError: erro,
  });

  const excluir = useMutation({
    mutationFn: () => excluirFeriadoFn({ data: { id: f.id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Feriado excluído");
    },
    onError: erro,
  });

  return (
    <tr className={cn("border-b border-border/60", f.ativo ? "" : "opacity-60")}>
      <td className="px-4 py-2 font-mono text-xs">{formatar(f.data, f.recorrente)}</td>
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          {f.descricao}
          {f.recorrente ? (
            <Badge variant="outline" className="text-[10px]">
              todo ano
            </Badge>
          ) : null}
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">
        {ROTULO_TIPO.get(f.tipo) ?? f.tipo}
        {f.localidadeNome ? ` · ${f.localidadeNome}` : ""}
      </td>
      <td className="px-4 py-2">
        {isAdmin ? (
          <span className="flex justify-end gap-1">
            <DialogoFeriado
              feriado={f}
              localidades={localidades}
              trigger={
                <Button variant="ghost" size="icon" className="size-7" title="Editar">
                  <Pencil className="size-3.5" />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={f.ativo ? "Não parar neste ano" : "Reativar"}
              disabled={alternar.isPending}
              onClick={() => alternar.mutate(!f.ativo)}
            >
              {f.ativo ? (
                <EyeOff className="size-3.5 text-muted-foreground" />
              ) : (
                <Eye className="size-3.5 text-success" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Excluir"
              disabled={excluir.isPending}
              onClick={() => excluir.mutate()}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhuma__";

interface FormFeriado {
  data: string;
  descricao: string;
  tipo: TipoFeriado;
  recorrente: boolean;
  localidadeId: string;
}

const feriadoVazio: FormFeriado = {
  data: "",
  descricao: "",
  tipo: "nacional",
  recorrente: false,
  localidadeId: SEM,
};

function DialogoFeriado({
  feriado,
  localidades,
  trigger,
}: {
  feriado?: Feriado | undefined;
  localidades: Localidade[];
  trigger: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormFeriado>(feriadoVazio);

  useEffect(() => {
    if (!open) return;
    setForm(
      feriado
        ? {
            data: paraCampo(feriado.data),
            descricao: feriado.descricao,
            tipo: feriado.tipo,
            recorrente: feriado.recorrente,
            localidadeId: feriado.localidadeId ?? SEM,
          }
        : feriadoVazio,
    );
  }, [open, feriado]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["feriados"] });
    qc.invalidateQueries({ queryKey: ["localidades-admin"] });
    toast.success(feriado ? "Feriado atualizado" : "Feriado cadastrado", {
      description: "Os cronogramas passam a considerá-lo no próximo recálculo.",
    });
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: FeriadoInput) => criarFeriadoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: FeriadoUpdateInput) => atualizarFeriadoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;
  const precisaLocalidade = form.tipo !== "nacional";

  function salvar() {
    if (!form.data) {
      toast.error("Informe a data.");
      return;
    }
    if (form.descricao.trim().length < 3) {
      toast.error("Informe o nome do feriado.");
      return;
    }
    if (precisaLocalidade && form.localidadeId === SEM) {
      toast.error("Feriado estadual ou municipal precisa de uma localidade.");
      return;
    }

    const payload: FeriadoInput = {
      data: new Date(`${form.data}T00:00:00`),
      descricao: form.descricao.trim(),
      tipo: form.tipo,
      recorrente: form.recorrente,
      localidadeId: precisaLocalidade ? form.localidadeId : null,
    };

    const id = feriado?.id;
    if (id) atualizar.mutate({ id, ...payload });
    else criar.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{feriado ? "Editar feriado" : "Novo feriado"}</DialogTitle>
          <DialogDescription>
            Dia em que não se trabalha. O cronograma pula esses dias para quem está na localidade
            correspondente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="fer-data">Data</Label>
              <Input
                id="fer-data"
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fer-desc">Nome</Label>
              <Input
                id="fer-desc"
                maxLength={200}
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Ex.: Aniversário da cidade"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Abrangência</Label>
            <Select
              value={form.tipo}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  tipo: v as TipoFeriado,
                  // Voltar para nacional limpa a localidade: o banco a
                  // recusa nesse caso, e deixá-la escolhida esconderia
                  // o motivo do erro.
                  localidadeId: v === "nacional" ? SEM : form.localidadeId,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {precisaLocalidade ? (
            <div className="space-y-1.5">
              <Label>Localidade</Label>
              <Select
                value={form.localidadeId}
                onValueChange={(v) => setForm({ ...form, localidadeId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Selecione a localidade</SelectItem>
                  {localidades
                    .filter((l) => l.ativo)
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.nome}
                        {l.cidade ? ` · ${l.cidade}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Só quem está nesta localidade para de trabalhar neste dia.
              </p>
            </div>
          ) : null}

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              id="fer-recorrente"
              checked={form.recorrente}
              onCheckedChange={(v) => setForm({ ...form, recorrente: v })}
            />
            <div>
              <Label htmlFor="fer-recorrente" className="text-sm">
                Repete todo ano
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Para os de data fixa: Natal, Tiradentes, aniversário da cidade. Carnaval, Páscoa e
                Corpus Christi mudam de data e precisam de uma linha por ano.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
