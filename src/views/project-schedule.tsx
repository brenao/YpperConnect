/**
 * Aba Cronograma: grade da WBS à esquerda, linha do tempo à direita.
 *
 * Os dois lados são uma tabela só, com as colunas da esquerda em
 * `position: sticky`. É o que garante que barra e linha nunca saiam de
 * registro: quem alinha é o próprio navegador. Dois contêineres com scroll
 * sincronizado por JS exigiria altura fixa de linha, e a linha daqui cresce
 * quando a tarefa tem atividade, folga ou predecessora para mostrar.
 *
 * Como as células fixas passam por cima da faixa do Gantt ao rolar, elas
 * precisam de fundo opaco — daí o `backgroundColor` explícito em vez do
 * `bg-secondary/20` translúcido que a linha usava antes.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CornerDownRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useHydrated } from "@/hooks/use-hydrated";
import { diasEntre, fmt, inicioDoDia, paraInput } from "@/lib/datas";
import { cn } from "@/lib/utils";
import type {
  BaselineTarefa,
  DadosCpm,
  Projeto,
  Tarefa,
  TarefaCalculada,
} from "@/repositories/projetos.repo";
import {
  atualizarCampoTarefaFn,
  inserirAbaixoFn,
  type CampoTarefaInput,
} from "@/services/projetos.functions";
import { BarraProjeto, BarraTarefa, CabecalhoGantt, MarcaHoje } from "@/views/project-gantt";
import {
  ZOOM_LABEL,
  estiloFundo,
  montarJanela,
  zoomSugerido,
  type JanelaGantt,
  type ZoomGantt,
} from "@/services/gantt-utils";

/** Colunas fixas. A soma é a largura congelada da esquerda. */
const COLUNAS = [
  { chave: "indice", rotulo: "#", largura: 76 },
  { chave: "nome", rotulo: "Tarefa", largura: 300 },
  { chave: "inicio", rotulo: "Início", largura: 104 },
  { chave: "fim", rotulo: "Término", largura: 104 },
  { chave: "progresso", rotulo: "%", largura: 92 },
] as const;

const DESLOCAMENTOS = COLUNAS.reduce<number[]>((acc, c, i) => {
  acc.push((acc[i - 1] ?? 0) + (i === 0 ? 0 : (COLUNAS[i - 1]?.largura ?? 0)));
  return acc;
}, []);

const LARGURA_GRADE = COLUNAS.reduce((s, c) => s + c.largura, 0);

const FUNDO_LINHA = "var(--card)";
const FUNDO_PAI = "color-mix(in oklch, var(--secondary) 35%, var(--card))";

/** Posição e fundo de uma célula congelada. */
function fixa(indice: number, ehPai: boolean): CSSProperties {
  return {
    left: `${DESLOCAMENTOS[indice] ?? 0}px`,
    backgroundColor: ehPai ? FUNDO_PAI : FUNDO_LINHA,
  };
}

const CLASSE_FIXA = "sticky z-20";
/** Última coluna congelada: a borda marca onde termina a grade. */
const CLASSE_BORDA = "border-r border-border";

export interface ProjectScheduleProps {
  projeto: Projeto;
  /** Já achatada: filhas logo abaixo da mãe, com o nível para indentar. */
  wbs: { tarefa: TarefaCalculada; nivel: number }[];
  cpm: Record<string, DadosCpm>;
  predecessoras: Record<string, string[]>;
  responsaveis: Record<string, string[]>;
  planejado: BaselineTarefa[];
  progressoProjeto: number;
  editavel: boolean;
  nomeRecurso: (id: string) => string;
  onDetalhe: (t: Tarefa) => void;
}

export function ProjectSchedule({
  projeto,
  wbs,
  cpm,
  predecessoras,
  responsaveis,
  planejado,
  progressoProjeto,
  editavel,
  nomeRecurso,
  onDetalhe,
}: ProjectScheduleProps) {
  const hidratado = useHydrated();
  const rolagem = useRef<HTMLDivElement>(null);

  const tarefas = useMemo(() => wbs.map((w) => w.tarefa), [wbs]);

  // Baseline indexada por tarefa: marca desvio de data na grade e desenha o
  // fio do plano original embaixo da barra.
  const planejadoPorTarefa = useMemo(() => {
    const m = new Map<string, { inicio: Date; fim: Date }>();
    for (const p of planejado) {
      m.set(p.tarefaId, { inicio: new Date(p.inicio), fim: new Date(p.fim) });
    }
    return m;
  }, [planejado]);

  const [zoom, setZoom] = useState<ZoomGantt>(() =>
    zoomSugerido(diasEntre(projeto.inicio, projeto.fim)),
  );

  const janela = useMemo(() => {
    const datas: (Date | string)[] = [projeto.inicio, projeto.fim];
    for (const t of tarefas) datas.push(t.inicioEfetivo, t.fimEfetivo);
    for (const p of planejado) datas.push(p.inicio, p.fim);
    return montarJanela(zoom, datas);
  }, [zoom, projeto.inicio, projeto.fim, tarefas, planejado]);

  // `hoje` só depois da hidratação: o servidor renderiza num instante e o
  // navegador em outro, e a marca vertical acusaria diferença de HTML.
  const hoje = hidratado ? inicioDoDia(new Date()) : null;

  const irParaHoje = () => {
    const el = rolagem.current;
    if (!el || !hoje) return;
    const dias = Math.round((hoje.getTime() - janela.inicio.getTime()) / 86_400_000);
    el.scrollTo({ left: Math.max(0, LARGURA_GRADE + dias * janela.px - el.clientWidth / 2) });
  };

  // Abre já mostrando o presente: em projeto longo, a rolagem começaria
  // no passado e a tela pareceria vazia.
  useEffect(() => {
    if (!hidratado) return;
    irParaHoje();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidratado, janela.largura]);

  const indicePorId = useMemo(() => {
    const m = new Map<string, number>();
    wbs.forEach(({ tarefa }, i) => m.set(tarefa.id, i + 1));
    return m;
  }, [wbs]);

  const criticas = Object.values(cpm).filter((c) => c.critica).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Clique em nome, datas e percentual para editar. Linhas com subtarefas mostram o
          consolidado e não são editáveis.
          {criticas > 0 ? (
            <>
              {" "}
              <span className="text-destructive">{criticas} tarefa(s) no caminho crítico</span> —
              atraso nelas empurra a entrega.
            </>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-md border border-border p-0.5">
            {(Object.keys(ZOOM_LABEL) as ZoomGantt[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  zoom === z
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ZOOM_LABEL[z]}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={irParaHoje} disabled={!hoje}>
            Hoje
          </Button>
        </div>
      </div>

      <div ref={rolagem} className="panel max-h-[70vh] overflow-auto">
        <table
          className="border-separate border-spacing-0 text-sm"
          style={{ tableLayout: "fixed", width: `${LARGURA_GRADE + janela.largura}px` }}
        >
          <colgroup>
            {COLUNAS.map((c) => (
              <col key={c.chave} style={{ width: `${c.largura}px` }} />
            ))}
            <col style={{ width: `${janela.largura}px` }} />
          </colgroup>

          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              {COLUNAS.map((c, i) => (
                <th
                  key={c.chave}
                  className={cn(
                    "sticky top-0 z-40 border-b border-border px-3 py-2 font-medium",
                    i === COLUNAS.length - 1 ? CLASSE_BORDA : "",
                  )}
                  style={fixa(i, false)}
                >
                  {c.rotulo}
                </th>
              ))}
              <th
                className="sticky top-0 z-30 border-b border-border p-0 align-bottom"
                style={{ backgroundColor: FUNDO_LINHA }}
              >
                <CabecalhoGantt janela={janela} hoje={hoje} />
              </th>
            </tr>
          </thead>

          <tbody>
            {/* Linha 0: o projeto. Dá a escala de leitura do cronograma. */}
            <tr className="font-medium">
              <td
                className={cn(
                  CLASSE_FIXA,
                  "border-b border-border px-2 py-2 font-mono text-xs text-muted-foreground",
                )}
                style={fixa(0, true)}
              >
                0
              </td>
              <td
                className={cn(CLASSE_FIXA, "border-b border-border px-3 py-2")}
                style={fixa(1, true)}
                title={projeto.nome}
              >
                <span className="block truncate">{projeto.nome}</span>
                {/* Duração e gerente vêm para cá porque as colunas próprias
                    deram lugar à faixa do Gantt. */}
                <span className="block truncate text-[11px] font-normal text-muted-foreground">
                  {diasEntre(projeto.inicio, projeto.fim)} d
                  {projeto.gerenteNome ? ` · ${projeto.gerenteNome}` : ""}
                </span>
              </td>
              <td
                className={cn(CLASSE_FIXA, "border-b border-border px-3 py-2 font-mono text-xs")}
                style={fixa(2, true)}
              >
                {fmt(projeto.inicio)}
              </td>
              <td
                className={cn(CLASSE_FIXA, "border-b border-border px-3 py-2 font-mono text-xs")}
                style={fixa(3, true)}
              >
                {fmt(projeto.fim)}
              </td>
              <td
                className={cn(
                  CLASSE_FIXA,
                  CLASSE_BORDA,
                  "border-b border-border px-3 py-2 font-mono text-xs",
                )}
                style={fixa(4, true)}
              >
                {progressoProjeto}%
              </td>
              <td
                className="relative border-b border-border p-0"
                style={{ ...estiloFundo(janela), backgroundColor: FUNDO_PAI }}
              >
                <div className="relative h-9">
                  <MarcaHoje janela={janela} hoje={hoje} />
                  <BarraProjeto
                    janela={janela}
                    inicio={projeto.inicio}
                    fim={projeto.fim}
                    progresso={progressoProjeto}
                  />
                </div>
              </td>
            </tr>

            {wbs.map(({ tarefa: t, nivel }, i) => (
              <LinhaCronograma
                key={t.id}
                indice={i + 1}
                tarefa={t}
                nivel={nivel}
                cpm={cpm[t.id]}
                janela={janela}
                hoje={hoje}
                predecessoras={(predecessoras[t.id] ?? []).map((p) => ({
                  indice: indicePorId.get(p) ?? 0,
                  nome: tarefas.find((x) => x.id === p)?.nome ?? "",
                }))}
                responsaveis={(responsaveis[t.id] ?? []).map(nomeRecurso)}
                planejado={planejadoPorTarefa.get(t.id)}
                editavel={editavel}
                onDetalhe={() => onDetalhe(t)}
              />
            ))}

            {wbs.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUNAS.length + 1}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Nenhuma tarefa. Use <strong>Nova tarefa</strong> para começar o cronograma.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Na linha do tempo: barra cheia é o andamento, o fio cinza abaixo é a baseline e o trecho
        vermelho do fio é o que passou do plano original. Losango é marco; vermelho é caminho
        crítico.
      </p>
    </div>
  );
}

function LinhaCronograma({
  indice,
  tarefa: t,
  nivel,
  cpm,
  janela,
  hoje,
  predecessoras,
  responsaveis,
  planejado,
  editavel,
  onDetalhe,
}: {
  indice: number;
  tarefa: TarefaCalculada;
  nivel: number;
  cpm: DadosCpm | undefined;
  janela: JanelaGantt;
  hoje: Date | null;
  predecessoras: { indice: number; nome: string }[];
  responsaveis: string[];
  planejado: { inicio: Date; fim: Date } | undefined;
  editavel: boolean;
  onDetalhe: () => void;
}) {
  const qc = useQueryClient();

  const salvarCampo = useMutation({
    mutationFn: (v: CampoTarefaInput) => atualizarCampoTarefaFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projeto", t.projetoId] });
      qc.invalidateQueries({ queryKey: ["projetos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const inserir = useMutation({
    mutationFn: (v: { referenciaId: string; comoFilha: boolean }) => inserirAbaixoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projeto", t.projetoId] }),
    onError: (e: Error) => toast.error("Não foi possível inserir", { description: e.message }),
  });

  const desvioFim =
    planejado && t.fimEfetivo.getTime() > planejado.fim.getTime()
      ? `Planejado para ${fmt(planejado.fim)}`
      : undefined;

  // Pai não é editável: seus valores vêm do rollup das filhas.
  const podeEditar = editavel && !t.ehPai;
  const critica = cpm?.critica ?? false;

  // Duração e responsáveis vivem aqui embaixo, não em coluna própria: cada
  // coluna a mais é largura congelada que o Gantt perde.
  const secundaria = [
    t.atividade ?? "",
    cpm ? `${cpm.duracaoDias} d` : "",
    critica ? "caminho crítico" : cpm && cpm.folgaDias > 0 ? `folga de ${cpm.folgaDias} d` : "",
    responsaveis.length && !t.ehPai ? responsaveis.join(", ") : "",
    predecessoras.length
      ? `após ${predecessoras.map((p) => `${p.indice}. ${p.nome}`).join(", ")}`
      : "",
  ].filter(Boolean);

  const fundo = fixa(0, t.ehPai).backgroundColor;

  return (
    <tr className="group">
      {/* Calha: número dá lugar aos botões no hover ou no foco da linha. */}
      <td
        className={cn(CLASSE_FIXA, "border-b border-border/60 px-2 py-1 align-top")}
        style={fixa(0, t.ehPai)}
      >
        <span className="flex h-7 items-center gap-0.5">
          <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{indice}</span>
          {editavel ? (
            <span className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                title="Inserir tarefa abaixo"
                disabled={inserir.isPending}
                onClick={() => inserir.mutate({ referenciaId: t.id, comoFilha: false })}
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                title="Inserir subtarefa"
                disabled={inserir.isPending}
                onClick={() => inserir.mutate({ referenciaId: t.id, comoFilha: true })}
              >
                <CornerDownRight className="size-3.5" />
              </Button>
            </span>
          ) : null}
        </span>
      </td>

      <td
        className={cn(CLASSE_FIXA, "border-b border-border/60 px-3 py-1")}
        style={fixa(1, t.ehPai)}
      >
        <span className="flex items-center gap-1.5" style={{ paddingLeft: `${nivel * 14}px` }}>
          {t.ehPai ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : null}
          {/* Marcador do caminho crítico: folga zero. */}
          {critica ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-destructive"
              title="Caminho crítico — atraso aqui empurra a entrega"
              aria-label="Caminho crítico"
            />
          ) : null}
          {editavel ? (
            <NomeInline
              valor={t.nome}
              negrito={t.ehPai}
              riscado={t.quadro === "done"}
              onSalvar={(v) => salvarCampo.mutate({ id: t.id, nome: v })}
              onDetalhe={onDetalhe}
            />
          ) : (
            <span
              className={cn(
                "truncate",
                t.ehPai ? "font-medium" : "",
                t.quadro === "done" ? "line-through opacity-70" : "",
              )}
            >
              {t.nome}
            </span>
          )}
          {t.marco ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              marco
            </Badge>
          ) : null}
          {t.ehPai ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              ({t.totalFolhas} subtarefa{t.totalFolhas > 1 ? "s" : ""})
            </span>
          ) : null}
        </span>

        {secundaria.length ? (
          <span
            className="mt-0.5 block truncate text-[11px] text-muted-foreground"
            style={{ paddingLeft: `${nivel * 14 + 14}px` }}
            title={secundaria.join(" · ")}
          >
            {secundaria.map((parte, i) => (
              <span key={i} className={parte === "caminho crítico" ? "text-destructive" : ""}>
                {i > 0 ? " · " : ""}
                {parte}
              </span>
            ))}
          </span>
        ) : null}
      </td>

      <td
        className={cn(CLASSE_FIXA, "border-b border-border/60 px-3 py-1 align-top")}
        style={fixa(2, t.ehPai)}
      >
        <CampoInline
          valor={paraInput(t.inicioEfetivo)}
          tipo="date"
          editavel={podeEditar}
          onSalvar={(v) => salvarCampo.mutate({ id: t.id, inicio: new Date(`${v}T12:00:00`) })}
        />
      </td>

      <td
        className={cn(CLASSE_FIXA, "border-b border-border/60 px-3 py-1 align-top")}
        style={fixa(3, t.ehPai)}
      >
        <CampoInline
          valor={paraInput(t.fimEfetivo)}
          tipo="date"
          editavel={podeEditar}
          alerta={desvioFim}
          onSalvar={(v) => salvarCampo.mutate({ id: t.id, fim: new Date(`${v}T12:00:00`) })}
        />
      </td>

      <td
        className={cn(CLASSE_FIXA, CLASSE_BORDA, "border-b border-border/60 px-3 py-1 align-top")}
        style={fixa(4, t.ehPai)}
      >
        <span className="flex items-center gap-2">
          <CampoInline
            valor={String(t.progressoEfetivo)}
            tipo="number"
            editavel={podeEditar}
            onSalvar={(v) => salvarCampo.mutate({ id: t.id, progresso: Number(v) })}
          />
          <Progress value={t.progressoEfetivo} className="h-1 w-8" />
        </span>
      </td>

      <td
        className="relative border-b border-border/60 p-0"
        style={{ ...estiloFundo(janela), backgroundColor: fundo }}
      >
        <div className="relative h-full min-h-9">
          <MarcaHoje janela={janela} hoje={hoje} />
          <BarraTarefa
            janela={janela}
            tarefa={t}
            cpm={cpm}
            planejado={planejado}
            responsaveis={responsaveis}
          />
        </div>
      </td>
    </tr>
  );
}

/**
 * Campo que salva ao sair (onBlur), não a cada tecla.
 *
 * Salvar por tecla geraria uma requisição por dígito e, num campo de
 * data, tentaria gravar "10/0" no meio da digitação. O rascunho local
 * volta ao valor do servidor quando a gravação falha.
 */
function CampoInline({
  valor,
  tipo,
  editavel,
  alerta,
  onSalvar,
}: {
  valor: string;
  tipo: "date" | "number";
  editavel: boolean;
  alerta?: string | undefined;
  onSalvar: (v: string) => void;
}) {
  const [rascunho, setRascunho] = useState(valor);

  // Se o servidor devolveu outro valor (rollup, rejeição), acompanha.
  useEffect(() => setRascunho(valor), [valor]);

  if (!editavel) {
    return (
      <span className={cn("font-mono text-xs", alerta ? "text-warning" : "text-muted-foreground")}>
        {tipo === "date" ? valor.split("-").reverse().join("/") : `${valor}%`}
      </span>
    );
  }

  return (
    <Input
      type={tipo}
      value={rascunho}
      min={tipo === "number" ? 0 : undefined}
      max={tipo === "number" ? 100 : undefined}
      title={alerta}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        if (rascunho !== valor && rascunho !== "") onSalvar(rascunho);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(valor);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-7 border-transparent bg-transparent px-1 font-mono text-xs hover:border-border focus:border-primary",
        alerta ? "text-warning" : "",
      )}
    />
  );
}

/**
 * Nome editável em linha. Diferente dos campos numéricos, precisa de
 * largura flexível e de um caminho para abrir o detalhe — daí o ícone
 * separado em vez de clique no texto, que conflitaria com o foco.
 */
function NomeInline({
  valor,
  negrito,
  riscado,
  onSalvar,
  onDetalhe,
}: {
  valor: string;
  negrito: boolean;
  riscado: boolean;
  onSalvar: (v: string) => void;
  onDetalhe: () => void;
}) {
  const [rascunho, setRascunho] = useState(valor);
  useEffect(() => setRascunho(valor), [valor]);

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        value={rascunho}
        maxLength={300}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          const v = rascunho.trim();
          if (v && v !== valor) onSalvar(v);
          else if (!v) setRascunho(valor);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setRascunho(valor);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-primary",
          negrito ? "font-medium" : "",
          riscado ? "line-through opacity-70" : "",
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title="Abrir detalhes"
        onClick={onDetalhe}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </span>
  );
}
