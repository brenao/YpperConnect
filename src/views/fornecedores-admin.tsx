import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Eye, EyeOff, Loader2, Pencil, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { Fornecedor } from "@/repositories/recursos.repo";
import {
  listarFornecedoresFn,
  criarFornecedorFn,
  atualizarFornecedorFn,
  definirFornecedorAtivoFn,
  type FornecedorInput,
  type FornecedorUpdateInput,
} from "@/services/recursos.functions";
import { cn } from "@/lib/utils";

/**
 * Fornecedores: as empresas que fornecem gente para os projetos.
 *
 * Cadastro próprio, e não texto livre no papel do recurso, porque sem
 * ele "Operacional", "OPERACIONAL" e "Operacional LTDA" viram três
 * empresas na primeira semana — e aí nenhuma soma por fornecedor
 * fecha.
 *
 * Fica em Administração, ao lado de Localidades, pelo mesmo motivo:
 * é cadastro de instalação, não decisão de quem toca um projeto.
 */

function formatarCnpj(v: string | null): string {
  if (!v || v.length !== 14) return v ?? "—";
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
}

function formatarReal(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PainelFornecedores({ isAdmin }: { isAdmin: boolean }) {
  const q = useQuery({
    queryKey: ["fornecedores"],
    queryFn: () => listarFornecedoresFn(),
  });

  const lista = useMemo(() => q.data?.fornecedores ?? [], [q.data]);
  const terceiros = useMemo(() => lista.reduce((s, f) => s + f.recursos, 0), [lista]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Fornecedores</h2>
          <p className="text-xs text-muted-foreground">
            Empresas que fornecem gente para os projetos. Cada pessoa delas é cadastrada em
            Recursos, apontando para o fornecedor.
            {terceiros > 0 ? ` Hoje são ${terceiros} recurso(s) de terceiros.` : ""}
          </p>
        </div>
        {isAdmin ? (
          <DialogoFornecedor
            trigger={
              <Button size="sm" className="gap-2">
                <Plus className="size-4" /> Novo fornecedor
              </Button>
            }
          />
        ) : null}
      </div>

      {q.isPending ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </p>
      ) : lista.length === 0 ? (
        <div className="panel px-5 py-8 text-center text-sm text-muted-foreground">
          Nenhum fornecedor cadastrado. Enquanto não houver, todo recurso é tratado como interno e
          entra na capacidade da equipe.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Fornecedor</th>
                <th className="px-4 py-2 font-medium">Contato</th>
                <th className="w-28 px-4 py-2 font-medium">Custo/hora</th>
                <th className="w-24 px-4 py-2 font-medium">Pessoas</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <LinhaFornecedor key={f.id} item={f} isAdmin={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LinhaFornecedor({ item: f, isAdmin }: { item: Fornecedor; isAdmin: boolean }) {
  const qc = useQueryClient();

  const alternar = useMutation({
    mutationFn: (ativo: boolean) => definirFornecedorAtivoFn({ data: { id: f.id, ativo } }),
    onSuccess: (_r, ativo) => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      // Os recursos dele continuam ativos de propósito: contrato
      // encerrado não tira a pessoa do projeto no mesmo dia, e
      // desativar em cascata apagaria alocações sem aviso.
      toast.success(ativo ? "Fornecedor reativado" : "Fornecedor desativado", {
        description:
          !ativo && f.recursos > 0
            ? `${f.recursos} recurso(s) dele continuam ativos. Desative um a um em Recursos, se for o caso.`
            : undefined,
      });
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  return (
    <tr className={cn("border-b border-border/60", f.ativo ? "" : "opacity-60")}>
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
          {f.nome}
        </span>
        <span className="block pl-5 font-mono text-[11px] text-muted-foreground">
          {formatarCnpj(f.cnpj)}
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">
        {f.contatoNome ? (
          <>
            <span className="block">{f.contatoNome}</span>
            <span className="block text-[11px]">
              {[f.contatoEmail, f.contatoTelefone].filter(Boolean).join(" · ") || "—"}
            </span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
        {formatarReal(f.custoHoraPadrao)}
      </td>
      <td className="px-4 py-2">
        {f.recursos > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {f.recursos}
          </Badge>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">0</span>
        )}
      </td>
      <td className="px-4 py-2">
        {isAdmin ? (
          <span className="flex justify-end gap-1">
            <DialogoFornecedor
              fornecedor={f}
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
              title={f.ativo ? "Desativar" : "Reativar"}
              disabled={alternar.isPending}
              onClick={() => alternar.mutate(!f.ativo)}
            >
              {f.ativo ? (
                <EyeOff className="size-3.5 text-muted-foreground" />
              ) : (
                <Eye className="size-3.5 text-success" />
              )}
            </Button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

interface Form {
  nome: string;
  cnpj: string;
  contatoNome: string;
  contatoEmail: string;
  contatoTelefone: string;
  custoHoraPadrao: string;
  observacao: string;
}

const vazio: Form = {
  nome: "",
  cnpj: "",
  contatoNome: "",
  contatoEmail: "",
  contatoTelefone: "",
  custoHoraPadrao: "",
  observacao: "",
};

function DialogoFornecedor({
  fornecedor,
  trigger,
}: {
  fornecedor?: Fornecedor | undefined;
  trigger: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  useEffect(() => {
    if (!open) return;
    setForm(
      fornecedor
        ? {
            nome: fornecedor.nome,
            cnpj: fornecedor.cnpj ?? "",
            contatoNome: fornecedor.contatoNome ?? "",
            contatoEmail: fornecedor.contatoEmail ?? "",
            contatoTelefone: fornecedor.contatoTelefone ?? "",
            custoHoraPadrao:
              fornecedor.custoHoraPadrao === null
                ? ""
                : String(fornecedor.custoHoraPadrao).replace(".", ","),
            observacao: fornecedor.observacao ?? "",
          }
        : vazio,
    );
  }, [open, fornecedor]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["fornecedores"] });
    qc.invalidateQueries({ queryKey: ["recursos"] });
    toast.success(fornecedor ? "Fornecedor atualizado" : "Fornecedor cadastrado");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: FornecedorInput) => criarFornecedorFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: FornecedorUpdateInput) => atualizarFornecedorFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;

  function salvar() {
    if (form.nome.trim().length < 2) {
      toast.error("Informe o nome do fornecedor.");
      return;
    }

    const custo = form.custoHoraPadrao.replace(/\./g, "").replace(",", ".").trim();
    const custoNumero = custo === "" ? null : Number(custo);
    if (custoNumero !== null && (!Number.isFinite(custoNumero) || custoNumero < 0)) {
      toast.error("Custo por hora inválido.");
      return;
    }

    const payload: FornecedorInput = {
      nome: form.nome.trim(),
      cnpj: form.cnpj.replace(/\D/g, "") || null,
      contatoNome: form.contatoNome.trim() || null,
      contatoEmail: form.contatoEmail.trim() || null,
      contatoTelefone: form.contatoTelefone.trim() || null,
      custoHoraPadrao: custoNumero,
      observacao: form.observacao.trim() || null,
    };

    const id = fornecedor?.id;
    if (id) atualizar.mutate({ id, ...payload });
    else criar.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fornecedor ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          <DialogDescription>
            Depois de cadastrado, aponte as pessoas dele em Recursos. Elas recebem tarefa como
            qualquer outra, mas aparecem separadas nas contas de capacidade.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="for-nome">Nome</Label>
            <Input
              id="for-nome"
              maxLength={160}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Operacional"
            />
            <p className="text-xs text-muted-foreground">
              O nome é único. É o que impede a mesma empresa de virar duas por causa de uma letra
              maiúscula.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="for-cnpj">
                CNPJ <span className="text-xs text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="for-cnpj"
                inputMode="numeric"
                maxLength={18}
                className="font-mono"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value.replace(/\D/g, "") })}
                placeholder="00000000000000"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="for-custo">
                Custo/hora padrão <span className="text-xs text-muted-foreground">(opcional)</span>
              </Label>
              <span className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  id="for-custo"
                  inputMode="decimal"
                  className="pl-10 font-mono"
                  value={form.custoHoraPadrao}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      custoHoraPadrao: e.target.value.replace(/[^\d.,]/g, ""),
                    })
                  }
                  placeholder="0,00"
                />
              </span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            O custo/hora aqui é só sugestão: ao cadastrar uma pessoa deste fornecedor, o valor entra
            preenchido e pode ser trocado. Contrato de corpo costuma precificar por perfil, e a
            exceção por pessoa aparece sempre.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="for-contato">Contato</Label>
              <Input
                id="for-contato"
                maxLength={160}
                value={form.contatoNome}
                onChange={(e) => setForm({ ...form, contatoNome: e.target.value })}
                placeholder="Quem responde pelo contrato"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="for-email">E-mail</Label>
              <Input
                id="for-email"
                type="email"
                maxLength={320}
                value={form.contatoEmail}
                onChange={(e) => setForm({ ...form, contatoEmail: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="for-fone">Telefone</Label>
              <Input
                id="for-fone"
                maxLength={40}
                value={form.contatoTelefone}
                onChange={(e) => setForm({ ...form, contatoTelefone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="for-obs">
              Observação <span className="text-xs text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="for-obs"
              rows={2}
              maxLength={1000}
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
              placeholder="Ex.: contrato até 12/2026, renovação anual"
            />
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
