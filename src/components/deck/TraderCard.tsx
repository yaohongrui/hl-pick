"use client";

import useSWR from "swr";
import {
  apiUrl,
  hyperdashUrl,
  PERIOD_LABEL,
  type Period,
} from "@/lib/config";
import { fetcher } from "@/lib/fetcher";
import {
  cn,
  fmtDuration,
  fmtNum,
  fmtPct,
  fmtRatio,
  fmtUsd,
  shortAddress,
  signClass,
} from "@/lib/format";
import type { DeckItem, TraderMetrics } from "@/lib/types";
import { Sparkline } from "../ui/Sparkline";
import { CopyButton, StarButton } from "../ui/actions";
import { ArrowUpRightIcon, WarningIcon } from "../ui/icons";
import { Badge, PeriodTabs, Skeleton, Stat } from "../ui/primitives";

export function TraderCard({
  item,
  index,
  total,
  period,
  shouldLoad,
  isActive,
  starred,
  direction,
  onToggleStar,
  onPeriodChange,
}: {
  item: DeckItem;
  index: number;
  total: number;
  period: Period;
  shouldLoad: boolean;
  isActive: boolean;
  starred: boolean;
  direction: "vertical" | "horizontal";
  onToggleStar: () => void | Promise<void>;
  onPeriodChange: (p: Period) => void;
}) {
  const { data, error, isLoading, mutate } = useSWR<TraderMetrics>(
    shouldLoad
      ? apiUrl(
          `/api/trader/${item.address}?period=${period}&hold=${isActive ? 1 : 0}`,
        )
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      shouldRetryOnError: false,
      refreshInterval: (latest) =>
        latest?.positions?.some((p) => p.holdingPending) ? 5_000 : 60_000,
    },
  );

  const m = data;
  const roi = m?.roi ?? item.roi;
  const pnl = m?.pnl ?? item.pnl;
  const vlm = m?.volume ?? item.vlm;
  const acct = m?.accountValue ?? item.accountValue;
  const pending = shouldLoad && isLoading && !m;
  const tags = Array.from(new Set([...(item.tags ?? []), ...(m?.tags ?? [])]));
  const points = (m?.equity ?? []).map((p) => ({ ts: p.ts, value: p.pnl }));

  return (
    <section
      className={cn(
        "relative flex h-dvh w-full shrink-0 items-center justify-center overflow-hidden px-4 pb-16 pt-14 sm:px-6",
        direction === "horizontal" ? "snap-center" : "snap-start",
      )}
      aria-label={`${shortAddress(item.address)} 的交易表现`}
    >
      <div className="pointer-events-none absolute inset-0 card-glow" />
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
      <div className="pointer-events-none absolute -right-10 top-20 select-none text-[120px] font-bold leading-none text-white/[0.02] sm:text-[180px]">
        #{index + 1}
      </div>

      <div className="relative w-full max-w-2xl fade-up">
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="tabular rounded-md border border-border bg-panel/70 px-1.5 py-0.5 text-[10px] text-muted">
                #{index + 1} / {total}
              </span>
              {tags.slice(0, 5).map((t) => (
                <Badge
                  key={t}
                  tone={
                    t === "seed"
                      ? "accent"
                      : t === "watch"
                        ? "warn"
                        : t === "hi-lev"
                          ? "down"
                          : "default"
                  }
                >
                  {t === "seed"
                    ? "精选"
                    : t === "watch"
                      ? "观察中"
                      : t === "whale"
                        ? "巨鲸"
                        : t === "hi-lev"
                          ? "高杠杆"
                          : t === "empty"
                            ? "空仓"
                            : t === "low-sample"
                              ? "低样本"
                              : t === "unenriched"
                                ? "待补充"
                                : t === "no-equity"
                                  ? "无独立净值"
                                  : t === "vault-like"
                                    ? "金库/划转"
                                    : t === "extreme"
                                      ? "异常收益"
                                      : t}
                </Badge>
              ))}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <h1 className="tabular truncate text-lg font-semibold tracking-tight sm:text-xl">
                {item.displayName || shortAddress(item.address)}
              </h1>
              {item.displayName ? (
                <span className="tabular hidden text-[11px] text-faint sm:inline">
                  {shortAddress(item.address)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StarButton
              address={item.address}
              starred={starred}
              onToggle={onToggleStar}
              size={18}
            />
            <CopyButton text={item.address} size={17} />
          </div>
        </div>

        {/* hero */}
        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span>{PERIOD_LABEL[period]}</span>
              <span className="text-faint">·</span>
              <span>周期收益</span>
              {m?.stale ? <Badge tone="warn">刷新中</Badge> : null}
            </div>
            <div
              className={cn(
                "tabular mt-1 text-[42px] font-semibold leading-none tracking-tight sm:text-[52px]",
                signClass(roi),
              )}
            >
              {fmtPct(roi)}
            </div>
            <div className="tabular mt-1.5 text-sm text-muted">
              <span className={signClass(pnl)}>{fmtUsd(pnl, { sign: true })}</span>
              <span className="mx-1.5 text-faint">·</span>
              <span>成交额 {fmtUsd(vlm)}</span>
            </div>
            {m?.headline && m.roi != null && Math.abs(m.headline.roi - m.roi) > 0.005 ? (
              <div className="mt-1 text-[10px] text-faint">
                排行榜官方 ROI {fmtPct(m.headline.roi)} · 本页按资金流调整
              </div>
            ) : null}
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-[11px] text-faint">账户净值</div>
            <div className="tabular text-lg font-medium">{fmtUsd(acct)}</div>
            {m?.daysCovered ? (
              <div className="text-[10px] text-faint">
                覆盖 {fmtNum(m.daysCovered, 1)} 天
              </div>
            ) : null}
          </div>
        </div>

        {/* chart */}
        <div className="mt-3 rounded-2xl border border-border bg-panel/40 p-1">
          <div className="px-2 pt-1 text-[9px] text-faint">累计盈亏</div>
          {pending ? (
            <Skeleton className="h-[92px] w-full" />
          ) : points.length > 1 ? (
            <Sparkline points={points} height={92} />
          ) : (
            <div className="grid h-[92px] place-items-center text-[11px] text-faint">
              {error ? "数据加载失败" : "暂无净值曲线"}
            </div>
          )}
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => mutate()}
            className="mt-1 text-[10px] text-accent hover:underline"
          >
            重试
          </button>
        ) : null}

        {/* metrics */}
        <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 rounded-2xl border border-border bg-panel/40 p-3 sm:gap-x-6 sm:p-4">
          <Stat
            label="最大回撤"
            value={m?.maxDrawdown == null ? "—" : fmtPct(-m.maxDrawdown, { digits: 1, sign: false })}
            valueClass="text-down"
            pending={pending}
          />
          <Stat
            label="夏普"
            value={m?.sharpe == null ? "—" : fmtNum(m.sharpe, 2)}
            pending={pending}
            sub={m?.sharpe == null ? "样本不足" : undefined}
          />
          <Stat
            label="收益风险比"
            value={m?.calmar == null ? "—" : fmtRatio(m.calmar)}
            pending={pending}
          />
          <Stat
            label="当前杠杆"
            value={m?.grossLeverage == null ? "—" : `${fmtNum(m.grossLeverage, 2)}x`}
            pending={pending}
            sub={
              m?.netLeverage == null
                ? undefined
                : `净 ${fmtNum(m.netLeverage, 2)}x`
            }
          />
          <Stat
            label="多空名义"
            value={
              m?.grossNotional == null ? "—" : fmtUsd(m.grossNotional)
            }
            pending={pending}
            sub={
              m?.longNotional == null
                ? undefined
                : `多 ${fmtUsd(m.longNotional)} / 空 ${fmtUsd(m.shortNotional)}`
            }
          />
          <Stat
            label="集中度"
            value={
              m?.concentration == null
                ? "—"
                : fmtPct(m.concentration, { digits: 0, sign: false })
            }
            pending={pending}
            sub="Top1 / 总名义"
          />
        </div>

        {/* positions */}
        <div className="mt-3 rounded-2xl border border-border bg-panel/40 p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] text-faint">当前持仓</span>
            <span className="text-[10px] text-faint">
              {m?.positions?.length ? `${m.positions.length} 个仓位` : ""}
            </span>
          </div>
          {pending ? (
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : m?.positions?.length ? (
            <div className="space-y-1.5">
              {m.positions.slice(0, 3).map((p) => (
                <div
                  key={p.coin}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="font-medium">{p.coin}</span>
                    <span
                      className={cn(
                        "rounded px-1 text-[9px]",
                        p.side === "long"
                          ? "bg-up/10 text-up"
                          : "bg-down/10 text-down",
                      )}
                    >
                      {p.side === "long" ? "多" : "空"}
                    </span>
                    <span className="tabular truncate text-faint">
                      {fmtUsd(p.positionValue)} · {fmtNum(p.leverage, 0)}x
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular text-faint">
                      {p.holdingPending
                        ? "计算中"
                        : `${p.holdingTruncated ? "≥ " : ""}${fmtDuration(p.holdingMs)}`}
                    </span>
                    <span className={cn("tabular w-16 text-right", signClass(p.unrealizedPnl))}>
                      {fmtUsd(p.unrealizedPnl, { sign: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-faint">当前空仓</div>
          )}
        </div>

        {/* footer */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <PeriodTabs period={period} onChange={onPeriodChange} size="sm" />
          <a
            href={hyperdashUrl(item.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-panel/60 px-3 py-1.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            查看详情
            <ArrowUpRightIcon size={13} />
          </a>
        </div>

        {/* warnings */}
        {m?.warnings?.length ? (
          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-faint">
            <WarningIcon size={12} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{m.warnings[0]}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
