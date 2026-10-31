"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  DEFAULTS,
  hyperdashUrl,
  PERIODS,
  type Period,
} from "@/lib/config";
import { cn, relativeTime } from "@/lib/format";
import type { DeckItem, DeckResponse } from "@/lib/types";
import { FilterSheet, type Direction, type Filters } from "./FilterSheet";
import { TraderCard } from "./TraderCard";
import { SlidersIcon, StarIcon, SwapIcon, WarningIcon } from "../ui/icons";
import { PeriodTabs, Skeleton } from "../ui/primitives";

const FILTER_KEY = "hlpick:filters:v2";
const DIR_KEY = "hlpick:direction";
const PROGRESS_KEY = "hlpick:progress";
const PROGRESS_MAX_QUERIES = 20;
const RESTORE_MAX_PAGES = 20;

type ProgressMap = Record<string, string>;

/** Last card viewed for a given filter/period query, so reopening resumes there. */
function readProgress(query: string): string | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as ProgressMap;
    return typeof map[query] === "string" ? map[query] : null;
  } catch {
    return null;
  }
}

function writeProgress(query: string, address: string) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const map: ProgressMap = raw ? (JSON.parse(raw) as ProgressMap) : {};
    if (map[query] === address) return;
    map[query] = address;
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - PROGRESS_MAX_QUERIES))) {
      delete map[k];
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function isPeriod(v: string | null): v is Period {
  return !!v && (PERIODS as readonly string[]).includes(v);
}

export function Deck() {
  const sp = useSearchParams();

  const initialPeriod: Period = isPeriod(sp.get("period"))
    ? (sp.get("period") as Period)
    : DEFAULTS.period;
  const initialIndex = Math.max(0, Number(sp.get("i") ?? 0) || 0);
  const initialSourceRef = useRef(sp.get("source"));

  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [filters, setFilters] = useState<Filters>({
    source: DEFAULTS.source,
    sort: DEFAULTS.sort,
    minEquity: DEFAULTS.minEquity,
    minVol: DEFAULTS.minVol,
  });
  const [direction, setDirection] = useState<Direction>("vertical");
  const [hydrated, setHydrated] = useState(false);

  const [items, setItems] = useState<DeckItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [watchMap, setWatchMap] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const anchorRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  const restoredQueryRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<string | null>(null);
  const restorePagesRef = useRef(0);
  const initialIndexRef = useRef(initialIndex);
  const activeIndexRef = useRef(0);
  const itemsRef = useRef<DeckItem[]>([]);
  const directionRef = useRef<Direction>("vertical");
  const rafRef = useRef(0);
  const loadMoreLock = useRef(false);

  activeIndexRef.current = activeIndex;
  itemsRef.current = items;
  directionRef.current = direction;

  const deckQuery = useMemo(() => {
    const q = new URLSearchParams({
      period,
      sort: filters.sort,
      source: filters.source,
      minEquity: String(filters.minEquity),
      minVol: String(filters.minVol),
      limit: "50",
    });
    return q.toString();
  }, [period, filters]);

  const scrollToIndex = useCallback(
    (idx: number, behavior: ScrollBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el) return;
      const d = directionRef.current;
      const size = d === "vertical" ? el.clientHeight : el.clientWidth;
      if (size <= 0) return;
      if (d === "vertical") el.scrollTo({ top: idx * size, behavior });
      else el.scrollTo({ left: idx * size, behavior });
    },
    [],
  );

  const load = useCallback(
    async (cursor: number | null, replace: boolean) => {
      const reqId = ++requestIdRef.current;
      if (replace) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await fetch(
          apiUrl(`/api/deck?${deckQuery}&cursor=${cursor ?? 0}`),
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) {
          let msg = "地址池加载失败";
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) msg = body.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const data = (await res.json()) as DeckResponse;
        if (reqId !== requestIdRef.current) return;
        setItems((prev) => {
          if (replace) return data.items;
          const seen = new Set(prev.map((i) => i.address));
          return [...prev, ...data.items.filter((i) => !seen.has(i.address))];
        });
        setNextCursor(data.nextCursor);
        setTotal(data.total);
        setAsOf(data.asOf);
      } catch (err) {
        if (reqId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (reqId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [deckQuery],
  );

  /* initial load + reload on filter/period change */
  const prevQueryRef = useRef("");
  useEffect(() => {
    if (prevQueryRef.current === deckQuery) return;
    const isFirst = prevQueryRef.current === "";
    prevQueryRef.current = deckQuery;

    if (!isFirst) {
      const cur = itemsRef.current[activeIndexRef.current];
      anchorRef.current = cur?.address ?? null;
      setActiveIndex(0);
    }
    void load(null, true);
  }, [deckQuery, load]);

  /* remember the last viewed card for this filter/period combo */
  useEffect(() => {
    if (loading || !items.length) return;
    if (restoredQueryRef.current !== deckQuery) return;
    if (pendingRestoreRef.current) return;
    const item = items[activeIndex];
    if (item) writeProgress(deckQuery, item.address);
  }, [activeIndex, items, loading, deckQuery]);

  /* restore anchor / initial URL index / last viewed card after items arrive */
  useEffect(() => {
    if (loading || !items.length) return;

    const anchor = anchorRef.current;
    if (anchor) {
      const idx = items.findIndex((i) => i.address === anchor);
      anchorRef.current = null;
      restoredQueryRef.current = deckQuery;
      pendingRestoreRef.current = null;
      if (idx >= 0) {
        setActiveIndex(idx);
        requestAnimationFrame(() => scrollToIndex(idx, "auto"));
        return;
      }
    }

    if (restoredQueryRef.current === deckQuery) {
      // A saved card may live past the first page; keep looking as pages append.
      const pending = pendingRestoreRef.current;
      if (pending) {
        const idx = items.findIndex((i) => i.address === pending);
        if (idx >= 0) {
          pendingRestoreRef.current = null;
          setActiveIndex(idx);
          requestAnimationFrame(() => scrollToIndex(idx, "auto"));
        }
      }
      if (activeIndexRef.current >= items.length) setActiveIndex(0);
      return;
    }
    restoredQueryRef.current = deckQuery;
    pendingRestoreRef.current = null;
    restorePagesRef.current = 0;

    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      if (initialIndexRef.current > 0) {
        const idx = Math.min(initialIndexRef.current, items.length - 1);
        setActiveIndex(idx);
        requestAnimationFrame(() => scrollToIndex(idx, "auto"));
        return;
      }
    }

    const saved = readProgress(deckQuery);
    if (saved) {
      const idx = items.findIndex((i) => i.address === saved);
      if (idx >= 0) {
        setActiveIndex(idx);
        requestAnimationFrame(() => scrollToIndex(idx, "auto"));
        return;
      }
      pendingRestoreRef.current = saved;
    }

    if (activeIndexRef.current >= items.length) setActiveIndex(0);
  }, [items, loading, deckQuery, scrollToIndex]);

  /* load further pages until the remembered card is found (bounded) */
  useEffect(() => {
    if (!pendingRestoreRef.current || loading || loadingMore) return;
    if (nextCursor == null || restorePagesRef.current >= RESTORE_MAX_PAGES) {
      pendingRestoreRef.current = null;
      return;
    }
    restorePagesRef.current += 1;
    void load(nextCursor, false);
  }, [items, loading, loadingMore, nextCursor, load]);

  /* hydrate local settings */
  useEffect(() => {
    let savedDir: string | null = null;
    try {
      savedDir = localStorage.getItem(DIR_KEY);
    } catch {
      /* ignore */
    }
    const d: Direction =
      savedDir === "vertical" || savedDir === "horizontal"
        ? savedDir
        : window.matchMedia("(min-width: 768px)").matches
          ? "horizontal"
          : "vertical";
    setDirection(d);

    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Filters>;
        setFilters((f) => ({
          ...f,
          source: parsed.source ?? f.source,
          sort: parsed.sort ?? f.sort,
          minEquity:
            typeof parsed.minEquity === "number" ? parsed.minEquity : f.minEquity,
          minVol: typeof parsed.minVol === "number" ? parsed.minVol : f.minVol,
        }));
      }
    } catch {
      /* ignore */
    }

    const src = initialSourceRef.current;
    if (src === "all" || src === "seed" || src === "watchlist") {
      setFilters((f) => ({ ...f, source: src }));
    }

    setHydrated(true);
  }, []);

  /* persist settings */
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DIR_KEY, direction);
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() =>
      scrollToIndex(activeIndexRef.current, "auto"),
    );
    // Only restore scroll when direction changes, not on every index change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, hydrated, scrollToIndex]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters, hydrated]);

  /* active index from scroll */
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = containerRef.current;
      if (!el) return;
      const d = directionRef.current;
      const size = d === "vertical" ? el.clientHeight : el.clientWidth;
      if (size <= 0) return;
      const pos = d === "vertical" ? el.scrollTop : el.scrollLeft;
      const idx = Math.max(
        0,
        Math.min(Math.round(pos / size), itemsRef.current.length - 1),
      );
      setActiveIndex((prev) => (prev === idx ? prev : idx));
    });
  }, []);

  /* prefetch next page */
  useEffect(() => {
    if (loading || nextCursor == null || loadMoreLock.current) return;
    if (activeIndex < items.length - 4) return;
    loadMoreLock.current = true;
    void load(nextCursor, false).finally(() => {
      loadMoreLock.current = false;
    });
  }, [activeIndex, items.length, nextCursor, loading, load]);

  /* URL sync */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeIndex > 0) url.searchParams.set("i", String(activeIndex));
    else url.searchParams.delete("i");
    url.searchParams.set("period", period);
    window.history.replaceState(null, "", url);
  }, [activeIndex, period]);

  const toggleWatch = useCallback(
    async (address: string, base: boolean) => {
      const cur = watchMap[address] ?? base;
      const next = !cur;
      setWatchMap((m) => ({ ...m, [address]: next }));
      try {
        const res = await fetch(apiUrl("/api/watchlist"), {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        });
        if (!res.ok) throw new Error("watchlist failed");
      } catch {
        setWatchMap((m) => ({ ...m, [address]: cur }));
      }
    },
    [watchMap],
  );

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (sheetOpen) return;

      const list = itemsRef.current;
      if (!list.length) return;
      const cur = activeIndexRef.current;
      const go = (n: number) => {
        const idx = Math.max(0, Math.min(n, list.length - 1));
        setActiveIndex(idx);
        scrollToIndex(idx);
      };

      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          go(cur + 1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(cur - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(list.length - 1);
          break;
        case "s":
        case "S": {
          const item = list[cur];
          if (item) {
            e.preventDefault();
            void toggleWatch(item.address, item.inWatchlist);
          }
          break;
        }
        case "o":
        case "O": {
          const item = list[cur];
          if (item) {
            window.open(hyperdashUrl(item.address), "_blank", "noopener,noreferrer");
          }
          break;
        }
        case "f":
        case "F":
          setSheetOpen((v) => !v);
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          const p = PERIODS[Number(e.key) - 1];
          if (p) setPeriod(p);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrollToIndex, sheetOpen, toggleWatch]);

  const retry = () => void load(null, true);
  const changeDirection = (d: Direction) => setDirection(d);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40">
        <div className="bg-gradient-to-b from-bg via-bg/85 to-transparent pb-8">
          <div className="pointer-events-auto mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-[10px] font-bold text-white">
                HL
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight tracking-tight">
                  PICK
                </div>
                <div className="hidden text-[9px] leading-tight text-faint sm:block">
                  Hyperliquid 交易员筛选器
                </div>
              </div>
            </div>

            <PeriodTabs
              period={period}
              onChange={setPeriod}
              size="sm"
              className="hidden sm:inline-flex"
            />

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                title="筛选与设置 (F)"
                className="grid place-items-center rounded-full border border-border bg-panel/70 p-2 text-muted backdrop-blur transition-colors hover:border-border-strong hover:text-fg"
              >
                <SlidersIcon size={16} />
              </button>
              <button
                type="button"
                onClick={() =>
                  changeDirection(
                    direction === "vertical" ? "horizontal" : "vertical",
                  )
                }
                title={direction === "vertical" ? "切换为左右滑" : "切换为上下滑"}
                className="grid place-items-center rounded-full border border-border bg-panel/70 p-2 text-muted backdrop-blur transition-colors hover:border-border-strong hover:text-fg"
              >
                <SwapIcon size={16} />
              </button>
              <Link
                href="/watchlist"
                title="观察列表"
                className="flex items-center gap-1 rounded-full border border-border bg-panel/70 px-2.5 py-2 text-[11px] text-muted backdrop-blur transition-colors hover:border-border-strong hover:text-fg"
              >
                <StarIcon size={15} />
                <span className="hidden sm:inline">观察列表</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {loading && !items.length ? (
        <div className="flex h-dvh items-center justify-center px-4">
          <div className="w-full max-w-2xl space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-56" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ) : error && !items.length ? (
        <div className="flex h-dvh items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <WarningIcon size={30} className="mx-auto text-warn" />
            <h2 className="mt-3 text-sm font-medium">地址池加载失败</h2>
            <p className="mt-1 text-xs text-faint">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white"
            >
              重试
            </button>
            <p className="mt-4 text-[10px] text-faint">
              首次使用需要先同步排行榜数据：在服务器执行{" "}
              <code className="rounded bg-panel px-1 py-0.5">npm run sync</code>
            </p>
          </div>
        </div>
      ) : !loading && !items.length ? (
        <div className="flex h-dvh items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <h2 className="text-sm font-medium">没有符合筛选条件的地址</h2>
            <p className="mt-1 text-xs text-faint">
              降低最小净值或成交额，或者切换到“全部地址”。
            </p>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white"
            >
              调整筛选
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={onScroll}
          className={cn(
            "h-dvh w-full no-scrollbar overscroll-contain",
            direction === "vertical"
              ? "snap-y snap-mandatory overflow-y-auto overflow-x-hidden"
              : "flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden",
          )}
        >
          {items.map((item, i) => (
            <TraderCard
              key={item.address}
              item={item}
              index={i}
              total={total || items.length}
              period={period}
              shouldLoad={Math.abs(i - activeIndex) <= 1}
              isActive={i === activeIndex}
              starred={watchMap[item.address] ?? item.inWatchlist}
              direction={direction}
              onToggleStar={() =>
                void toggleWatch(item.address, item.inWatchlist)
              }
              onPeriodChange={setPeriod}
            />
          ))}
        </div>
      )}

      {loadingMore ? (
        <div className="fixed bottom-8 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-panel/90 px-3 py-1 text-[10px] text-muted backdrop-blur">
          加载更多地址…
        </div>
      ) : null}

      {items.length ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-end justify-between gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[10px] text-faint">
          <div className="space-x-2">
            <span className="hidden sm:inline">
              ← → / ↑ ↓ 切换 · S 收藏 · O 打开 Hyperdash · F 筛选 · 1–4 周期
            </span>
            <span className="sm:hidden">上下滑动切换 · 点“查看详情”打开 Hyperdash</span>
          </div>
          <div className="tabular text-right">
            <div>
              {activeIndex + 1} / {total || items.length}
            </div>
            {asOf ? <div>数据 {relativeTime(asOf)}</div> : null}
          </div>
        </div>
      ) : null}

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        onApply={setFilters}
        direction={direction}
        onDirection={changeDirection}
      />
    </main>
  );
}
