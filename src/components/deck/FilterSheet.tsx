"use client";

import { useEffect, useState } from "react";
import {
  DEFAULTS,
  SOURCES,
  SOURCE_LABEL,
  SORTS,
  SORT_LABEL,
  type SourceKey,
  type SortKey,
} from "@/lib/config";
import { cn } from "@/lib/format";
import { CloseIcon, SwapIcon } from "../ui/icons";
import { Segmented } from "../ui/primitives";

export interface Filters {
  source: SourceKey;
  sort: SortKey;
  minEquity: number;
  minVol: number;
}

export type Direction = "vertical" | "horizontal";

export function FilterSheet({
  open,
  onClose,
  filters,
  onApply,
  direction,
  onDirection,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  onApply: (f: Filters) => void;
  direction: Direction;
  onDirection: (d: Direction) => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="筛选与设置"
    >
      <div
        className="w-full rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">筛选与设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:bg-card-hover hover:text-fg"
            aria-label="关闭"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[11px] text-faint">地址来源</div>
            <Segmented
              value={draft.source}
              options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
              onChange={(v) => setDraft((d) => ({ ...d, source: v }))}
            />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] text-faint">排序</div>
            <Segmented
              value={draft.sort}
              options={SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
              onChange={(v) => setDraft((d) => ({ ...d, sort: v }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-faint">
                最小账户净值 (USD)
              </span>
              <input
                type="number"
                min={0}
                step={1000}
                inputMode="numeric"
                value={Number.isFinite(draft.minEquity) ? draft.minEquity : 0}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    minEquity: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="tabular w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-faint">
                最小周期成交额 (USD)
              </span>
              <input
                type="number"
                min={0}
                step={100000}
                inputMode="numeric"
                value={Number.isFinite(draft.minVol) ? draft.minVol : 0}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    minVol: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="tabular w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
              <SwapIcon size={13} />
              滑动方向
            </div>
            <Segmented
              value={direction}
              options={[
                { value: "vertical", label: "上下滑" },
                { value: "horizontal", label: "左右滑" },
              ]}
              onChange={(v) => onDirection(v as Direction)}
            />
          </div>

          <p className="text-[10px] leading-relaxed text-faint">
            默认过滤掉净值低于 $10K 或成交额过低的地址，避免刷到几乎不活跃的账户。周期与
            Hyperliquid 官方窗口一致：1D / 7D / 30D / ALL。
          </p>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setDraft({
                source: DEFAULTS.source,
                sort: DEFAULTS.sort,
                minEquity: DEFAULTS.minEquity,
                minVol: DEFAULTS.minVol,
              })
            }
            className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-fg"
          >
            恢复默认
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className={cn(
              "flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white",
              "transition-opacity hover:opacity-90",
            )}
          >
            应用筛选
          </button>
        </div>
      </div>
    </div>
  );
}
