import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Link de convite ou de acesso, para o administrador copiar e enviar.
 *
 * É a diferença de login em relação à instalação com AD: sem senha de
 * rede, a pessoa cria a própria senha por este link. Vale uma única vez
 * e expira em 1 hora.
 */
export function DialogLink({
  link,
  onFechar,
}: {
  link: { url: string; titulo: string } | null;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  return (
    <Dialog open={link !== null} onOpenChange={(aberto) => (aberto ? null : onFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{link?.titulo}</DialogTitle>
          <DialogDescription>
            Envie este link à pessoa. Ele vale uma única vez e expira em 1 hora. Ao abrir, ela
            define a própria senha.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={link?.url ?? ""} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(link?.url ?? "");
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            }}
          >
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onFechar}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
