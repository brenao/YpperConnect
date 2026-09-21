import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Recurso, TipoAusencia } from "@/repositories/recursos.repo";
import { listarEquipesFn } from "@/services/cadastros.functions";
import { SeletorUsuario } from "@/views/seletor-usuario";
import {
  criarRecursoFn,
  atualizarRecursoFn,
  listarLocalidadesFn,
  listarAusenciasFn,
  criarAusenciaFn,
  excluirAusenciaFn,
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
  localidadeId: string;
  disponibilidade: number;
}

const vazio: Form = {
  nome: "",
  usuarioId: SEM,
  papel: SEM,
  equipeId: SEM,
  localidadeId: SEM,
  disponibilidade: 50,
};

export function ResourceDialog({ resource, trigger }: { resource?: Recurso; trigger?: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const equipes = useQuery({
    queryKey: ["equipes"],
    queryFn: () => listarEquipesFn(),
    enabled: open,
  });

  const localidades = useQuery({
    queryKey: ["localidades"],
    queryFn: () => listarLocalidadesFn(),
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
            localidadeId: resource.localidadeId ?? SEM,
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

  const lista = localidades.data?.localidades ?? [];
  const padrao = lista.find((l) => l.padrao);

  /** Aceita o valor digitado, mas trava na faixa válida. */
  function definirDisponibilidade(valor: number) {
    if (!Number.isFinite(valor)) return;
    setForm((f) => ({
      ...f,
      disponibilidade: Math.min(100, Math.max(0, Math.round(valor))),
    }));
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
      localidadeId: form.localidadeId === SEM ? null : form.localidadeId,
      disponibilidadeProjetos: form.disponibilidade,
    };

    const idExistente = resource?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  /**
   * Escolher o usuário sugere nome e equipe, sem sobrescrever o que já
   * foi digitado: quem ajustou o nome à mão não quer perdê-lo.
   */
  function aoEscolherUsuario(id: string | null, u?: { nome: string; equipeId?: string | null }) {
    setForm((f) => ({
      ...f,
      usuarioId: id ?? SEM,
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
            <SeletorUsuario
              valor={form.usuarioId === SEM ? null : form.usuarioId}
              onMudar={aoEscolherUsuario}
              placeholder="Buscar pessoa..."
              rotuloVazio="Sem vínculo (terceiro, consultoria)"
            />
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

          {/* A localidade decide quais feriados valem para esta pessoa.
              Empresa de uma cidade só deixa no padrão e nunca mais olha
              para este campo. */}
          <div className="grid gap-2">
            <Label className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> Localidade
            </Label>
            <Select
              value={form.localidadeId}
              onValueChange={(v) => setForm({ ...form, localidadeId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>
                  {padrao ? `Padrão (${padrao.nome})` : "Localidade padrão"}
                </SelectItem>
                {lista
                  .filter((l) => !l.padrao)
                  .map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.nome}
                      {l.cidade ? ` · ${l.cidade}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Define os feriados que valem para esta pessoa no cronograma. Feriado municipal de uma
              cidade não tira o dia de quem trabalha em outra.
            </p>
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

// --------------------------------------------------------- ausências

const TIPOS: { valor: TipoAusencia; rotulo: string }[] = [
  { valor: "ferias", rotulo: "Férias" },
  { valor: "licenca_medica", rotulo: "Licença médica" },
  { valor: "licenca", rotulo: "Licença" },
  { valor: "treinamento", rotulo: "Treinamento" },
  { valor: "folga", rotulo: "Folga" },
  { valor: "outro", rotulo: "Outro" },
];

const ROTULO_TIPO = new Map(TIPOS.map((t) => [t.valor, t.rotulo]));

/** "YYYY-MM-DD" para o input de data, sem passar pelo fuso. */
function paraCampo(d: Date | string): string {
  const data = typeof d === "string" ? new Date(d) : d;
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${m}-${dia}`;
}

function formatar(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function diasEntre(inicio: Date | string, fim: Date | string): number {
  const a = new Date(inicio).setHours(0, 0, 0, 0);
  const b = new Date(fim).setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Conta o que a ausência de fato mexeu.
 *
 * O caso de zero é o que motivou isto: sem ser responsável por tarefa,
 * a pessoa pode ter férias impecavelmente cadastradas e nenhuma data
 * muda — e quem cadastrou conclui, com razão aparente, que o sistema
 * está quebrado. Dizer "nenhuma tarefa foi afetada" e o porquê custa
 * uma linha e evita a caçada.
 */
function descreverEfeito(efeito: { projetos: number; tarefas: number }): string {
  if (efeito.tarefas === 0) {
    return "Nenhuma tarefa foi afetada: esta pessoa não é responsável por tarefas em projetos ativos.";
  }
  const t = `${efeito.tarefas} tarefa${efeito.tarefas > 1 ? "s" : ""}`;
  const p = `${efeito.projetos} projeto${efeito.projetos > 1 ? "s" : ""}`;
  return `Cronograma recalculado: ${t} em ${p}.`;
}

/**
 * Ausências de uma pessoa: férias, licença, treinamento.
 *
 * É só registro — quem aprova férias é o RH, em outro sistema. O que
 * importa aqui é o cronograma saber que a pessoa não vai trabalhar
 * naquele período, e ele reage sozinho: as tarefas dela escorregam e,
 * por dependência, as sucessoras também.
 *
 * Por isso o aviso depois de salvar. É a primeira vez que um cadastro
 * fora do projeto mexe no cronograma de vários projetos de uma vez, e
 * quem cadastra precisa saber disso antes de ver as datas mudarem.
 */
export function DialogoAusencias({ recurso, trigger }: { recurso: Recurso; trigger: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoAusencia>("ferias");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [observacao, setObservacao] = useState("");

  const q = useQuery({
    queryKey: ["ausencias", recurso.id],
    queryFn: () => listarAusenciasFn({ data: { recursoId: recurso.id } }),
    enabled: open,
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ["ausencias", recurso.id] });
    // O cronograma mudou: as telas de projeto precisam reler.
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["projeto"] });
    qc.invalidateQueries({ queryKey: ["recursos"] });
  }

  const criar = useMutation({
    mutationFn: () =>
      criarAusenciaFn({
        data: {
          recursoId: recurso.id,
          tipo,
          inicio: new Date(`${inicio}T00:00:00`),
          fim: new Date(`${fim}T00:00:00`),
          observacao: observacao.trim() || null,
        },
      }),
    onSuccess: (r) => {
      invalidar();
      setInicio("");
      setFim("");
      setObservacao("");
      toast.success("Ausência registrada", {
        description: descreverEfeito(r.efeito),
      });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const excluir = useMutation({
    mutationFn: (id: string) => excluirAusenciaFn({ data: { id, recursoId: recurso.id } }),
    onSuccess: (r) => {
      invalidar();
      toast.success("Ausência removida", {
        description:
          r.efeito.tarefas > 0
            ? `Os dias voltaram a contar: ${descreverEfeito(r.efeito)}`
            : "Esta pessoa não tem tarefas em projetos ativos, então nenhuma data mudou.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  const ausencias = useMemo(() => q.data?.ausencias ?? [], [q.data]);
  const hoje = paraCampo(new Date());

  const podeSalvar = inicio !== "" && fim !== "" && fim >= inicio;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarOff className="size-4" /> Ausências de {recurso.nome}
          </DialogTitle>
          <DialogDescription>
            Dias em que a pessoa não trabalha. O cronograma pula esses dias e empurra as tarefas
            dela — e, por dependência, as que esperam por elas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-3">
            <div className="grid gap-2">
              <Label>Motivo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoAusencia)}>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="aus-inicio">Início</Label>
                <Input
                  id="aus-inicio"
                  type="date"
                  value={inicio}
                  min={undefined}
                  onChange={(e) => {
                    setInicio(e.target.value);
                    // Fim vazio ou anterior acompanha: o caso comum é um
                    // período curto, e quem digita o início raramente
                    // quer um fim antes dele.
                    if (fim === "" || fim < e.target.value) setFim(e.target.value);
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="aus-fim">Término</Label>
                <Input
                  id="aus-fim"
                  type="date"
                  value={fim}
                  min={inicio || undefined}
                  onChange={(e) => setFim(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="aus-obs">
                Observação <span className="text-xs text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="aus-obs"
                rows={2}
                maxLength={500}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: férias já aprovadas pelo RH"
              />
            </div>

            {podeSalvar ? (
              <p className="text-xs text-muted-foreground">
                {diasEntre(inicio, fim)} dia(s) corridos. O cronograma desconta só os dias úteis que
                caírem dentro do período.
              </p>
            ) : null}

            <Button
              size="sm"
              className="justify-self-start"
              disabled={!podeSalvar || criar.isPending}
              onClick={() => criar.mutate()}
            >
              {criar.isPending ? "Registrando..." : "Registrar ausência"}
            </Button>
          </div>

          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Registradas
            </h3>

            {q.isPending ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </p>
            ) : ausencias.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma ausência registrada para esta pessoa.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {ausencias.map((a) => {
                  const passada = paraCampo(a.fim) < hoje;
                  return (
                    <li
                      key={a.id}
                      className={`flex items-center gap-3 py-2 ${passada ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant="outline" className="text-[10px]">
                            {ROTULO_TIPO.get(a.tipo) ?? a.tipo}
                          </Badge>
                          <span className="font-mono">
                            {formatar(a.inicio)} — {formatar(a.fim)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {diasEntre(a.inicio, a.fim)}d
                          </span>
                        </p>
                        {a.observacao ? (
                          <p className="text-xs text-muted-foreground">{a.observacao}</p>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        title="Remover"
                        disabled={excluir.isPending}
                        onClick={() => excluir.mutate(a.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
