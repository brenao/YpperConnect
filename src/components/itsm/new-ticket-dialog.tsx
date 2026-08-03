import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
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
import { useItsm } from "@/lib/itsm-store";
import {
  PRIORITY_LABEL,
  TYPE_LABEL,
  resolvePriority,
  type Impact,
  type RecordType,
  type Urgency,
} from "@/lib/itsm-types";
import { PriorityBadge } from "./badges";

// Usuários finais não podem abrir registros do tipo "Problema".
const USER_TYPES: RecordType[] = ["incidente", "requisicao", "melhoria", "tarefa"];

export function NewTicketDialog() {
  const { services, createTicket } = useItsm();
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<RecordType>("incidente");
  const [servico, setServico] = useState(services[0]?.nome ?? "");
  const [impacto, setImpacto] = useState<Impact>("medio");
  const [urgencia, setUrgencia] = useState<Urgency>("media");
  const [solicitante, setSolicitante] = useState("");

  const prioridade = resolvePriority(impacto, urgencia);
  const categoria = services.find((s) => s.nome === servico)?.categoria ?? "Geral";

  function submit() {
    if (titulo.trim().length < 5) {
      toast.error("Descreva o título com pelo menos 5 caracteres.");
      return;
    }
    const ticket = createTicket({
      titulo: titulo.trim().slice(0, 140),
      descricao: descricao.trim().slice(0, 2000),
      tipo,
      categoria,
      servico,
      impacto,
      urgencia,
      solicitante: solicitante.trim().slice(0, 80) || "Usuário do portal",
      origem: "portal",
    });
    toast.success(`${ticket.id} registrado`, {
      description: `Classificado como ${PRIORITY_LABEL[ticket.prioridade]}`,
    });
    setOpen(false);
    setTitulo("");
    setDescricao("");
    setSolicitante("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          Abrir chamado
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Canal único de atendimento</DialogTitle>
          <DialogDescription>
            A prioridade é calculada automaticamente pela matriz de impacto × urgência.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="titulo">Título</Label>
            <Input
              id="titulo"
              maxLength={140}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: ERP indisponível na unidade matriz"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="descricao">Descrição</Label>
            <Textarea
              id="descricao"
              maxLength={2000}
              rows={3}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="O que aconteceu, desde quando e quantas pessoas foram afetadas"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Classificação</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as RecordType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Serviço do catálogo</Label>
              <Select value={servico} onValueChange={setServico}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.nome}>
                      {s.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Impacto</Label>
              <Select value={impacto} onValueChange={(v) => setImpacto(v as Impact)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alto">Alto · operação essencial</SelectItem>
                  <SelectItem value="medio">Médio · área ou processo</SelectItem>
                  <SelectItem value="baixo">Baixo · poucos usuários</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Urgência</Label>
              <Select value={urgencia} onValueChange={(v) => setUrgencia(v as Urgency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alta">Alta · sem alternativa</SelectItem>
                  <SelectItem value="media">Média · alternativa limitada</SelectItem>
                  <SelectItem value="baixa">Baixa · planejável</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="solicitante">Solicitante</Label>
            <Input
              id="solicitante"
              maxLength={80}
              value={solicitante}
              onChange={(e) => setSolicitante(e.target.value)}
              placeholder="Nome do solicitante"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              Prioridade sugerida
            </span>
            <PriorityBadge value={prioridade} full />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>Registrar chamado</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}