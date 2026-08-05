import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
import { useItsm } from "@/controllers/itsm-store";
import { TYPE_LABEL, type RecordType, type ServiceItem } from "@/models/itsm-types";

const TIPOS: RecordType[] = ["incidente", "requisicao", "melhoria", "tarefa"];

const vazio = {
  nome: "",
  categoria: "",
  descricao: "",
  tipoPadrao: "requisicao" as RecordType,
  slaHoras: 24,
  equipe: "Service Desk",
};

/** Cadastro e edição de itens do catálogo de serviços. */
export function ServiceDialog({
  service,
  trigger,
}: {
  service?: ServiceItem;
  trigger: ReactNode;
}) {
  const { addService, updateService, services } = useItsm();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(service ? { ...vazio, ...service } : vazio);

  useEffect(() => {
    if (open) setForm(service ? { ...vazio, ...service } : vazio);
  }, [open, service]);

  const categorias = [...new Set(services.map((s) => s.categoria))];

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do serviço.");
      return;
    }
    if (form.categoria.trim().length < 2) {
      toast.error("Informe a categoria.");
      return;
    }
    if (form.descricao.trim().length < 10) {
      toast.error("Descreva o serviço.");
      return;
    }
    const payload = {
      nome: form.nome.trim(),
      categoria: form.categoria.trim(),
      descricao: form.descricao.trim(),
      tipoPadrao: form.tipoPadrao,
      slaHoras: Number(form.slaHoras) || 24,
      equipe: form.equipe.trim() || "Service Desk",
    };
    if (service) {
      updateService(service.id, { ...payload, geradoPorIA: false });
      toast.success("Serviço atualizado");
    } else {
      addService(payload);
      toast.success("Serviço criado no catálogo");
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{service ? "Editar serviço" : "Novo serviço de catálogo"}</DialogTitle>
          <DialogDescription>
            Padronize nome, categoria, classificação, SLA e equipe responsável.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome do serviço</Label>
            <Input
              value={form.nome}
              maxLength={90}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Criação de acesso a sistema corporativo"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Input
              value={form.categoria}
              maxLength={40}
              list="catalogo-categorias"
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              placeholder="Acessos, Infraestrutura..."
            />
            <datalist id="catalogo-categorias">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
            <Label>SLA de solução (horas)</Label>
            <Input
              type="number"
              min={1}
              max={720}
              value={form.slaHoras}
              onChange={(e) => setForm({ ...form, slaHoras: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Equipe responsável</Label>
            <Input
              value={form.equipe}
              maxLength={40}
              onChange={(e) => setForm({ ...form, equipe: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Descrição para o usuário</Label>
            <Textarea
              rows={3}
              maxLength={400}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar}>{service ? "Salvar alterações" : "Criar serviço"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}