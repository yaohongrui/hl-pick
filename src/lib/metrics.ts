import { HL_PORTFOLIO_KEY, MIN_SAMPLE, type Period } from "./config";
import type {
  EquityPoint,
  HlClearinghouseState,
  HlPortfolio,
  PositionView,
  TopCoin,
  TraderMetrics,
} from "./types";

export interface HoldingInfo {
  entryTime: number | null;
  coveredFrom?: number | null;
  truncated: boolean;
  pending: boolean;
}

export interface HeadlineInput {
  roi: number;
  pnl: number;
  vlm: number;
  accountValue: number;
  asOf: number;
}

interface SeriesPoint {
  ts: number;
  equity: number;
  pnl: number;
}

export function buildSeries(
  accountValueHistory: [number, string][] | undefined,
  pnlHistory: [number, string][] | undefined,
): SeriesPoint[] {
  const pnlMap = new Map<number, number>();
  for (const [ts, v] of pnlHistory ?? []) {
    const n = Number(v);
    if (Number.isFinite(n)) pnlMap.set(ts, n);
  }
  const points = (accountValueHistory ?? [])
    .map(([ts, v]) => ({ ts, equity: Number(v) }))
    .filter((p) => Number.isFinite(p.equity) && Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);

  if (!points.length) return [];
  const firstEquity = points[0].equity;
  let carriedPnl = 0;
  let sawPnl = false;

  return points.map((p) => {
    if (pnlMap.has(p.ts)) {
      carriedPnl = pnlMap.get(p.ts) as number;
      sawPnl = true;
      return { ts: p.ts, equity: p.equity, pnl: carriedPnl };
    }
    return {
      ts: p.ts,
      equity: p.equity,
      pnl: sawPnl ? carriedPnl : p.equity - firstEquity,
    };
  });
}

interface TwrResult {
  roi: number;
  indexPoints: { ts: number; value: number }[];
  returns: number[];
  skipped: number;
}

/**
 * Time-weighted return. External flows are implied from equity and PnL:
 * r_t = ΔPnL_t / (equity_t - ΔPnL_t). This keeps deposits/withdrawals from
 * inflating or deflating returns without needing the ledger endpoint.
 */
export function computeTwr(series: SeriesPoint[]): TwrResult | null {
  if (series.length < 2) return null;
  const base = series[0].equity > 0 ? series[0].equity : 1;
  let index = base;
  const indexPoints = [{ ts: series[0].ts, value: index }];
  const returns: number[] = [];
  let valid = 0;
  let skipped = 0;

  for (let i = 1; i < series.length; i++) {
    const dPnl = series[i].pnl - series[i - 1].pnl;
    const denominator = series[i].equity - dPnl;
    if (!Number.isFinite(dPnl) || !Number.isFinite(denominator)) return null;
    if (denominator <= 1e-9) {
      // Zero/negative equity alongside PnL usually means a vault transfer or a
      // fully withdrawn account. Skip the interval instead of poisoning the
      // whole series.
      if (Math.abs(dPnl) > 1e-9) skipped++;
      continue;
    }
    const r = Math.max(-0.999999, Math.min(10, dPnl / denominator));
    index *= 1 + r;
    indexPoints.push({ ts: series[i].ts, value: index });
    returns.push(r);
    valid++;
  }

  if (indexPoints.length < 2 || valid < 2) return null;
  const totalIntervals = series.length - 1;
  if (totalIntervals > 0 && skipped > totalIntervals * 0.2) return null;
  return { roi: index / base - 1, indexPoints, returns, skipped };
}

export function maxDrawdown(indexPoints: { ts: number; value: number }[]): number | null {
  if (indexPoints.length < 2) return null;
  let peak = -Infinity;
  let worst = 0;
  for (const p of indexPoints) {
    if (p.value > peak) peak = p.value;
    if (peak > 1e-9) {
      const dd = (peak - p.value) / peak;
      if (Number.isFinite(dd)) worst = Math.max(worst, dd);
    }
  }
  return worst;
}

export function dailyReturns(
  indexPoints: { ts: number; value: number }[],
): number[] {
  const byDay = new Map<number, number>();
  for (const p of indexPoints) {
    const day = Math.floor(p.ts / 86_400_000) * 86_400_000;
    byDay.set(day, p.value);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1][1];
    const cur = days[i][1];
    if (prev > 1e-9) out.push(cur / prev - 1);
  }
  return out;
}

export function sharpeRatio(returns: number[], annualize = 365): number | null {
  if (returns.length < 7) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std < 1e-9) return null;
  return (mean / std) * Math.sqrt(annualize);
}

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function downsample<T>(arr: T[], max = 180): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

export interface ComputeMetricsInput {
  address: string;
  period: Period;
  portfolio: HlPortfolio | null;
  clearinghouse: HlClearinghouseState | null;
  headline: HeadlineInput | null;
  holding: Record<string, HoldingInfo>;
  now: number;
  extraTags?: string[];
}

export function computeMetrics(input: ComputeMetricsInput): TraderMetrics {
  const { address, period, portfolio, clearinghouse, headline, holding, now } = input;

  const window =
    portfolio?.[HL_PORTFOLIO_KEY[period]] ?? portfolio?.[period] ?? null;
  const series = window
    ? buildSeries(window.accountValueHistory, window.pnlHistory)
    : [];

  const warnings: string[] = [];
  if (!window) warnings.push("该周期没有净值序列，部分指标回退到排行榜数据");
  if (series.length > 0 && series.length < 3) warnings.push("净值数据点偏少");

  const twr = computeTwr(series);
  const dd = twr ? maxDrawdown(twr.indexPoints) : null;
  const returns = twr ? dailyReturns(twr.indexPoints) : [];
  const sharpe = sharpeRatio(returns);

  const windowStart = series.length ? series[0] : null;
  const windowEnd = series.length ? series[series.length - 1] : null;
  const pnl = finite(windowEnd?.pnl) ?? finite(headline?.pnl);
  const roi = finite(twr?.roi) ?? finite(headline?.roi);
  const daysCovered =
    windowStart && windowEnd
      ? Math.max(0, (windowEnd.ts - windowStart.ts) / 86_400_000)
      : 0;

  if (!twr && headline) warnings.push("ROI 使用排行榜官方口径");
  if (!twr && series.length > 2) {
    warnings.push(
      "净值序列存在资金划转或零值断点，回撤与夏普不可用；图表改用累计盈亏。",
    );
  }
  if (twr && returns.length > 0 && returns.length < 7 && period !== "day") {
    warnings.push("日收益样本不足，夏普未计算");
  }

  const positionsRaw = clearinghouse?.assetPositions ?? [];
  const positions: PositionView[] = positionsRaw
    .map(({ position: p }) => {
      const signedSize = Number(p.szi) || 0;
      const side = signedSize >= 0 ? "long" : "short";
      const h = holding[p.coin];
      return {
        coin: p.coin,
        side,
        size: Math.abs(signedSize),
        entryPx: Number(p.entryPx) || 0,
        positionValue: Math.abs(Number(p.positionValue) || 0),
        unrealizedPnl: Number(p.unrealizedPnl) || 0,
        roe: Number(p.returnOnEquity) || 0,
        leverage: p.leverage?.value ?? 0,
        leverageType: p.leverage?.type ?? "cross",
        liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
        marginUsed: Number(p.marginUsed) || 0,
        fundingSinceOpen: Number(p.cumFunding?.sinceOpen) || 0,
        holdingMs:
          h?.entryTime != null
            ? Math.max(0, now - h.entryTime)
            : h?.coveredFrom != null
              ? Math.max(0, now - h.coveredFrom)
              : null,
        holdingPending: h ? h.pending : true,
        holdingTruncated: h ? h.truncated : true,
      } satisfies PositionView;
    })
    .sort((a, b) => b.positionValue - a.positionValue);

  const chAccountValue = Number(clearinghouse?.marginSummary?.accountValue);
  const lastEquity = finite(windowEnd?.equity);
  const accountValue =
    Number.isFinite(chAccountValue) && chAccountValue > 0
      ? chAccountValue
      : lastEquity != null && lastEquity > 0
        ? lastEquity
        : finite(headline?.accountValue);
  const grossNotional =
    finite(Number(clearinghouse?.marginSummary?.totalNtlPos)) ??
    finite(positions.reduce((s, p) => s + p.positionValue, 0));

  let longNotional = 0;
  let shortNotional = 0;
  for (const p of positions) {
    if (p.side === "long") longNotional += p.positionValue;
    else shortNotional += p.positionValue;
  }

  const grossLeverage =
    accountValue && accountValue > 0 && grossNotional != null
      ? grossNotional / accountValue
      : null;
  const netLeverage =
    accountValue && accountValue > 0
      ? Math.abs(longNotional - shortNotional) / accountValue
      : null;
  const concentration =
    grossNotional && grossNotional > 0
      ? Math.max(...positions.map((p) => p.positionValue)) / grossNotional
      : null;

  const topCoins: TopCoin[] = positions.slice(0, 3).map((p) => ({
    coin: p.coin,
    notional: p.positionValue,
    side: p.side,
    pnl: p.unrealizedPnl,
  }));

  const volume = finite(window ? Number(window.vlm) : null) ?? finite(headline?.vlm);
  const calmar =
    roi != null && dd != null && dd > 0.005 ? roi / dd : null;

  const lowSample =
    period === "day"
      ? (volume ?? 0) < MIN_SAMPLE.volume
      : daysCovered < MIN_SAMPLE.days || (volume ?? 0) < MIN_SAMPLE.volume;

  const tags = new Set<string>(input.extraTags ?? []);
  const noEquity =
    series.length > 0 && Math.max(...series.map((p) => p.equity)) <= 0;
  const zeroEquityRatio =
    series.length > 0
      ? series.filter((p) => p.equity <= 0).length / series.length
      : 0;
  const vaultLike = series.length > 3 && zeroEquityRatio > 0.25;
  if (noEquity) {
    tags.add("no-equity");
    warnings.push(
      "该地址没有独立的永续账户净值（可能是金库或聚合地址），回撤与夏普无法计算",
    );
  } else if (vaultLike) {
    tags.add("vault-like");
    warnings.push(
      "净值曲线多次归零，疑似金库或频繁资金划转账户；收益率与回撤仅供参考。",
    );
  }
  if ((accountValue ?? 0) >= 1_000_000) tags.add("whale");
  if ((grossLeverage ?? 0) >= 5) tags.add("hi-lev");
  if (positions.length === 0) tags.add("empty");
  if (lowSample) tags.add("low-sample");

  const extremeThreshold =
    period === "day" ? 0.5 : period === "week" ? 1.5 : period === "month" ? 3 : 20;
  if (roi != null && Math.abs(roi) > extremeThreshold) {
    tags.add("extreme");
    warnings.push(
      "周期收益率异常高，可能包含高杠杆、运气或资金划转因素；请结合回撤与样本量判断。",
    );
  }

  if (positions.length === 0) warnings.push("当前无持仓，杠杆指标为空");

  const displayEquity: EquityPoint[] = twr
    ? twr.indexPoints.map((p) => ({
        ts: p.ts,
        equity: p.value,
        pnl: p.value - twr.indexPoints[0].value,
      }))
    : series.map((p) => ({ ts: p.ts, equity: p.equity, pnl: p.pnl }));

  return {
    address,
    period,
    asOf: Date.now(),
    dataTs: Date.now(),
    headline: headline ?? null,
    roi,
    pnl,
    maxDrawdown: dd,
    sharpe,
    calmar,
    accountValue,
    grossNotional,
    grossLeverage,
    netLeverage,
    longNotional,
    shortNotional,
    concentration,
    volume,
    equity: downsample(displayEquity),
    positions,
    topCoins,
    daysCovered,
    lowSample,
    tags: [...tags],
    warnings,
  };
}
