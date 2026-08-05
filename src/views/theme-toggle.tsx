import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-label={isDark ? "Ativar tema branco" : "Ativar tema black"}
      title={isDark ? "Mudar para tema branco" : "Mudar para tema black"}
      className="gap-2"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span className="hidden sm:inline">{isDark ? "Tema branco" : "Tema black"}</span>
    </Button>
  );
}
