import type { ResolvedTheme } from "../lib/theme";

interface Props {
  theme: ResolvedTheme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: Props) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={onToggle}
      data-testid="theme-toggle"
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
