import { ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { useItsm } from "@/lib/itsm-store";
import { cn } from "@/lib/utils";

/** Alterna o perfil ativo: somente TI pode atuar e responder chamados. */
export function RoleSwitch() {
  const { role, setRole } = useItsm();
  const hydrated = useHydrated();
  const ti = hydrated ? role === "ti" : true;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setRole(ti ? "nao_ti" : "ti")}
      title="Alternar perfil de usuário"
      className={cn("gap-2", ti ? "border-primary/40 text-primary" : "text-muted-foreground")}
    >
      {ti ? <ShieldCheck className="size-4" /> : <User className="size-4" />}
      {ti ? "Perfil TI" : "Perfil não TI"}
    </Button>
  );
}
