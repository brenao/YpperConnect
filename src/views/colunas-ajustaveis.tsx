/**
 * Colunas que o usuário ajusta: largura, ordem e o que fica visível.
 *
 * O mesmo mecanismo serve ao Cronograma e ao Gantt de propósito. As duas
 * telas mostram a mesma grade com as mesmas colunas, e quem arruma do
 * jeito que gosta numa espera encontrar a outra igual — configurar duas
 * vezes é o tipo de coisa que faz a pessoa desistir da configuração.
 *
 * A preferência é do USUÁRIO, guardada no banco. Ficou no navegador por
 * um tempo e falhava em dois casos reais: trocar de máquina devolvia
 * tudo ao padrão, e duas pessoas no mesmo computador desfaziam o ajuste
 * uma da outra sem entender por quê.
 *
 * O `localStorage` continua em uso, mas como espelho: é ele que pinta a
 * primeira tela sem esperar a rede. O banco é a fonte da verdade e
 * corrige o espelho quando a resposta chega.
 *
 * A gravação é adiada. Arrastar a borda dispara dezenas de mudanças por
 * segundo, e uma requisição por pixel derrubaria o servidor por um
 * ajuste de largura — grava-se quando o gesto para.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  lerPreferenciaFn,
  gravarPreferenciaFn,
  removerPreferenciaFn,
} from "@/services/preferencias.functions";
import { cn } from "@/lib/utils";

export interface DefColuna {
  chave: string;
  rotulo: string;
  /** Largura inicial, em pixels. */
  largura: number;
  /**
   * Coluna presa: não muda de lugar nem é escondida.
   *
   * É a calha de ações e numeração. Ela ancora a leitura da linha — e,
   * no Gantt, é a primeira coluna congelada: movê-la deixaria os
   * botões de inserir tarefa no meio da grade.
   */
  presa?: boolean;
  /** Abaixo disto a coluna fica ilegível; o arrasto para aqui. */
  minima?: number;
}

/** Coluna já resolvida com a preferência do usuário aplicada. */
export interface ColunaAjustada extends DefColuna {
  visivel: boolean;
}

interface Preferencia {
  ordem: string[];
  larguras: Record<string, number>;
  ocultas: string[];
}

const LARGURA_MINIMA = 56;

/** Prefixo do espelho local e da chave no banco. */
const PREFIXO = "colunas.";
const PREFIXO_LOCAL = "beagleone." + PREFIXO;

/** Espera antes de gravar: o suficiente para o arrasto terminar. */
const ATRASO_GRAVACAO_MS = 600;

/**
 * Texto JSON que veio do banco ou do espelho, virado preferência.
 *
 * Uma função só para os dois caminhos de propósito. Quando eram dois, o
 * espelho fazia `JSON.parse` e o banco não — e o valor do banco, que é
 * texto, chegava em `normalizar()` como string. Nenhum campo era
 * reconhecido, a preferência virava vazia e as colunas voltavam ao
 * padrão segundos depois de qualquer ajuste. O sintoma parecia perda de
 * gravação; era leitura.
 */
function deJson(texto: string | null | undefined): Preferencia | null {
  if (texto === null || texto === undefined) return null;
  try {
    return normalizar(JSON.parse(texto));
  } catch {
    // Texto corrompido cai no padrão: preferência de tela não vale uma
    // tela branca.
    return null;
  }
}

function lerEspelho(chave: string): Preferencia | null {
  try {
    return deJson(localStorage.getItem(PREFIXO_LOCAL + chave));
  } catch {
    // Armazenamento bloqueado: a rede resolve.
    return null;
  }
}

function gravarEspelho(chave: string, p: Preferencia | null): void {
  try {
    if (p === null) localStorage.removeItem(PREFIXO_LOCAL + chave);
    else localStorage.setItem(PREFIXO_LOCAL + chave, JSON.stringify(p));
  } catch {
    // Armazenamento cheio ou bloqueado: perde-se só a pintura imediata,
    // e o banco continua sendo a fonte da verdade.
  }
}

/**
 * Aceita o que veio de fora sem confiar no formato.
 *
 * O valor é JSON livre por decisão de projeto — a tabela serve a
 * qualquer preferência de tela —, então a validação é aqui. Dado
 * estranho vira preferência vazia, e a tela abre no padrão em vez de
 * quebrar.
 */
function normalizar(bruto: unknown): Preferencia {
  const p = (bruto ?? {}) as Partial<Preferencia>;
  return {
    ordem: Array.isArray(p.ordem) ? p.ordem.filter((x) => typeof x === "string") : [],
    larguras:
      p.larguras && typeof p.larguras === "object"
        ? Object.fromEntries(
            Object.entries(p.larguras).filter(([, v]) => typeof v === "number" && v > 0),
          )
        : {},
    ocultas: Array.isArray(p.ocultas) ? p.ocultas.filter((x) => typeof x === "string") : [],
  };
}

export interface ControleColunas {
  /** Na ordem escolhida, já sem as ocultas. */
  colunas: ColunaAjustada[];
  /** Todas, na ordem escolhida, para o menu de configuração. */
  todas: ColunaAjustada[];
  redimensionar: (chave: string, largura: number) => void;
  mover: (chave: string, direcao: -1 | 1) => void;
  alternarVisivel: (chave: string) => void;
  restaurar: () => void;
  /** true quando há preferência gravada — o menu oferece "restaurar". */
  personalizado: boolean;
}

/**
 * Aplica a preferência do usuário sobre a definição padrão.
 *
 * Três camadas, nesta ordem: o espelho local pinta a primeira tela sem
 * esperar a rede; a resposta do banco corrige o espelho; as mudanças
 * vão para o banco depois que o gesto termina.
 *
 * A leitura do espelho acontece depois da montagem, e não no
 * `useState` inicial, porque o servidor renderiza sem `localStorage`:
 * uma primeira pintura já personalizada faria o React acusar diferença
 * entre o HTML dos dois lados.
 *
 * Coluna nova que o sistema passar a oferecer entra visível, no lugar
 * que a definição manda: a preferência antiga não a conhece, e
 * escondê-la faria a novidade nascer invisível para quem já usava o
 * sistema.
 */
export function useColunas(chave: string, padrao: DefColuna[]): ControleColunas {
  const qc = useQueryClient();
  const chaveCompleta = PREFIXO + chave;

  const [pref, setPref] = useState<Preferencia | null>(null);

  // Espelho local: pinta antes da rede responder.
  useEffect(() => {
    setPref(lerEspelho(chave));
  }, [chave]);

  /**
   * Ajuste local ainda não confirmado pelo servidor.
   *
   * A gravação é adiada, então existe uma janela de alguns segundos em
   * que o banco ainda tem o valor ANTIGO. Qualquer releitura nesse
   * intervalo o traria de volta e desfaria o ajuste na cara de quem
   * acabou de arrastar a coluna.
   *
   * Enquanto houver ajuste pendente, o que o servidor diz é ignorado:
   * quem está com a mão no mouse tem a versão mais recente, não o
   * banco.
   */
  const pendente = useRef(false);

  const salvo = useQuery({
    queryKey: ["preferencia", chaveCompleta],
    queryFn: () => lerPreferenciaFn({ data: { chave: chaveCompleta } }),
    // Preferência muda raramente e só por ação de quem está olhando.
    staleTime: 5 * 60_000,
    // Voltar para a aba não é motivo para reler: seria mais uma chance
    // de a resposta chegar no meio de um ajuste.
    refetchOnWindowFocus: false,
  });

  /**
   * O banco venceu: alinha o estado e o espelho.
   *
   * Só quando de fato difere — sem a comparação, cada resposta da
   * consulta agendaria um estado novo e o componente entraria em ciclo.
   */
  useEffect(() => {
    // Ajuste em andamento manda: aceitar o servidor aqui desfaria o que
    // a pessoa acabou de fazer.
    if (pendente.current) return;

    const bruto = salvo.data?.valor;
    if (bruto === undefined) return;

    const doBanco = deJson(bruto);

    setPref((atual) => {
      if (JSON.stringify(atual) === JSON.stringify(doBanco)) return atual;
      gravarEspelho(chave, doBanco);
      return doBanco;
    });
  }, [salvo.data, chave]);

  /**
   * Gravação adiada.
   *
   * O arrasto da borda dispara dezenas de mudanças por segundo. Sem o
   * atraso, seria uma requisição por pixel percorrido — e a última a
   * chegar nem sempre seria a última enviada, o que gravaria uma
   * largura intermediária.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agendarGravacao = useCallback(
    (valor: Preferencia) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        gravarPreferenciaFn({
          data: { chave: chaveCompleta, valor: JSON.stringify(valor) },
        })
          .then(() => {
            // Só agora o banco concorda com a tela. Liberar antes
            // reabriria a janela em que uma resposta atrasada
            // sobrescreve o ajuste.
            pendente.current = false;
            return qc.invalidateQueries({
              queryKey: ["preferencia", chaveCompleta],
            });
          })
          .catch(() => {
            // Falha ao gravar não interrompe o trabalho: o espelho
            // local mantém o ajuste nesta máquina, e a próxima mudança
            // tenta de novo. `pendente` continua ligado de propósito —
            // sem confirmação, o servidor não tem por que mandar.
          });
      }, ATRASO_GRAVACAO_MS);
    },
    [chaveCompleta, qc],
  );

  // Gravação pendente ao desmontar seria perdida em silêncio.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const atualizar = useCallback(
    (mudanca: (p: Preferencia) => Preferencia) => {
      pendente.current = true;
      setPref((atual) => {
        const base: Preferencia = atual ?? {
          ordem: padrao.map((c) => c.chave),
          larguras: {},
          ocultas: [],
        };
        const nova = mudanca(base);
        gravarEspelho(chave, nova);
        agendarGravacao(nova);
        return nova;
      });
    },
    [agendarGravacao, chave, padrao],
  );

  const todas = useMemo<ColunaAjustada[]>(() => {
    const porChave = new Map(padrao.map((c) => [c.chave, c]));

    // A ordem salva vem primeiro; o que ela não conhece entra depois, na
    // posição da definição.
    const ordenadas: DefColuna[] = [];
    for (const k of pref?.ordem ?? []) {
      const c = porChave.get(k);
      if (c) {
        ordenadas.push(c);
        porChave.delete(k);
      }
    }
    for (const c of padrao) {
      if (porChave.has(c.chave)) ordenadas.push(c);
    }

    // Presas voltam para o início, aconteça o que acontecer com a
    // preferência salva: uma calha de ações no meio da tabela seria
    // resultado de um arrasto que a interface nem oferece.
    const presas = ordenadas.filter((c) => c.presa);
    const soltas = ordenadas.filter((c) => !c.presa);

    return [...presas, ...soltas].map((c) => ({
      ...c,
      largura: pref?.larguras[c.chave] ?? c.largura,
      visivel: c.presa === true || !(pref?.ocultas ?? []).includes(c.chave),
    }));
  }, [padrao, pref]);

  const colunas = useMemo(() => todas.filter((c) => c.visivel), [todas]);

  const redimensionar = useCallback(
    (k: string, largura: number) => {
      const c = padrao.find((x) => x.chave === k);
      const minima = c?.minima ?? LARGURA_MINIMA;
      const valor = Math.max(minima, Math.round(largura));
      atualizar((p) => ({ ...p, larguras: { ...p.larguras, [k]: valor } }));
    },
    [atualizar, padrao],
  );

  /**
   * Move a coluna uma posição, sem atravessar as presas.
   *
   * Botões de subir e descer em vez de arrastar a coluna inteira: o
   * arrasto da borda já serve à largura, e dois gestos de arrasto na
   * mesma linha do cabeçalho se confundem — a pessoa tenta redimensionar
   * e move a coluna sem querer.
   *
   * A ordem gravada é a de TODAS as colunas, inclusive as ocultas. Sem
   * isso, esconder uma e mover outra apagaria a posição da escondida, e
   * ela reapareceria no fim da tabela ao ser reativada.
   */
  const mover = useCallback(
    (k: string, direcao: -1 | 1) => {
      atualizar((p) => {
        const atual = todas.map((c) => c.chave);
        const i = atual.indexOf(k);
        const j = i + direcao;
        const alvo = todas[j];
        if (i < 0 || !alvo || alvo.presa || todas[i]?.presa) return p;

        const nova = [...atual];
        const removido = nova.splice(i, 1)[0];
        if (removido === undefined) return p;
        nova.splice(j, 0, removido);
        return { ...p, ordem: nova };
      });
    },
    [atualizar, todas],
  );

  const alternarVisivel = useCallback(
    (k: string) => {
      atualizar((p) => ({
        ...p,
        // A ordem entra junto: esconder uma coluna antes de qualquer
        // reordenação gravaria `ordem` vazia, e a preferência deixaria
        // de conhecer as posições.
        ordem: p.ordem.length > 0 ? p.ordem : todas.map((c) => c.chave),
        ocultas: p.ocultas.includes(k) ? p.ocultas.filter((x) => x !== k) : [...p.ocultas, k],
      }));
    },
    [atualizar, todas],
  );

  /**
   * Restaurar é apagar, não gravar um valor vazio.
   *
   * Ausência de linha é exatamente o que significa "nunca ajustou", e é
   * como o usuário novo começa. Um objeto vazio criaria um segundo
   * jeito de dizer a mesma coisa.
   */
  const restaurar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    pendente.current = true;
    gravarEspelho(chave, null);
    setPref(null);
    removerPreferenciaFn({ data: { chave: chaveCompleta } })
      .then(() => {
        pendente.current = false;
        return qc.invalidateQueries({
          queryKey: ["preferencia", chaveCompleta],
        });
      })
      .catch(() => {
        // Mesma regra da gravação: a tela já voltou ao padrão aqui, e a
        // próxima mudança sincroniza.
      });
  }, [chave, chaveCompleta, qc]);

  return {
    colunas,
    todas,
    redimensionar,
    mover,
    alternarVisivel,
    restaurar,
    personalizado: pref !== null,
  };
}

/**
 * Alça de redimensionar, na borda direita do cabeçalho.
 *
 * Usa eventos de ponteiro com captura: sem `setPointerCapture`, arrastar
 * rápido para fora da célula solta o gesto no meio e a coluna para de
 * acompanhar o cursor.
 *
 * O `onClick` com `stopPropagation` existe porque o cabeçalho pode ter
 * ação própria — ordenação, por exemplo —, e soltar a alça não pode
 * disparar o clique dela.
 */
export function AlcaColuna({
  largura,
  minima = LARGURA_MINIMA,
  onRedimensionar,
}: {
  largura: number;
  minima?: number;
  onRedimensionar: (largura: number) => void;
}) {
  const inicio = useRef<{ x: number; largura: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title="Arraste para ajustar a largura"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        inicio.current = { x: e.clientX, largura };
        setArrastando(true);
      }}
      onPointerMove={(e) => {
        const ini = inicio.current;
        if (!ini) return;
        onRedimensionar(Math.max(minima, ini.largura + (e.clientX - ini.x)));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        inicio.current = null;
        setArrastando(false);
      }}
      onPointerCancel={() => {
        inicio.current = null;
        setArrastando(false);
      }}
      className={cn(
        // Faixa de 8px com a linha desenhada no meio: alvo de 2px é
        // impossível de acertar com o mouse.
        "absolute right-0 top-0 z-10 flex h-full w-2 translate-x-1/2 cursor-col-resize touch-none items-center justify-center",
        "before:h-1/2 before:w-px before:bg-border before:transition-colors hover:before:h-full hover:before:w-0.5 hover:before:bg-primary",
        arrastando ? "before:h-full before:w-0.5 before:bg-primary" : "",
      )}
    />
  );
}

/**
 * Menu de colunas: ordem e visibilidade.
 *
 * Fica ao lado dos controles da tela, e não num clique com o botão
 * direito no cabeçalho: menu de contexto é invisível para quem não
 * sabe que existe, e configuração de tabela é coisa que se procura uma
 * vez e não se acha nunca mais.
 */
export function MenuColunas({ controle }: { controle: ControleColunas }) {
  const { todas, mover, alternarVisivel, restaurar, personalizado } = controle;
  const moveis = todas.filter((c) => !c.presa);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
          <Columns3 className="size-4" /> Colunas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Arraste a borda do cabeçalho para mudar a largura. Aqui você escolhe a ordem e o que
          aparece.
        </p>

        <ul className="max-h-72 overflow-y-auto">
          {moveis.map((c, i) => (
            <li
              key={c.chave}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-secondary/50"
            >
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
              <Checkbox
                id={`col-${c.chave}`}
                checked={c.visivel}
                onCheckedChange={() => alternarVisivel(c.chave)}
              />
              <label htmlFor={`col-${c.chave}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                {c.rotulo}
              </label>
              <span className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Mover para a esquerda"
                  disabled={i === 0}
                  onClick={() => mover(c.chave, -1)}
                >
                  ←
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Mover para a direita"
                  disabled={i === moveis.length - 1}
                  onClick={() => mover(c.chave, 1)}
                >
                  →
                </Button>
              </span>
            </li>
          ))}
        </ul>

        {personalizado ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-2 text-muted-foreground"
            onClick={restaurar}
          >
            <RotateCcw className="size-3.5" /> Restaurar o padrão
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
