"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { normalizeAddress } from "@/lib/address";
import { apiUrl, hyperdashUrl } from "@/lib/config";
import { fetcher } from "@/lib/fetcher";
import {
  cn,
  fmtDay,
  fmtPct,
  fmtUsd,
  shortAddress,
  signClass,
} from "@/lib/format";
import type { WatchItem } from "@/lib/types";
import { StarButton } from "../ui/actions";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  SearchIcon,
} from "../ui/icons";
import { Badge, Skeleton } from "../ui/primitives";

export function WatchlistPage() {
  const { data, error, isLoading, mutate } = useSWR<{ items: WatchItem[] }>(
    apiUrl("/api/watchlist"),
    fetcher,
    { revalidateOnFocus: false },
  );

  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = normalizeAddress(input);
    if (!address) {
      setErr("地址格式不正确（需要 0x + 40 位十六进制）");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/watchlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error("add failed");
      setInput("");
      setNote("");
      await mutate();
    } catch {
      setErr("添加失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (address: string) => {
    try {
      const res = await fetch(
        apiUrl(`/api/watchlist?address=${address}`),
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("remove failed");
      await mutate();
    } catch {
      /* SWR will keep the old list */
    }
  };

  const items = data?.items ?? [];

  return (
    <main className="min-h-dvh bg-bg pb-16">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2.5 sm:px-4">
          <Link
            href="/"
            title="返回刷卡"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-panel/70 text-muted hover:text-fg"
          >
            <ArrowLeftIcon size={17} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">观察列表</h1>
            <div className="text-[10px] text-faint">
              {isLoading ? "加载中…" : `${items.length} 个地址`}
            </div>
          </div>
          <Link
            href="/?source=watchlist"
            className="rounded-full border border-border bg-panel/70 px-3 py-1.5 text-[11px] text-muted hover:text-fg"
          >
            开始刷观察列表
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4">
        <form
          onSubmit={add}
          className="mt-4 rounded-xl border border-border bg-card p-3 sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入 Hyperliquid 地址，例如 0x…"
                spellCheck={false}
                className="tabular w-full rounded-lg border border-border bg-panel py-2 pl-9 pr-3 text-xs outline-none placeholder:text-faint focus:border-accent"
              />
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注（可选）"
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-xs outline-none placeholder:text-faint focus:border-accent sm:w-44"
            />
            <button
              type="submit"
              disabled={busy}
              className={cn(
                "rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-opacity",
                busy && "opacity-60",
              )}
            >
              {busy ? "添加中…" : "加入观察"}
            </button>
          </div>
          {err ? <div className="mt-2 text-[10px] text-down">{err}</div> : null}
          <p className="mt-2 text-[10px] text-faint">
            观察列表保存在本机 SQLite。收藏地址后可在刷卡页切换到“观察列表”来源。
          </p>
        </form>

        {isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-faint">
            观察列表加载失败：{error.message}
          </div>
        ) : !items.length ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-16 text-center">
            <div className="text-xs text-muted">还没有收藏任何地址</div>
            <div className="mt-1 text-[10px] text-faint">
              在上面输入地址，或在刷卡页点右上角星标。
            </div>
            <Link
              href="/"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white"
            >
              去刷卡
            </Link>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {items.map((item) => (
              <div
                key={item.address}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-card-hover/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={hyperdashUrl(item.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tabular truncate text-xs font-medium hover:text-accent"
                    >
                      {shortAddress(item.address)}
                    </a>
                    {item.note ? (
                      <Badge tone="accent">{item.note}</Badge>
                    ) : null}
                  </div>
                  <div className="tabular mt-1 truncate text-[10px] text-faint">
                    {item.address}
                  </div>
                </div>

                <div className="tabular hidden shrink-0 text-right text-[11px] sm:block">
                  <div className="text-faint">
                    净值 {fmtUsd(item.accountValue)}
                  </div>
                  <div className={cn("mt-0.5", signClass(item.monthRoi))}>
                    30D {fmtPct(item.monthRoi)}
                  </div>
                </div>

                <div className="tabular hidden shrink-0 text-right text-[10px] text-faint md:block">
                  {fmtDay(item.addedAt)}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <StarButton
                    address={item.address}
                    starred
                    onToggle={() => remove(item.address)}
                    size={17}
                  />
                  <a
                    href={hyperdashUrl(item.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid place-items-center rounded-full border border-border bg-panel/70 p-2 text-muted hover:text-fg"
                    title="在 Hyperdash 查看详情"
                  >
                    <ArrowUpRightIcon size={16} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
