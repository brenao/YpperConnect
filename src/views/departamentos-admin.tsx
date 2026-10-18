import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Monitor, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { ConfirmarExclusao } from "@/views/confirmar-exclusao";
import type { Departamento } from "@/repositories/departamentos.repo";
import {
  listarDepartamentosFn,
  criarDepartamentoFn,
  atualizarDepartamentoFn,
  definirDepartamentoAtivoFn,
  vinculosDepartamentoFn,
  excluirDepartamentoFn,
} from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

/**
 * Departamentos da empresa.
 *
 * A marca "Departamento de TI" muda duas coisas no cadastro de usuário:
 * libera a equipe de TI e decide o perfil do cargo (analista da TI é
 * "Analista de TI"; de outra área, "Usuário final").
 */

const CHAVE = ["departamentos"];

export function PainelDepartamentos({ isAdmin }: { isAdmin: boolean }) {
  const q = useQuery({ queryKey: CHAVE, queryFn: () => listarDepartamentosFn() });
  const [excluindo, setExcluindo] = useState<Departamento | null>(null);
  const qc = useQueryClient();

  const vinculos = useQuery({
    queryKey: ["vinculos-departamento", excluindo?.id],
    queryFn: () => vinculosDepartamentoFn({ data: { id: excluindo!.id } }),
    enabled: excluindo !== null,
    staleTime: 0,
  });
  const excluir = useMutation({
    mutationFn: (id: string) => excluirDepartamentoFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE });
      setExcluindo(null);
      toast.success("Departamento excluído");
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const lista = q.data ?? [];
  const pessoas = vinculos.data?.pessoas ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Departamentos</h2>
          <p className="text-xs text-muted-foreground">
            Áreas da empresa. Quem é de um departamento de TI pode ter equipe de TI e recebe o
            perfil de TI do cargo escolhido.
          </p>
        </div>
        {isAdmin ? (
          <DialogoDepartamento
            trigger={
              <Button size="sm" className="gap-2">
                <Plus className="size-4" /> Novo departamento
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
          Nenhum departamento cadastrado.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Departamento</th>
                <th className="w-40 px-4 py-2 font-medium">Tipo</th>
                <th className="w-24 px-4 py-2 font-medium">Pessoas</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <LinhaDepartamento
                  key={d.id}
                  item={d}
                  isAdmin={isAdmin}
                  onExcluir={() => setExcluindo(d)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmarExclusao
        aberto={excluindo !== null}
        onAbertoChange={(v) => (v ? null : setExcluindo(null))}
        nome={excluindo?.nome ?? ""}
        verificando={vinculos.isPending}
        vinculos={pessoas > 0 ? [`${pessoas} pessoa${pessoas === 1 ? "" : "s"}`] : []}
        explicacao={
          <>
            O departamento deixa de aparecer na lista do cadastro de usuários. O registro continua
            guardado no histórico.
          </>
        }
        excluindo={excluir.isPending}
        onConfirmar={() => excluindo && excluir.mutate(excluindo.id)}
      />
    </div>
  );
}

function LinhaDepartamento({
  item: d,
  isAdmin,
  onExcluir,
}: {
  item: Departamento;
  isAdmin: boolean;
  onExcluir: () => void;
}) {
  const qc = useQueryClient();
  const alternar = useMutation({
    mutationFn: (ativo: boolean) => definirDepartamentoAtivoFn({ data: { id: d.id, ativo } }),
    onSuccess: (_r, ativo) => {
      qc.invalidateQueries({ queryKey: CHAVE });
      toast.success(ativo ? "Departamento reativado" : "Departamento desativado", {
        description:
          !ativo && d.pessoas > 0
            ? `${d.pessoas} pessoa(s) continuam nele. Ele só sai da lista para novos cadastros.`
            : undefined,
      });
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  return (
    <tr className={cn("border-b border-border/60", d.ativo ? "" : "opacity-60")}>
      <td className="px-4 py-2">{d.nome}</td>
      <td className="px-4 py-2">
        {d.ti ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Monitor className="size-3" /> Departamento de TI
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Área de negócio</span>
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{d.pessoas}</td>
      <td className="px-4 py-2">
        {isAdmin ? (
          <span className="flex justify-end gap-1">
            <DialogoDepartamento
              departamento={d}
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
              title={d.ativo ? "Desativar" : "Reativar"}
              disabled={alternar.isPending}
              onClick={() => alternar.mutate(!d.ativo)}
            >
              {d.ativo ? (
                <EyeOff className="size-3.5 text-muted-foreground" />
              ) : (
                <Eye className="size-3.5 text-success" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Excluir"
              onClick={onExcluir}
            >
              <Trash2 className="size-3.5 text-muted-foreground" />
            </Button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function DialogoDepartamento({
  departamento,
  trigger,
}: {
  departamento?: Departamento;
  trigger: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [ti, setTi] = useState(false);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTentou(false);
    setNome(departamento?.nome ?? "");
    setTi(departamento?.ti ?? false);
  }, [open, departamento]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (departamento) {
        await atualizarDepartamentoFn({ data: { id: departamento.id, nome: nome.trim(), ti } });
      } else {
        await criarDepartamentoFn({ data: { nome: nome.trim(), ti } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE });
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      toast.success(departamento ? "Departamento atualizado" : "Departamento cadastrado");
      setOpen(false);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const erroNome = nome.trim().length < 2 ? "Informe o nome do departamento." : null;

  function enviar() {
    setTentou(true);
    if (erroNome) return;
    salvar.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{departamento ? "Editar departamento" : "Novo departamento"}</DialogTitle>
          <DialogDescription>
            Renomear atualiza o departamento de todas as pessoas dele.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dep-nome">
              Nome <span className="text-destructive">*</span>
            </Label>
            <Input
              id="dep-nome"
              maxLength={80}
              value={nome}
              aria-invalid={tentou && erroNome !== null}
              className={
                tentou && erroNome
                  ? "border-destructive focus-visible:ring-destructive/40"
                  : undefined
              }
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? enviar() : null)}
            />
            {tentou && erroNome ? <p className="text-xs text-destructive">{erroNome}</p> : null}
          </div>
          <div className="flex items-start gap-3">
            <Switch id="dep-ti" checked={ti} onCheckedChange={setTi} />
            <div>
              <Label htmlFor="dep-ti" className="text-sm">
                Departamento de TI
              </Label>
              <p className="text-xs text-muted-foreground">
                Libera a equipe de TI e os perfis de TI para quem é deste departamento.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}