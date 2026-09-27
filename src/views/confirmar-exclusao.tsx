import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirmação de exclusão. Regra de produto: toda exclusão pede
 * confirmação e é lógica — o registro some das telas, mas fica no banco
 * e na auditoria.
 *
 * Mesmo padrão visual da exclusão de projeto (projetos.tsx). Quando o
 * item tem vínculos (chamados, projetos), eles aparecem antes do botão,
 * para a pessoa decidir sabendo o que está em jogo.
 */
export function ConfirmarExclusao({
  aberto,
  onAbertoChange,
  nome,
  verificando = false,
  vinculos = [],
  explicacao,
  excluindo,
  onConfirmar,
  exigirTexto,
}: {
  aberto: boolean;
  onAbertoChange: (v: boolean) => void;
  nome: string;
  /** Enquanto os vínculos são consultados, o botão de excluir não aparece. */
  verificando?: boolean;
  /** Ex.: ["3 chamados", "1 projeto"]. Vazio quando não há vínculo. */
  vinculos?: string[];
  /** Texto específico do item, mostrado quando não há vínculos. */
  explicacao?: ReactNode;
  excluindo: boolean;
  onConfirmar: () => void;
  /**
   * Para exclusões críticas (empresa): a pessoa digita este texto para
   * liberar o botão. Evita confirmar no automático.
   */
  exigirTexto?: string | undefined;
}) {
  const [digitado, setDigitado] = useState("");
  const liberado = !exigirTexto || digitado.trim().toLowerCase() === exigirTexto.toLowerCase();

  return (
    <AlertDialog open={aberto} onOpenChange={onAbertoChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verificando ? "Verificando..." : `Excluir “${nome}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {verificando ? (
              "Conferindo se este item tem chamados ou projetos vinculados."
            ) : vinculos.length > 0 ? (
              <>
                Atenção: este item está vinculado a {vinculos.join(" e ")}. Eles continuam existindo
                e mantêm o histórico, mas o item deixa de aparecer nas telas e nos formulários.
                Deseja excluir mesmo assim?
              </>
            ) : (
              (explicacao ?? (
                <>
                  O item deixa de aparecer nas telas e nos formulários. O registro continua guardado
                  no histórico.
                </>
              ))
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {exigirTexto && !verificando ? (
          <div className="space-y-1.5">
            <p className="text-sm">
              Para confirmar, digite <span className="font-mono font-medium">{exigirTexto}</span>
            </p>
            <Input
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              autoComplete="off"
              aria-label="Texto de confirmação"
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          {verificando ? null : (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!liberado || excluindo}
              onClick={(e) => {
                e.preventDefault();
                if (liberado) onConfirmar();
              }}
            >
              {excluindo ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
