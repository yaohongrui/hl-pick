const usdCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  style: "currency",
  currency: "USD",
});

const usdFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function fmtUsd(
  n: number | null | undefined,
  opts?: { compact?: boolean; sign?: boolean },
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const compact = opts?.compact ?? true;
  const abs = Math.abs(n);
  let out: string;
  if (compact && abs >= 10_000) out = usdCompact.format(n);
  else if (abs < 1 && abs > 0) out = `$${n.toFixed(4)}`;
  else out = usdFull.format(n);
  if (opts?.sign && n > 0) out = `+${out}`;
  return out;
}

export function fmtPct(
  n: number | null | undefined,
  opts?: { digits?: number; sign?: boolean },
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = opts?.digits ?? 1;
  const sign = opts?.sign ?? true;
  const v = n * 100;
  const s = `${v.toFixed(digits)}%`;
  return sign && v > 0 ? `+${s}` : s;
}

export function fmtNum(
  n: number | null | undefined,
  digits = 2,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}

export function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n > 999) return ">999";
  if (n < -999) return "<-999";
  return fmtNum(n, 2);
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ${h % 24}h`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ${d % 30}d`;
  const y = Math.floor(d / 365);
  return `${y}y ${Math.floor((d % 365) / 30)}mo`;
}

export function shortAddress(a: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDay(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function signClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-muted";
  return n > 0 ? "text-up" : "text-down";
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
