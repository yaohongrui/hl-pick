"use client";

import { cn } from "@/lib/format";
import { PERIODS, PERIOD_LABEL, type Period } from "@/lib/config";

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "up" | "down" | "accent" | "warn";
  className?: string;
}) {
  const tones = {
    default: "border-border text-muted",
    up: "border-up/30 text-up bg-up/5",
    down: "border-down/30 text-down bg-down/5",
    accent: "border-accent/40 text-accent bg-accent/10",
    warn: "border-warn/30 text-warn bg-warn/5",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  valueClass,
  pending,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
  pending?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] text-faint">{label}</div>
      {pending ? (
        <div className="skeleton mt-1.5 h-5 w-16" />
      ) : (
        <div className={cn("tabular mt-0.5 truncate text-[15px] font-medium", valueClass)}>
          {value}
        </div>
      )}
      {sub ? <div className="mt-0.5 truncate text-[10px] text-faint">{sub}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function PeriodTabs({
  period,
  onChange,
  className,
  size = "md",
}: {
  period: Period;
  onChange: (p: Period) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-panel/80 p-0.5 backdrop-blur",
        className,
      )}
    >
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            "rounded-full font-medium transition-colors",
            size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
            p === period
              ? "bg-accent text-white shadow"
              : "text-muted hover:text-fg",
          )}
          aria-pressed={p === period}
        >
          {PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-panel/80 p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors",
            o.value === value
              ? "bg-card-hover text-fg shadow-sm"
              : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex items-center justify-between", className)}>
      <h3 className="text-xs font-medium tracking-wide text-muted">{children}</h3>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-faint">
      {children}
    </div>
  );
}
