import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { TYPE_LABEL, type RecordType } from "@/models/itsm-types";
import type { Servico } from "@/repositories/catalogo.repo";
import {
  criarServicoFn,
  atualizarServicoFn,
  listarCategoriasFn,
  listarEquipesFn,
  type ServicoInput,
  type ServicoUpdateInput,
} from "@/services/cadastros.functions";

const TIPOS: RecordType[] = ["incidente", "requisicao", "melhoria", "tarefa"];

/** Radix não aceita SelectItem com value vazio. */
const SEM_SELECAO = "__nenhum__";

interface Form {
  nome: string;
  categoriaId: string;
  descricao: string;
  tipoPadrao: RecordType;
  slaHoras: number;
  equipeId: string;
}

const vazio: Form = {
  nome: "",
  categoriaId: SEM_SELECAO,
  descricao: "",
  tipoPadrao: "requisicao",
  slaHoras: 24,
  equipeId: SEM_SELECAO,
};

/** Cadastro e edição de itens do catálogo de serviços. */
export function ServiceDialog({ service, trigger }: { service?: Servico; trigger: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const categorias = useQuery({
    queryKey: ["categorias", "servico"],
    queryFn: () => listarCategoriasFn({ data: { escopo: "servico" } }),
    enabled: open,
  });
  const equipes = useQuery({
    queryKey: ["equipes"],
    queryFn: () => listarEquipesFn(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setForm(
      service
        ? {
            nome: service.nome,
            categoriaId: service.categoriaId ?? SEM_SELECAO,
            descricao: service.descricao ?? "",
            tipoPadrao: service.tipoPadrao,
            slaHoras: service.slaHoras,
            equipeId: service.equipeId ?? SEM_SELECAO,
          }
        : vazio,
    );
  }, [open, service]);

  function aoSalvar() {
    qc.invalidateQueries({ queryKey: ["servicos"] });
    qc.invalidateQueries({ queryKey: ["servicos-admin"] });
    toast.success(service ? "Serviço atualizado" : "Serviço criado");
    setOpen(false);
  }

  function aoErrar(e: Error) {
    toast.error("Não foi possível salvar", { description: e.message });
  }

  const criar = useMutation({
    mutationFn: (v: ServicoInput) => criarServicoFn({ data: v }),
    onSuccess: aoSalvar,
    onError: aoErrar,
  });

  const atualizar = useMutation({
    mutationFn: (v: ServicoUpdateInput) => atualizarServicoFn({ data: v }),
    onSuccess: aoSalvar,
    onError: aoErrar,
  });

  const salvando = criar.isPending || atualizar.isPending;

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do serviço.");
      return;
    }
    if (form.descricao.trim().length < 10) {
      toast.error("Descreva o serviço com pelo menos 10 caracteres.");
      return;
    }
    if (!Number.isFinite(form.slaHoras) || form.slaHoras <= 0) {
      toast.error("Informe um SLA maior que zero.");
      return;
    }

    const payload: ServicoInput = {
      nome: form.nome.trim(),
      categoriaId: form.categoriaId === SEM_SELECAO ? null : form.categoriaId,
      descricao: form.descricao.trim(),
      tipoPadrao: form.tipoPadrao,
      slaHoras: form.slaHoras,
      equipeId: form.equipeId === SEM_SELECAO ? null : form.equipeId,
    };

    if (service) atualizar.mutate({ id: service.id, ...payload });
    else criar.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>
            A equipe definida aqui recebe automaticamente os chamados abertos neste serviço.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="svc-nome">Nome</Label>
            <Input
              id="svc-nome"
              maxLength={200}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Acesso a sistemas"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="svc-desc">Descrição</Label>
            <Textarea
              id="svc-desc"
              rows={3}
              maxLength={1000}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="O que o usuário obtém ao solicitar este serviço"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Categoria</Label>
              <Select
                value={form.categoriaId}
                onValueChange={(v) => setForm({ ...form, categoriaId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_SELECAO}>Sem categoria</SelectItem>
                  {(categorias.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Equipe responsável</Label>
              <Select
                value={form.equipeId}
                onValueChange={(v) => setForm({ ...form, equipeId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_SELECAO}>Sem equipe</SelectItem>
                  {(equipes.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Classificação padrão</Label>
              <Select
                value={form.tipoPadrao}
                onValueChange={(v) => setForm({ ...form, tipoPadrao: v as RecordType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="svc-sla">SLA de solução (horas úteis)</Label>
              <Input
                id="svc-sla"
                type="number"
                min={1}
                max={9999}
                value={form.slaHoras}
                onChange={(e) => setForm({ ...form, slaHoras: Number(e.target.value) })}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            O SLA conta em horário comercial, respeitando expediente e feriados. 24 horas úteis
            equivalem a três dias de trabalho.
          </p>
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
