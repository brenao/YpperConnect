import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus } from "lucide-react";
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
  MOEDA_LABEL,
  PROJECT_STATUS_LABEL,
  formatarValor,
  type Moeda,
  type ProjectStatus,
} from "@/models/itsm-types";
import type { Projeto } from "@/repositories/projetos.repo";
import {
  criarProjetoFn,
  atualizarProjetoFn,
  type ProjetoInput,
  type ProjetoUpdateInput,
} from "@/services/projetos.functions";
import { SeletorUsuario } from "@/views/seletor-usuario";
import { Switch } from "@/components/ui/switch";
import {
  ESFORCOS,
  PISO_PROJETO,
  VALORES,
  calcularScore,
  pedeDivisao,
  type ModeloPriorizacao,
} from "@/services/priorizacao";
import { cn } from "@/lib/utils";

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

interface Form {
  nome: string;
  objetivo: string;
  sponsorId: string;
  gerenteId: string;
  status: ProjectStatus;
  usaDiasUteis: boolean;
  sigiloso: boolean;
  /**
   * Centavos, só dígitos. Guardar o valor formatado obrigaria a
   * reinterpretar a máscara a cada tecla, e o cursor saltaria.
   */
  capex: string;
  moeda: Moeda;
  areaDemandante: string;
  justificativa: string;
  valor: number | null;
  esforco: number | null;
  alcance: number | null;
  confianca: number | null;
}

const vazio = (status: ProjectStatus): Form => ({
  nome: "",
  objetivo: "",
  sponsorId: SEM,
  gerenteId: SEM,
  status,
  usaDiasUteis: true,
  // Nasce aberto. Sigilo é exceção, e exceção que vem marcada por
  // padrão deixa de ser exceção — em pouco tempo metade da carteira
  // estaria invisível sem ninguém ter decidido isso.
  sigiloso: false,
  capex: "",
  moeda: "BRL",
  areaDemandante: "",
  justificativa: "",
  valor: null,
  esforco: null,
  alcance: null,
  confianca: 80,
});

/**
 * Cadastro de projeto, um só para backlog e execução.
 *
 * Os campos são idênticos nos dois casos de propósito. Dois formulários
 * diferentes fariam a promoção do backlog perder informação ou pedir de
 * novo o que já tinha sido preenchido — e o projeto que nasce direto em
 * planejamento ficaria sem a justificativa que sustenta a decisão.
 *
 * O que muda entre os dois é só a ênfase: no backlog a priorização vem
 * aberta, porque é o que se está decidindo ali.
 */
export function ProjectDialog({
  project,
  trigger,
  statusInicial = "planejamento",
  modelo = "simples",
  aoSalvar,
  open: openProp,
  onOpenChange,
}: {
  /**
   * `| undefined` explícito em todas as opcionais: sob
   * `exactOptionalPropertyTypes`, `prop?: T` recusa quem passa
   * `undefined` de propósito — que é justamente o caso da lista, cujo
   * estado é `Projeto | undefined` enquanto nenhuma linha está aberta.
   */
  project?: Projeto | undefined;
  trigger?: ReactNode | undefined;
  /** Estado em que o projeto nasce. O backlog cria já em "backlog". */
  statusInicial?: ProjectStatus | undefined;
  modelo?: ModeloPriorizacao | undefined;
  aoSalvar?: (() => void) | undefined;
  /**
   * Controle externo, para a lista abrir a edição pelo clique na linha.
   *
   * Mesma solução do diálogo de usuário em Administração: uma única
   * instância montada para a lista inteira, em vez de um Dialog por
   * linha esperando um clique que quase nunca vem. Sem os dois, o
   * componente se vira sozinho com o próprio estado.
   */
  open?: boolean | undefined;
  onOpenChange?: ((v: boolean) => void) | undefined;
}) {
  const qc = useQueryClient();
  const [interno, setInterno] = useState(false);
  const open = openProp ?? interno;
  const setOpen = onOpenChange ?? setInterno;
  const [form, setForm] = useState<Form>(() => vazio(statusInicial));

  /**
   * "Menos de 2 semanas" marcado.
   *
   * Não vai para o banco: o que se grava é esforço nulo, porque aquilo
   * não tem tamanho de projeto. O estado existe só para o aviso
   * continuar na tela enquanto a pessoa decide o que fazer — sem ele, o
   * clique não deixaria rastro nenhum e pareceria não ter funcionado.
   */
  const [abaixoDoPiso, setAbaixoDoPiso] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAbaixoDoPiso(false);
    setForm(
      project
        ? {
            nome: project.nome,
            objetivo: project.objetivo ?? "",
            sponsorId: project.sponsorId ?? SEM,
            gerenteId: project.gerenteId ?? SEM,
            status: project.status,
            usaDiasUteis: project.usaDiasUteis,
            sigiloso: project.sigiloso ?? false,
            // Reais para centavos: 1500 gravado vira "150000" digitado.
            capex: project.capex === null ? "" : String(Math.round(Number(project.capex) * 100)),
            moeda: project.moeda === "USD" ? "USD" : "BRL",
            areaDemandante: project.areaDemandante ?? "",
            justificativa: project.justificativa ?? "",
            valor: project.valor,
            esforco: project.esforco,
            alcance: project.alcance,
            confianca: project.confianca ?? 80,
          }
        : vazio(statusInicial),
    );
  }, [open, project, statusInicial]);

  const noBacklog = form.status === "backlog";

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["projeto", project?.id] });
    // O sigilo muda quem enxerga o quê: o conjunto de ids com acesso
    // que o backlog carregou precisa ser refeito.
    qc.invalidateQueries({ queryKey: ["ids-com-acesso"] });
    toast.success(project ? "Projeto atualizado" : "Projeto criado");
    aoSalvar?.();
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: ProjetoInput) => criarProjetoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: ProjetoUpdateInput) => atualizarProjetoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;
  const score = calcularScore(modelo, form);

  /**
   * Valor em unidades da moeda: os centavos digitados divididos por 100.
   *
   * Campo vazio devolve `null`, não zero — "não informado" e "sem
   * desembolso" são afirmações diferentes.
   */
  const capexNumero = form.capex === "" ? null : Number(form.capex) / 100;

  /**
   * Máscara financeira: quem digita preenche os centavos primeiro.
   *
   * É como todo campo de valor se comporta: digitar 1, 5, 0, 0 mostra
   * 15,00, e não 1500. Deixar o texto livre e formatar só na saída
   * fazia a pessoa digitar "1.500" e descobrir depois que o sistema
   * entendeu outra coisa.
   *
   * O teto de 15 dígitos existe porque a coluna é NUMERIC(14,2): sem
   * ele, o banco recusaria o insert depois de a pessoa ter digitado.
   */
  function aoDigitarCapex(texto: string) {
    const digitos = texto
      .replace(/\D/g, "")
      .replace(/^0+(?=\d)/, "")
      .slice(0, 15);
    setForm((f) => ({ ...f, capex: digitos }));
  }

  /** O que aparece no campo: vazio continua vazio, para o placeholder. */
  const capexExibido =
    capexNumero === null
      ? ""
      : capexNumero.toLocaleString(form.moeda === "USD" ? "en-US" : "pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do projeto.");
      return;
    }

    const payload: ProjetoInput = {
      nome: form.nome.trim(),
      objetivo: form.objetivo.trim() || null,
      sponsorId: form.sponsorId === SEM ? null : form.sponsorId,
      gerenteId: form.gerenteId === SEM ? null : form.gerenteId,
      status: form.status,
      usaDiasUteis: form.usaDiasUteis,
      sigiloso: form.sigiloso,
      // Campo vazio é "não informado", não zero: zero significaria
      // projeto aprovado sem desembolso, que é outra afirmação.
      capex: capexNumero,
      moeda: capexNumero === null ? null : form.moeda,
      areaDemandante: form.areaDemandante.trim() || null,
      justificativa: form.justificativa.trim() || null,
      valor: form.valor,
      esforco: form.esforco,
      alcance: modelo === "rice" ? form.alcance : null,
      confianca: modelo === "rice" ? form.confianca : null,
    };

    const idExistente = project?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Controlado de fora não desenha gatilho: quem abre é a linha da
          lista, e um botão solto apareceria no meio da tela. */}
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : openProp === undefined ? (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-2">
            <Plus className="size-4" /> Novo projeto
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{project ? "Editar projeto" : "Novo projeto"}</DialogTitle>
          <DialogDescription>
            {noBacklog
              ? "Vai para o backlog: não cobra acompanhamento nem ocupa capacidade até ser priorizado."
              : "O cronograma e as tarefas são cadastrados depois, dentro do projeto."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="prj-nome">Nome do projeto</Label>
            <Input
              id="prj-nome"
              maxLength={300}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Migração do parque de estações"
            />
            {/* O aviso fica sob o nome porque é o nome que vaza: todo
                usuário enxerga o dos projetos não sigilosos. */}
            <p className="text-xs text-muted-foreground">
              {form.sigiloso
                ? "Projeto sigiloso: nem o nome aparece para quem não tem acesso."
                : "Todos os usuários verão este nome no backlog — é o que evita cadastro em duplicidade."}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prj-obj">Objetivo</Label>
            <Textarea
              id="prj-obj"
              rows={3}
              maxLength={4000}
              value={form.objetivo}
              onChange={(e) => setForm({ ...form, objetivo: e.target.value })}
              placeholder="Que resultado de negócio este projeto entrega"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prj-area">Área demandante</Label>
            <Input
              id="prj-area"
              maxLength={160}
              value={form.areaDemandante}
              onChange={(e) => setForm({ ...form, areaDemandante: e.target.value })}
              placeholder="Ex.: Comercial"
            />
          </div>

          {/* Gerente e patrocinador ocupam a linha inteira: a lista de
              busca tem a largura do campo, e em meia coluna os nomes
              apareciam cortados. */}
          <div className="grid gap-2">
            <Label htmlFor="prj-gerente">Gerente do projeto</Label>
            <SeletorUsuario
              id="prj-gerente"
              valor={form.gerenteId === SEM ? null : form.gerenteId}
              onMudar={(v) => setForm({ ...form, gerenteId: v ?? SEM })}
              placeholder="Eu mesmo"
              rotuloVazio="Eu mesmo"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prj-sponsor">Patrocinador</Label>
            <SeletorUsuario
              id="prj-sponsor"
              valor={form.sponsorId === SEM ? null : form.sponsorId}
              onMudar={(v) => setForm({ ...form, sponsorId: v ?? SEM })}
              placeholder="Não definido"
              rotuloVazio="Não definido"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prj-just">Por que precisa ser feito</Label>
            <Textarea
              id="prj-just"
              rows={2}
              maxLength={4000}
              value={form.justificativa}
              onChange={(e) => setForm({ ...form, justificativa: e.target.value })}
              placeholder="O problema que resolve, ou o que acontece se não for feito"
            />
            {/* É o campo que se lê na hora de recusar ou adiar. */}
            <p className="text-xs text-muted-foreground">
              Sustenta a decisão quando o projeto for priorizado, adiado ou recusado.
            </p>
          </div>

          {/* ----------------------------------------------------- sigilo */}
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 transition-colors",
              form.sigiloso ? "border-warning/50 bg-warning/5" : "border-border bg-surface",
            )}
          >
            <Switch
              id="prj-sigiloso"
              checked={form.sigiloso}
              onCheckedChange={(v) => setForm({ ...form, sigiloso: v })}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="prj-sigiloso" className="flex items-center gap-1.5 text-sm">
                <Lock className="size-3.5" /> Projeto sigiloso
              </Label>
              <span className="text-xs text-muted-foreground">
                Some da carteira para quem não participa: nem o nome aparece, e ninguém consegue
                pedir acesso a ele. Use para aquisição, reestruturação e afins — o preço é que outra
                área pode cadastrar a mesma coisa sem saber.
              </span>
              {form.sigiloso ? (
                <span className="mt-1 text-xs text-warning">
                  Gerente, patrocinador e responsáveis por tarefa continuam enxergando. Os demais
                  entram um a um, pela aba Acesso do projeto.
                </span>
              ) : null}
            </div>
          </div>

          {/* Investimento fica fora do bloco de priorização: é
              informação de orçamento, não critério de fila. */}
          <div className="grid gap-2">
            <Label htmlFor="prj-capex">Investimento previsto (CAPEX)</Label>
            <div className="flex gap-2">
              <span className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {form.moeda === "USD" ? "US$" : "R$"}
                </span>
                <Input
                  id="prj-capex"
                  inputMode="numeric"
                  value={capexExibido}
                  onChange={(e) => aoDigitarCapex(e.target.value)}
                  placeholder="0,00"
                  className="pl-11 text-right font-mono"
                />
              </span>
              <Select
                value={form.moeda}
                onValueChange={(v) => setForm({ ...form, moeda: v as Moeda })}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MOEDA_LABEL) as Moeda[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MOEDA_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {capexNumero === null
                ? "Deixe em branco quando o projeto é esforço interno, sem desembolso."
                : `${formatarValor(capexNumero, form.moeda)} — a moeda fica gravada junto, sem conversão.`}
            </p>
          </div>

          {/* ------------------------------------------------ priorização */}
          <div className="grid gap-4 rounded-lg border border-border bg-surface p-3">
            <div className="grid gap-2">
              <Label>Valor para o negócio</Label>
              <Select
                value={form.valor === null ? "" : String(form.valor)}
                onValueChange={(v) => setForm({ ...form, valor: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Ainda não avaliado" />
                </SelectTrigger>
                <SelectContent>
                  {VALORES.map((v) => (
                    <SelectItem key={v.valor} value={String(v.valor)}>
                      {v.valor} · {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {modelo === "rice" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="prj-alcance">Alcance</Label>
                    <Input
                      id="prj-alcance"
                      type="number"
                      min={0}
                      value={form.alcance ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          alcance: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="Pessoas afetadas"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="prj-conf">Confiança (%)</Label>
                    <Input
                      id="prj-conf"
                      type="number"
                      min={0}
                      max={100}
                      value={form.confianca ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          confianca: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="prj-esforco">Esforço (pessoa-dias)</Label>
                  <Input
                    id="prj-esforco"
                    type="number"
                    min={1}
                    value={form.esforco ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        esforco: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label>Tamanho do projeto</Label>
                {/* Duas colunas no estreito: quatro botões lado a lado
                    espremem a descrição da faixa, que é o que faz a
                    pessoa escolher certo. */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ESFORCOS.map((e) => (
                    <button
                      key={e.valor}
                      type="button"
                      onClick={() => {
                        setAbaixoDoPiso(false);
                        setForm((f) => ({
                          ...f,
                          esforco: f.esforco === e.valor ? null : e.valor,
                        }));
                      }}
                      aria-pressed={form.esforco === e.valor}
                      className={cn(
                        "rounded-md border p-2 text-left transition-colors",
                        form.esforco === e.valor
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <span className="block text-sm font-semibold">{e.rotulo}</span>
                      <span className="block text-[11px] text-muted-foreground">{e.descricao}</span>
                    </button>
                  ))}
                </div>

                {/* O piso: a fronteira entre projeto e demanda
                    operacional. Fica como opção de igual peso, e não
                    escondido num link, porque é a escolha certa para
                    boa parte do que chega ao backlog. */}
                <button
                  type="button"
                  onClick={() => {
                    setAbaixoDoPiso((v) => !v);
                    setForm((f) => ({ ...f, esforco: null }));
                  }}
                  aria-pressed={abaixoDoPiso}
                  className={cn(
                    "rounded-md border p-2 text-left text-xs transition-colors",
                    abaixoDoPiso
                      ? "border-warning bg-warning/10"
                      : "border-dashed border-border text-muted-foreground hover:border-warning/40",
                  )}
                >
                  {PISO_PROJETO.rotulo}
                </button>
              </div>
            )}

            {abaixoDoPiso ? (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
                {PISO_PROJETO.aviso}
              </p>
            ) : null}

            {pedeDivisao(form.esforco) ? (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
                Acima de nove meses, a estimativa deixa de ser estimativa. Vale quebrar em fases que
                entreguem valor separadamente — cada uma vira um projeto com prazo que se consegue
                defender.
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              {score === null
                ? "Valor e tamanho definem a posição na fila do backlog. Podem ficar em branco."
                : `Score ${score}. É a sugestão de ordem — a fila final é arrastada à mão.`}
            </p>
          </div>

          {/* O período não é digitado: ele é o intervalo das tarefas.
              Dois campos editáveis permitiriam um projeto que termina
              em março com tarefa entregando em maio. */}
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-muted-foreground">
              O início e o término do projeto vêm das datas das tarefas do cronograma, e se ajustam
              sozinhos conforme elas mudam.
            </p>

            <div className="flex items-start gap-3">
              <Switch
                id="prj-dias-uteis"
                checked={form.usaDiasUteis}
                onCheckedChange={(v) => setForm({ ...form, usaDiasUteis: v })}
              />
              <div className="grid gap-0.5">
                <Label htmlFor="prj-dias-uteis" className="text-sm">
                  Cronograma em dias úteis
                </Label>
                <span className="text-xs text-muted-foreground">
                  Desligue apenas para projeto com equipe escalada no fim de semana — virada de
                  sistema, parada de fábrica. Feriados e finais de semana deixam de ser pulados.
                </span>
              </div>
            </div>
          </div>

          {/* A situação não está aqui: ela é o campo que mais muda depois
              que o projeto existe, e vive no próprio card da lista, a um
              clique. Editar em dois lugares só criaria divergência. */}
          <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
            {project ? (
              <>
                Situação atual: <strong>{PROJECT_STATUS_LABEL[project.status]}</strong>. Para
                alterá-la, use o seletor no card do projeto.
              </>
            ) : noBacklog ? (
              <>
                O projeto nasce no <strong>Backlog</strong>. Promova quando ele for priorizado, e aí
                começa o cronograma.
              </>
            ) : (
              <>
                O projeto nasce em <strong>Planejamento</strong>. Mude para Execução quando o
                cronograma estiver definido.
              </>
            )}
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
