import { cn } from "./cn";

/**
 * A figure like "21h 30m" or "5/16": the digits carry the weight and the
 * units sit beside them, smaller and quieter. A word ("Today") or a dash is
 * shown as it is.
 */
export function Numeral({ value, className }: { value: string; className?: string }) {
  if (value === "—") return <span className={cn("text-ink-4", className)}>—</span>;
  if (!/\d/.test(value)) return <span className={className}>{value}</span>;
  const parts = value.match(/\d+|[^\d]+/g) ?? [value];
  return (
    <span className={className}>
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i}>{part}</span>
        ) : (
          <span
            key={i}
            className={cn(
              "text-[0.72em] font-medium tracking-normal text-ink-3",
              part.trim() === "/" ? "mx-[0.06em]" : "mr-[0.18em] ml-[0.08em] last:mr-0",
            )}
          >
            {part.trim() || " "}
          </span>
        ),
      )}
    </span>
  );
}
