import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Recurso } from "@/repositories/recursos.repo";
import { listarEquipesFn, listarUsuariosFn } from "@/services/cadastros.functions";
import {
  criarRecursoFn,
  atualizarRecursoFn,
  type RecursoInput,
  type RecursoUpdateInput,
} from "@/services/recursos.functions";

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

/** Jornada padrão. Fora do formulário: todo mundo trabalha 8h. */
const HORAS_DIA_PADRAO = 8;

/**
 * Papéis oferecidos na lista.
 *
 * É rótulo descritivo — diz o que a pessoa faz, aparece ao lado do nome
 * na escolha do responsável e na alocação. NÃO concede acesso: quem vê
 * o quê é perfil, em Perfis de acesso. Misturar os dois criaria alguém
 * marcado como "Gerente de portfólio" que não enxerga projeto nenhum.
 */
const PAPEIS = [
  "Analista",
  "Analista de Infraestrutura",
  "Analista de Sistemas",
  "Desenvolvedor",
  "DBA",
  "Suporte técnico",
  "Coordenador",
  "Gerente de Projetos",
  "Consultor externo",
] as const;

interface Form {
  nome: string;
  usuarioId: string;
  papel: string;
  equipeId: string;
  disponibilidade: number;
}

const vazio: Form = {
  nome: "",
  usuarioId: SEM,
  papel: SEM,
  equipeId: SEM,
  disponibilidade: 50,
};

export function ResourceDialog({ resource, trigger }: { resource?: Recurso; trigger?: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => listarUsuariosFn(),
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
      resource
        ? {
            nome: resource.nome,
            usuarioId: resource.usuarioId ?? SEM,
            // Papel gravado fora da lista (cadastro antigo, texto livre)
            // continua aparecendo: a lista o inclui dinamicamente em vez
            // de apagar o que já estava lá.
            papel: resource.papel ?? SEM,
            equipeId: resource.equipeId ?? SEM,
            disponibilidade: resource.disponibilidadeProjetos,
          }
        : vazio,
    );
  }, [open, resource]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["recursos"] });
    toast.success(resource ? "Recurso atualizado" : "Recurso cadastrado");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: RecursoInput) => criarRecursoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: RecursoUpdateInput) => atualizarRecursoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;

  // A jornada só é editável na exceção; o cálculo continua usando a do
  // recurso para não mentir sobre quem tem meio período.
  const horas = resource?.horasDia ?? HORAS_DIA_PADRAO;
  const capacidade = Math.round(((horas * form.disponibilidade) / 100) * 10) / 10;

  /** Aceita o valor digitado, mas trava na faixa válida. */
  function definirDisponibilidade(valor: number) {
    if (!Number.isFinite(valor)) return;
    setForm((f) => ({ ...f, disponibilidade: Math.min(100, Math.max(0, Math.round(valor))) }));
  }

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do recurso.");
      return;
    }

    const payload: RecursoInput = {
      nome: form.nome.trim(),
      usuarioId: form.usuarioId === SEM ? null : form.usuarioId,
      papel: form.papel === SEM ? null : form.papel,
      equipeId: form.equipeId === SEM ? null : form.equipeId,
      disponibilidadeProjetos: form.disponibilidade,
    };

    const idExistente = resource?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  /** Preencher o usuário sugere nome e equipe, se ainda estiverem vazios. */
  function aoEscolherUsuario(v: string) {
    const u = usuarios.data?.find((x) => x.id === v);
    setForm((f) => ({
      ...f,
      usuarioId: v,
      nome: f.nome.trim() === "" && u ? u.nome : f.nome,
      equipeId: f.equipeId === SEM && u?.equipeId ? u.equipeId : f.equipeId,
    }));
  }

  // Papel legado que não está na lista entra como opção própria, senão o
  // Select abriria sem seleção e salvaria null sem ninguém pedir.
  const papeis =
    form.papel !== SEM && !PAPEIS.includes(form.papel as (typeof PAPEIS)[number])
      ? [form.papel, ...PAPEIS]
      : [...PAPEIS];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-2">
            <Plus className="size-4" /> Externo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resource ? "Editar recurso" : "Novo recurso externo"}</DialogTitle>
          <DialogDescription>
            {resource
              ? "Define quanto da jornada da pessoa fica disponível para projetos. O restante permanece no atendimento de chamados."
              : "Para consultoria e terceiros sem conta no sistema. Quem já tem usuário entra por “Adicionar de usuários”, sem redigitar nada."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Vincular a um usuário</Label>
            <Select value={form.usuarioId} onValueChange={aoEscolherUsuario}>
              <SelectTrigger>
                <SelectValue placeholder="Opcional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem vínculo (terceiro, consultoria)</SelectItem>
                {(usuarios.data ?? [])
                  .filter((u) => u.ativo)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {form.usuarioId === SEM ? (
              <p className="text-xs text-muted-foreground">
                Sem vínculo, a pessoa não enxerga os projetos em que tem tarefa — é por ele que o
                sistema reconhece quem executa.
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="res-nome">Nome</Label>
            <Input
              id="res-nome"
              maxLength={200}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Papel</Label>
              <Select value={form.papel} onValueChange={(v) => setForm({ ...form, papel: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Não definido</SelectItem>
                  {papeis.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Equipe</Label>
              <Select
                value={form.equipeId}
                onValueChange={(v) => setForm({ ...form, equipeId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Sem equipe</SelectItem>
                  {(equipes.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Barra e número editam o mesmo valor: a barra serve ao ajuste
              grosso, o campo ao número exato que veio de uma conversa
              ("ele fica 30% em projeto"). */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="res-disp">Disponibilidade para projetos</Label>
              <span className="flex items-center gap-1">
                <Input
                  id="res-disp"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={form.disponibilidade}
                  onChange={(e) => definirDisponibilidade(Number(e.target.value))}
                  className="h-8 w-16 text-right font-mono"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[form.disponibilidade]}
              onValueChange={([v]) => definirDisponibilidade(v ?? 0)}
            />
            <p className="text-xs text-muted-foreground">
              Capacidade para projetos: <strong>{capacidade}h/dia</strong>. O restante (
              {Math.round((horas - capacidade) * 10) / 10}h) fica para atendimento.
              {horas !== HORAS_DIA_PADRAO ? ` Jornada de ${horas}h.` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              É este número que define quantos dias uma tarefa ocupa no cronograma: quem está metade
              do dia em sustentação leva o dobro do tempo na mesma tarefa.
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
