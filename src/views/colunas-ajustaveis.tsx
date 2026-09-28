/**
 * Colunas que o usuário ajusta: largura, ordem e o que fica visível.
 *
 * O mesmo mecanismo serve ao Cronograma e ao Gantt de propósito. As duas
 * telas mostram a mesma grade com as mesmas colunas, e quem arruma do
 * jeito que gosta numa espera encontrar a outra igual — configurar duas
 * vezes é o tipo de coisa que faz a pessoa desistir da configuração.
 *
 * A preferência vive no navegador, não no banco. Salvar no servidor
 * exigiria uma tabela de preferências e uma ida à rede a cada arrasto da
 * borda; o preço de perder o ajuste ao trocar de máquina é pequeno perto
 * disso, e é o que Jira, Smartsheet e Asana fazem com largura de coluna.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns3, GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
const PREFIXO = "beagleone.colunas.";

function ler(chave: string): Preferencia | null {
  try {
    const bruto = localStorage.getItem(PREFIXO + chave);
    if (!bruto) return null;
    const p = JSON.parse(bruto) as Partial<Preferencia>;
    return {
      ordem: Array.isArray(p.ordem) ? p.ordem : [],
      larguras: typeof p.larguras === "object" && p.larguras ? p.larguras : {},
      ocultas: Array.isArray(p.ocultas) ? p.ocultas : [],
    };
  } catch {
    // Preferência corrompida não pode derrubar a tela: cai no padrão.
    return null;
  }
}

function gravar(chave: string, p: Preferencia): void {
  try {
    localStorage.setItem(PREFIXO + chave, JSON.stringify(p));
  } catch {
    // Navegador com armazenamento cheio ou bloqueado: a tela continua
    // funcionando, só não lembra do ajuste na próxima visita.
  }
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
 * Aplica a preferência salva sobre a definição padrão.
 *
 * A leitura é feita depois da montagem, e não no `useState` inicial,
 * porque o servidor renderiza sem `localStorage`: se a primeira pintura
 * já viesse com a largura personalizada, o React acusaria diferença
 * entre o HTML do servidor e o do navegador.
 *
 * Coluna nova que o sistema passar a oferecer entra visível, no lugar
 * que a definição manda: a preferência antiga não a conhece, e
 * escondê-la faria a novidade nascer invisível para quem já usava o
 * sistema.
 */
export function useColunas(chave: string, padrao: DefColuna[]): ControleColunas {
  const [pref, setPref] = useState<Preferencia | null>(null);
  const carregou = useRef(false);

  useEffect(() => {
    setPref(ler(chave));
    carregou.current = true;
  }, [chave]);

  const atualizar = useCallback(
    (mudanca: (p: Preferencia) => Preferencia) => {
      setPref((atual) => {
        const base: Preferencia = atual ?? {
          ordem: padrao.map((c) => c.chave),
          larguras: {},
          ocultas: [],
        };
        const nova = mudanca(base);
        gravar(chave, nova);
        return nova;
      });
    },
    [chave, padrao],
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
        ocultas: p.ocultas.includes(k) ? p.ocultas.filter((x) => x !== k) : [...p.ocultas, k],
      }));
    },
    [atualizar],
  );

  const restaurar = useCallback(() => {
    try {
      localStorage.removeItem(PREFIXO + chave);
    } catch {
      // Sem armazenamento, o estado em memória já resolve a sessão.
    }
    setPref(null);
  }, [chave]);

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
