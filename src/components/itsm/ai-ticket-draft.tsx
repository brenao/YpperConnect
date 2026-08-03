import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useItsm } from "@/lib/itsm-store";
import {
  PRIORITY_LABEL,
  TYPE_LABEL,
  resolvePriority,
  type Impact,
  type RecordType,
  type Urgency,
  requiresSystem,
} from "@/lib/itsm-types";
import type { TicketDraft } from "@/lib/ai-triage.functions";
import { PriorityBadge } from "./badges";

const TIPOS: RecordType[] = ["incidente", "requisicao", "melhoria", "tarefa"];
const IMPACTOS: Impact[] = ["alto", "medio", "baixo"];
const URGENCIAS: Urgency[] = ["alta", "media", "baixa"];

export function AiTicketDraft({
  draft,
  loading,
  onDismiss,
  onCreated,
}: {
  draft: TicketDraft;
  loading?: boolean;
  onDismiss: () => void;
  onCreated: (id: string) => void;
}) {
  const { services, createTicket } = useItsm();
  const [titulo, setTitulo] = useState(draft.titulo);
  const [descricao, setDescricao] = useState(draft.descricao);
  const [tipo, setTipo] = useState<RecordType>(draft.tipo);
  const [servico, setServico] = useState(draft.servico);
  const [impacto, setImpacto] = useState<Impact>(draft.impacto);
  const [urgencia, setUrgencia] = useState<Urgency>(draft.urgencia);
  const [solicitante, setSolicitante] = useState("");
  const [sistema, setSistema] = useState(draft.sistema ?? "");

  const prioridade = resolvePriority(impacto, urgencia);
  const categoria = services.find((s) => s.nome === servico)?.categoria ?? "Geral";
  const sistemaObrigatorio = requiresSystem(tipo);

  function registrar() {
    if (titulo.trim().length < 5) {
      toast.error("Descreva o título com pelo menos 5 caracteres.");
      return;
    }
    if (sistemaObrigatorio && sistema.trim().length < 2) {
      toast.error(`Informe o nome do sistema para ${TYPE_LABEL[tipo].toLowerCase()}.`);
      return;
    }
    const ticket = createTicket({
      titulo: titulo.trim().slice(0, 140),
      descricao: descricao.trim().slice(0, 2000),
      tipo,
      categoria,
      servico,
      sistema: sistemaObrigatorio ? sistema.trim().slice(0, 80) : undefined,
      impacto,
      urgencia,
      solicitante: solicitante.trim().slice(0, 80) || "Usuário do portal",
      origem: "ia",
    });
    toast.success(`${ticket.id} registrado pela IA`, {
      description: `Classificado como ${PRIORITY_LABEL[ticket.prioridade]} · ${TYPE_LABEL[ticket.tipo]}`,
    });
    onCreated(ticket.id);
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Rascunho de chamado gerado pela IA</p>
          <p className="mt-1 text-xs text-muted-foreground">{draft.justificativa}</p>
        </div>
        <PriorityBadge value={prioridade} />
      </div>

      {draft.recomendaProblema ? (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          Possível recorrência detectada. A IA recomendará à equipe de TI avaliar a abertura de um
          registro de <strong>Problema</strong> — usuários finais não podem criar Problemas.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3">
        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">Classificação</label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as RecordType)}>
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
        {sistemaObrigatorio && (
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Sistema *</label>
            <Input
              value={sistema}
              maxLength={80}
              onChange={(e) => setSistema(e.target.value)}
              placeholder="Ex.: ERP TOTVS, Portal RH"
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">Título</label>
          <Input value={titulo} maxLength={140} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">Descrição</label>
          <Textarea
            rows={4}
            maxLength={2000}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Serviço</label>
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
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Impacto</label>
            <Select value={impacto} onValueChange={(v) => setImpacto(v as Impact)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPACTOS.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Urgência</label>
            <Select value={urgencia} onValueChange={(v) => setUrgencia(v as Urgency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {URGENCIAS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">Solicitante</label>
          <Input
            value={solicitante}
            maxLength={80}
            placeholder="Seu nome"
            onChange={(e) => setSolicitante(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" className="gap-2" disabled={loading} onClick={registrar}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Registrar chamado
        </Button>
        <Button size="sm" variant="ghost" className="gap-2" onClick={onDismiss}>
          <X className="size-4" />
          Descartar
        </Button>
      </div>
    </div>
  );
}