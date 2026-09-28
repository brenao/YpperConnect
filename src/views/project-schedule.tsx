/**
 * Aba Gantt: grade da WBS à esquerda, linha do tempo à direita.
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
 *
 * O nome da tarefa aqui é só leitura. Editar em dois lugares dobra a
 * superfície de erro sem dobrar a utilidade, e cada coluna larga que a
 * grade ocupa é linha do tempo que o Gantt perde — que é justamente o
 * que se vem ver nesta aba. Renomear é na aba Cronograma.
 *
 * A largura e a ordem das colunas são do usuário, e a preferência é a
 * mesma da aba Cronograma: as duas telas mostram a mesma grade, e
 * configurar duas vezes é o que faz ninguém configurar nenhuma.
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
  AlcaColuna,
  MenuColunas,
  useColunas,
  type ColunaAjustada,
  type DefColuna,
} from "@/views/colunas-ajustaveis";
import {
  ZOOM_LABEL,
  estiloFundo,
  montarJanela,
  zoomSugerido,
  type JanelaGantt,
  type ZoomGantt,
} from "@/services/gantt-utils";

/**
 * Colunas da grade congelada.
 *
 * As de data precisam caber `dd/mm/aaaa` e, em edição, o seletor nativo
 * do navegador — que reserva espaço para o ícone de calendário além do
 * texto. Com menos que isto o ano aparece cortado, e é por isso que a
 * largura mínima delas é maior que a das outras.
 *
 * A calha é presa: ela ancora a leitura da linha e é a primeira coluna
 * congelada. Movê-la deixaria os botões de inserir tarefa no meio da
 * grade.
 */
const COLUNAS_PADRAO: DefColuna[] = [
  { chave: "indice", rotulo: "#", largura: 76, presa: true, minima: 64 },
  { chave: "nome", rotulo: "Tarefa", largura: 300, minima: 160 },
  { chave: "inicio", rotulo: "Início", largura: 136, minima: 110 },
  { chave: "fim", rotulo: "Término", largura: 136, minima: 110 },
  { chave: "progresso", rotulo: "%", largura: 92, minima: 76 },
];

/**
 * Chave da preferência, compartilhada com a aba Cronograma.
 *
 * Mesmo nome de propósito: quem arruma as colunas numa tela espera
 * encontrar a outra igual.
 */
export const CHAVE_COLUNAS_CRONOGRAMA = "cronograma";

const FUNDO_LINHA = "var(--card)";
const FUNDO_PAI = "color-mix(in oklch, var(--secondary) 35%, var(--card))";

const CLASSE_FIXA = "sticky z-20";
/** Última coluna congelada: a borda marca onde termina a grade. */
const CLASSE_BORDA = "border-r border-border";

/** Deslocamento acumulado de cada coluna congelada. */
function deslocamentos(colunas: ColunaAjustada[]): number[] {
  const saida: number[] = [];
  let soma = 0;
  for (const c of colunas) {
    saida.push(soma);
    soma += c.largura;
  }
  return saida;
}

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

  const controle = useColunas(CHAVE_COLUNAS_CRONOGRAMA, COLUNAS_PADRAO);
  const colunas = controle.colunas;

  const offsets = useMemo(() => deslocamentos(colunas), [colunas]);
  const larguraGrade = useMemo(() => colunas.reduce((s, c) => s + c.largura, 0), [colunas]);

  /** Posição e fundo de uma célula congelada. */
  const fixa = (indice: number, ehPai: boolean): CSSProperties => ({
    left: `${offsets[indice] ?? 0}px`,
    backgroundColor: ehPai ? FUNDO_PAI : FUNDO_LINHA,
  });

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
    el.scrollTo({
      left: Math.max(0, larguraGrade + dias * janela.px - el.clientWidth / 2),
    });
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
          Clique nas datas e no percentual para editar. O nome se edita na aba Cronograma. Linhas
          com subtarefas mostram o consolidado e não são editáveis.
          {criticas > 0 ? (
            <>
              {" "}
              <span className="text-destructive">{criticas} tarefa(s) no caminho crítico</span> —
              atraso nelas empurra a entrega.
            </>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <MenuColunas controle={controle} />
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
          style={{
            tableLayout: "fixed",
            width: `${larguraGrade + janela.largura}px`,
          }}
        >
          <colgroup>
            {colunas.map((c) => (
              <col key={c.chave} style={{ width: `${c.largura}px` }} />
            ))}
            <col style={{ width: `${janela.largura}px` }} />
          </colgroup>

          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              {colunas.map((c, i) => (
                <th
                  key={c.chave}
                  className={cn(
                    "sticky top-0 z-40 border-b border-border px-3 py-2 font-medium",
                    // `relative` não cabe junto de `sticky`, e a alça
                    // precisa de um contexto de posicionamento: o wrapper
                    // interno resolve sem quebrar o congelamento.
                    i === colunas.length - 1 ? CLASSE_BORDA : "",
                  )}
                  style={fixa(i, false)}
                >
                  <span className="relative block truncate pr-1">
                    {c.rotulo}
                    <AlcaColuna
                      largura={c.largura}
                      minima={c.minima ?? 56}
                      onRedimensionar={(l) => controle.redimensionar(c.chave, l)}
                    />
                  </span>
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
              {colunas.map((c, i) => (
                <td
                  key={c.chave}
                  className={cn(
                    CLASSE_FIXA,
                    "border-b border-border px-3 py-2",
                    i === colunas.length - 1 ? CLASSE_BORDA : "",
                    c.chave === "indice" ? "px-2 font-mono text-xs text-muted-foreground" : "",
                    c.chave === "inicio" || c.chave === "fim" || c.chave === "progresso"
                      ? "whitespace-nowrap font-mono text-xs"
                      : "",
                  )}
                  style={fixa(i, true)}
                >
                  {c.chave === "indice" ? "0" : null}
                  {c.chave === "nome" ? (
                    <>
                      <span className="block truncate" title={projeto.nome}>
                        {projeto.nome}
                      </span>
                      {/* Duração e gerente vêm para cá porque as colunas
                          próprias deram lugar à faixa do Gantt. */}
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">
                        {diasEntre(projeto.inicio, projeto.fim)} d
                        {projeto.gerenteNome ? ` · ${projeto.gerenteNome}` : ""}
                      </span>
                    </>
                  ) : null}
                  {c.chave === "inicio" ? fmt(projeto.inicio) : null}
                  {c.chave === "fim" ? fmt(projeto.fim) : null}
                  {c.chave === "progresso" ? `${progressoProjeto}%` : null}
                </td>
              ))}
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
                colunas={colunas}
                fixa={fixa}
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
                  colSpan={colunas.length + 1}
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
  colunas,
  fixa,
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
  colunas: ColunaAjustada[];
  fixa: (indice: number, ehPai: boolean) => CSSProperties;
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

  /**
   * Conteúdo de cada coluna, resolvido pela chave.
   *
   * Um mapa em vez de células escritas na ordem: a ordem agora é do
   * usuário, e uma lista fixa de `<td>` deixaria de casar com o
   * cabeçalho no primeiro arrasto do menu.
   */
  const celula = (chave: string) => {
    switch (chave) {
      case "indice":
        return (
          // Calha: número dá lugar aos botões no hover ou no foco.
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
        );

      case "nome":
        return (
          <>
            {/* Nome em texto: renomear é na aba Cronograma. O ícone à
                direita abre o detalhe, que é o caminho para o resto. */}
            <span className="flex items-center gap-1.5" style={{ paddingLeft: `${nivel * 14}px` }}>
              {t.ehPai ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : null}
              {critica ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-destructive"
                  title="Caminho crítico — atraso aqui empurra a entrega"
                  aria-label="Caminho crítico"
                />
              ) : null}

              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  t.ehPai ? "font-medium" : "",
                  t.quadro === "done" ? "line-through opacity-70" : "",
                )}
                title={t.nome}
              >
                {t.nome}
              </span>

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
          </>
        );

      case "inicio":
        return (
          <CampoData
            valor={t.inicioEfetivo}
            editavel={podeEditar}
            onSalvar={(v) =>
              salvarCampo.mutate({
                id: t.id,
                inicio: new Date(`${v}T12:00:00`),
              })
            }
          />
        );

      case "fim":
        return (
          <CampoData
            valor={t.fimEfetivo}
            editavel={podeEditar}
            alerta={desvioFim}
            onSalvar={(v) => salvarCampo.mutate({ id: t.id, fim: new Date(`${v}T12:00:00`) })}
          />
        );

      case "progresso":
        return (
          <span className="flex items-center gap-2">
            <CampoProgresso
              valor={t.progressoEfetivo}
              editavel={podeEditar}
              onSalvar={(v) => salvarCampo.mutate({ id: t.id, progresso: v })}
            />
            <Progress value={t.progressoEfetivo} className="h-1 w-8" />
          </span>
        );

      default:
        return null;
    }
  };

  return (
    <tr className="group">
      {colunas.map((c, i) => (
        <td
          key={c.chave}
          className={cn(
            CLASSE_FIXA,
            "border-b border-border/60 px-3 py-1 align-top",
            i === colunas.length - 1 ? CLASSE_BORDA : "",
            c.chave === "indice" ? "px-2" : "",
          )}
          style={fixa(i, t.ehPai)}
        >
          {celula(c.chave)}
        </td>
      ))}

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
 * Data em dd/mm/aaaa que vira campo de calendário ao receber foco.
 *
 * O `<input type="date">` desenha o formato do sistema operacional e
 * reserva espaço para o ícone de calendário, então ocupa bem mais
 * largura do que o texto que representa — era isso que cortava o ano na
 * grade. Mostrar texto e só trocar durante a edição resolve sem gastar
 * a largura que o Gantt precisa.
 *
 * Salva ao sair, não a cada tecla: por tecla haveria uma requisição por
 * dígito, e o campo tentaria gravar uma data pela metade no meio da
 * digitação.
 */
function CampoData({
  valor,
  editavel,
  alerta,
  onSalvar,
}: {
  valor: Date;
  editavel: boolean;
  alerta?: string | undefined;
  onSalvar: (iso: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(paraInput(valor));

  // Se o servidor devolveu outro valor (rollup, reagendamento), acompanha.
  useEffect(() => setRascunho(paraInput(valor)), [valor]);

  if (!editavel) {
    return (
      <span
        className={cn(
          "block whitespace-nowrap font-mono text-xs",
          alerta ? "text-warning" : "text-muted-foreground",
        )}
        title={alerta}
      >
        {fmt(valor)}
      </span>
    );
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        title={alerta}
        className={cn(
          "h-7 w-full whitespace-nowrap rounded-md border border-transparent px-1 text-left font-mono text-xs hover:border-border focus:border-primary focus:outline-none",
          alerta ? "text-warning" : "",
        )}
      >
        {fmt(valor)}
      </button>
    );
  }

  return (
    <Input
      type="date"
      autoFocus
      value={rascunho}
      title={alerta}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        setEditando(false);
        if (rascunho && rascunho !== paraInput(valor)) onSalvar(rascunho);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(paraInput(valor));
          setEditando(false);
        }
      }}
      className={cn(
        "h-7 border-transparent bg-transparent px-1 font-mono text-xs hover:border-border focus:border-primary",
        alerta ? "text-warning" : "",
      )}
    />
  );
}

/** Percentual de conclusão, salvo ao sair do campo. */
function CampoProgresso({
  valor,
  editavel,
  onSalvar,
}: {
  valor: number;
  editavel: boolean;
  onSalvar: (v: number) => void;
}) {
  const [rascunho, setRascunho] = useState(String(valor));
  useEffect(() => setRascunho(String(valor)), [valor]);

  if (!editavel) {
    return <span className="font-mono text-xs text-muted-foreground">{valor}%</span>;
  }

  return (
    <Input
      type="number"
      min={0}
      max={100}
      value={rascunho}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        const n = Math.round(Number(rascunho));
        if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== valor) onSalvar(n);
        else setRascunho(String(valor));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setRascunho(String(valor));
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-12 border-transparent bg-transparent px-1 font-mono text-xs hover:border-border focus:border-primary"
    />
  );
}
