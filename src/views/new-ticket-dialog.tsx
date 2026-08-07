import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Loader2 } from "lucide-react";
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
import {
  PRIORITY_LABEL,
  TYPE_LABEL,
  requiresSystem,
  resolvePriority,
  type Impact,
  type RecordType,
  type Urgency,
} from "@/models/itsm-types";
import { criarChamadoFn, type NovoChamadoInput } from "@/services/chamados.functions";
import { listarServicosFn, listarSistemasFn, usuarioAtualFn } from "@/services/cadastros.functions";
import { PriorityBadge } from "./badges";

// Usuários finais não podem abrir registros do tipo "Problema".
const USER_TYPES: RecordType[] = ["incidente", "requisicao", "melhoria", "tarefa"];

/** Radix não aceita SelectItem com value vazio. */
const SEM_SELECAO = "__nenhum__";

export function NewTicketDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  // Só carrega catálogo quando o diálogo abre.
  const servicos = useQuery({
    queryKey: ["servicos"],
    queryFn: () => listarServicosFn(),
    enabled: open,
  });
  const sistemas = useQuery({
    queryKey: ["sistemas"],
    queryFn: () => listarSistemasFn(),
    enabled: open,
  });

  const isTi = usuario.data ? usuario.data.admin || usuario.data.equipeId !== null : false;
  const tiposDisponiveis: RecordType[] = isTi ? [...USER_TYPES, "problema"] : USER_TYPES;

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<RecordType>("incidente");
  const [servicoId, setServicoId] = useState<string>(SEM_SELECAO);
  const [sistemaId, setSistemaId] = useState<string>(SEM_SELECAO);
  const [impacto, setImpacto] = useState<Impact>("medio");
  const [urgencia, setUrgencia] = useState<Urgency>("media");

  const prioridade = resolvePriority(impacto, urgencia);
  const sistemaObrigatorio = requiresSystem(tipo);
  const servicoSelecionado = servicos.data?.find((s) => s.id === servicoId);

  const criar = useMutation({
    mutationFn: (v: NovoChamadoInput) => criarChamadoFn({ data: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["chamados"] });
      toast.success(`${r.codigo} registrado`, {
        description: `Classificado como ${PRIORITY_LABEL[prioridade]}`,
      });
      limpar();
      setOpen(false);
    },
    onError: (e: Error) =>
      toast.error("Não foi possível registrar o chamado", { description: e.message }),
  });

  function limpar() {
    setTitulo("");
    setDescricao("");
    setSistemaId(SEM_SELECAO);
  }

  function submit() {
    if (titulo.trim().length < 5) {
      toast.error("Descreva o título com pelo menos 5 caracteres.");
      return;
    }
    if (descricao.trim().length < 5) {
      toast.error("Descreva o que aconteceu com pelo menos 5 caracteres.");
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
      origem: "portal",
    });
  }

  const carregandoCatalogo = open && (servicos.isPending || sistemas.isPending);

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

        {carregandoCatalogo ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando catálogo...
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Classificação</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as RecordType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tiposDisponiveis.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sistemaObrigatorio && (
              <div className="grid gap-2">
                <Label>
                  Sistema afetado <span className="text-destructive">*</span>
                </Label>
                <Select value={sistemaId} onValueChange={setSistemaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o sistema" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_SELECAO}>Selecione o sistema</SelectItem>
                    {(sistemas.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sistemas.data?.length === 0 ? (
                  <p className="text-xs text-warning">
                    Nenhum sistema cadastrado. Cadastre em Administração antes de abrir este tipo de
                    chamado.
                  </p>
                ) : null}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="titulo">Título</Label>
              <Input
                id="titulo"
                maxLength={300}
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
                <Label>Serviço do catálogo</Label>
                <Select value={servicoId} onValueChange={setServicoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_SELECAO}>Selecione o serviço</SelectItem>
                    {(servicos.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
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

            {/* Solicitante deixou de ser texto livre: é o usuário autenticado. */}
            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              Abrindo como{" "}
              <strong className="text-foreground">{usuario.data?.nome ?? "..."}</strong>
              {servicoSelecionado?.equipeNome ? (
                <>
                  {" · atendimento por "}
                  <strong className="text-foreground">{servicoSelecionado.equipeNome}</strong>
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                Prioridade sugerida
              </span>
              <PriorityBadge value={prioridade} full />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={criar.isPending || carregandoCatalogo}>
            {criar.isPending ? "Registrando..." : "Registrar chamado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
