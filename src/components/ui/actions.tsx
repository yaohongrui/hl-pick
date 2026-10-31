"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/format";
import { CheckIcon, CopyIcon, StarIcon } from "./icons";

export function StarButton({
  address,
  starred,
  onToggle,
  size = 20,
  className,
}: {
  address: string;
  starred: boolean;
  onToggle: () => void | Promise<void>;
  size?: number;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onToggle();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={starred}
      aria-label={starred ? "移出观察列表" : "加入观察列表"}
      title={`${starred ? "移出" : "加入"}观察列表 · ${address.slice(0, 6)}…${address.slice(-4)}`}
      className={cn(
        "grid place-items-center rounded-full border border-border bg-panel/70 p-2 backdrop-blur transition-colors hover:border-border-strong",
        starred ? "text-warn" : "text-muted hover:text-fg",
        busy && "opacity-60",
        className,
      )}
    >
      <StarIcon filled={starred} size={size} />
    </button>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

export function CopyButton({
  text,
  size = 18,
  className,
  label,
}: {
  text: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const ok = await copyText(text);
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    },
    [text],
  );

  return (
    <button
      type="button"
      onClick={onClick}
      title="复制地址"
      className={cn(
        "grid place-items-center rounded-full border border-border bg-panel/70 p-2 text-muted backdrop-blur transition-colors hover:border-border-strong hover:text-fg",
        className,
      )}
    >
      {copied ? <CheckIcon size={size} className="text-up" /> : <CopyIcon size={size} />}
      {label ? <span className="ml-1 text-[10px]">{copied ? "已复制" : label}</span> : null}
    </button>
  );
}
