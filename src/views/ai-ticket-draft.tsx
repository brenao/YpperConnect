import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  PRIORITY_LABEL,
  TYPE_LABEL,
  resolvePriority,
  requiresSystem,
  type Impact,
  type RecordType,
  type Urgency,
} from "@/models/itsm-types";
import type { TicketDraft } from "@/services/ai-triage.functions";
import { criarChamadoFn, type NovoChamadoInput } from "@/services/chamados.functions";
import { listarServicosFn, listarSistemasFn } from "@/services/cadastros.functions";
import { PriorityBadge } from "./badges";

const TIPOS: RecordType[] = ["incidente", "requisicao", "melhoria", "tarefa"];
const IMPACTOS: Impact[] = ["alto", "medio", "baixo"];
const URGENCIAS: Urgency[] = ["alta", "media", "baixa"];

const SEM_SELECAO = "__nenhum__";

/**
 * Casa o nome devolvido pela IA com um registro do catálogo.
 *
 * A IA responde em texto livre ("ERP Protheus"), mas o banco precisa do
 * ID. A comparação ignora caixa e acento para tolerar variação, e devolve
 * null se não achar — nesse caso o usuário escolhe no select.
 */
function casarPorNome<T extends { id: string; nome: string }>(
  lista: T[] | undefined,
  nome: string | undefined | null,
): string | null {
  if (!lista?.length || !nome?.trim()) return null;
  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const alvo = normalizar(nome);
  const exato = lista.find((x) => normalizar(x.nome) === alvo);
  if (exato) return exato.id;
  const parcial = lista.find(
    (x) => normalizar(x.nome).includes(alvo) || alvo.includes(normalizar(x.nome)),
  );
  return parcial?.id ?? null;
}

export function AiTicketDraft({
  draft,
  loading,
  onDismiss,
  onCreated,
}: {
  draft: TicketDraft;
  loading?: boolean;
  onDismiss: () => void;
  /** Recebe o código legível do chamado criado (INC-1001). */
  onCreated: (codigo: string) => void;
}) {
  const qc = useQueryClient();
  const servicos = useQuery({ queryKey: ["servicos"], queryFn: () => listarServicosFn() });
  const sistemas = useQuery({ queryKey: ["sistemas"], queryFn: () => listarSistemasFn() });

  const [titulo, setTitulo] = useState(draft.titulo);
  const [descricao, setDescricao] = useState(draft.descricao);
  const [tipo, setTipo] = useState<RecordType>(draft.tipo);
  const [impacto, setImpacto] = useState<Impact>(draft.impacto);
  const [urgencia, setUrgencia] = useState<Urgency>(draft.urgencia);
  const [servicoId, setServicoId] = useState<string>(SEM_SELECAO);
  const [sistemaId, setSistemaId] = useState<string>(SEM_SELECAO);

  // O catálogo chega depois do rascunho, então a associação roda quando
  // as listas carregam — não na inicialização do estado.
  useEffect(() => {
    if (servicos.data && servicoId === SEM_SELECAO) {
      const id = casarPorNome(servicos.data, draft.servico);
      if (id) setServicoId(id);
    }
  }, [servicos.data, draft.servico, servicoId]);

  useEffect(() => {
    if (sistemas.data && sistemaId === SEM_SELECAO) {
      const id = casarPorNome(sistemas.data, draft.sistema);
      if (id) setSistemaId(id);
    }
  }, [sistemas.data, draft.sistema, sistemaId]);

  const prioridade = resolvePriority(impacto, urgencia);
  const sistemaObrigatorio = requiresSystem(tipo);
  const servicoSelecionado = servicos.data?.find((s) => s.id === servicoId);

  const criar = useMutation({
    mutationFn: (v: NovoChamadoInput) => criarChamadoFn({ data: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["chamados"] });
      toast.success(`${r.codigo} registrado pela IA`, {
        description: `Classificado como ${PRIORITY_LABEL[prioridade]} · ${TYPE_LABEL[tipo]}`,
      });
      onCreated(r.codigo);
    },
    onError: (e: Error) =>
      toast.error("Não foi possível registrar o chamado", { description: e.message }),
  });

  function registrar() {
    if (titulo.trim().length < 5) {
      toast.error("Descreva o título com pelo menos 5 caracteres.");
      return;
    }
    if (descricao.trim().length < 5) {
      toast.error("Descreva o caso com pelo menos 5 caracteres.");
      return;
    }
    if (sistemaObrigatorio && sistemaId === SEM_SELECAO) {
      toast.error(`Selecione o sistema afetado para ${TYPE_LABEL[tipo].toLowerCase()}.`);
      return;
    }

    criar.mutate({
      titulo: titulo.trim().slice(0, 300),
      descricao: descricao.trim(),
      tipo,
      // Categoria e equipe vêm do serviço: o catálogo é quem roteia.
      categoriaId: servicoSelecionado?.categoriaId ?? null,
      servicoId: servicoId === SEM_SELECAO ? null : servicoId,
      sistemaId: sistemaObrigatorio && sistemaId !== SEM_SELECAO ? sistemaId : null,
      impacto,
      urgencia,
      equipeId: servicoSelecionado?.equipeId ?? null,
      origem: "ia",
    });
  }

  const ocupado = loading || criar.isPending;

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
            <label className="text-xs text-muted-foreground">
              Sistema afetado <span className="text-destructive">*</span>
            </label>
            <Select value={sistemaId} onValueChange={setSistemaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o sistema" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Não identificado</SelectItem>
                {(sistemas.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.sistema && sistemaId === SEM_SELECAO ? (
              <p className="text-xs text-warning">
                A IA sugeriu &ldquo;{draft.sistema}&rdquo;, que não está no inventário. Escolha o
                equivalente.
              </p>
            ) : null}
          </div>
        )}

        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">Título</label>
          <Input value={titulo} maxLength={300} onChange={(e) => setTitulo(e.target.value)} />
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
            <Select value={servicoId} onValueChange={setServicoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SELECAO}>Não identificado</SelectItem>
                {(servicos.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
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

        {servicoSelecionado?.equipeNome ? (
          <p className="text-xs text-muted-foreground">
            Atendimento por{" "}
            <strong className="text-foreground">{servicoSelecionado.equipeNome}</strong>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" className="gap-2" disabled={ocupado} onClick={registrar}>
          {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Registrar chamado
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-2"
          disabled={criar.isPending}
          onClick={onDismiss}
        >
          <X className="size-4" />
          Descartar
        </Button>
      </div>
    </div>
  );
}
