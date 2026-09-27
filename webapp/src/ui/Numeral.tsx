import { cn } from "./cn";

/**
 * A figure like "21h 30m" or "5/16" set with its digits large and its units
 * and separators small and quiet.
 */
export function Numeral({ value, className }: { value: string; className?: string }) {
  if (value === "—") return <span className={cn("text-ink-4", className)}>—</span>;
  const parts = value.match(/\d+|[^\d]+/g) ?? [value];
  return (
    <span className={cn("tnum", className)}>
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i}>{part}</span>
        ) : (
          <span key={i} className="mx-px text-[0.6em] font-medium text-ink-3">
            {part.trim() === "" ? " " : part.trim()}
          </span>
        ),
      )}
    </span>
  );
}
