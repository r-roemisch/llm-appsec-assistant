import { cn } from "@/lib/utils";

/** The crenellated wall that is Rampart's mark. */
export function RampartMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="5" className="fill-primary" />
      <path
        className="fill-primary-foreground"
        fillRule="evenodd"
        d="M4 20V6h3.4v3.5h2.9V6h3.4v3.5h2.9V6H20v14zm6.3 0v-4.2a1.7 1.7 0 1 1 3.4 0V20z"
      />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <RampartMark />
      <span className="text-[15px] font-semibold tracking-tight">Rampart</span>
    </div>
  );
}

/** A battlement line: the one ornament, used on the login page. */
export function Crenellation({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 136 12" aria-hidden="true" className={cn("h-3 w-34 text-primary", className)}>
      <rect y="5" width="136" height="7" fill="currentColor" />
      {Array.from({ length: 9 }, (_, index) => (
        <rect key={index} x={index * 16} width="8" height="6" fill="currentColor" />
      ))}
    </svg>
  );
}
