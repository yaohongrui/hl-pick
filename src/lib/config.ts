export const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || "/add-pick";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${p}`;
}

export function appUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${p}`;
}

/** External trader detail page; address is substituted as-is. */
export function hyperdashUrl(address: string): string {
  return `https://hyperdash.com/address/${address}`;
}

export const PERIODS = ["day", "week", "month", "allTime"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  day: "1D",
  week: "7D",
  month: "30D",
  allTime: "ALL",
};

export const PERIOD_HINT: Record<Period, string> = {
  day: "最近 24 小时",
  week: "最近 7 天",
  month: "最近 30 天",
  allTime: "全部历史",
};

/** Hyperliquid portfolio response uses perp-specific windows. */
export const HL_PORTFOLIO_KEY: Record<Period, string> = {
  day: "perpDay",
  week: "perpWeek",
  month: "perpMonth",
  allTime: "perpAllTime",
};

export const SORTS = ["roi", "pnl", "vlm"] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABEL: Record<SortKey, string> = {
  roi: "收益率",
  pnl: "盈亏",
  vlm: "成交额",
};

export const SOURCES = ["all", "seed", "watchlist"] as const;
export type SourceKey = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<SourceKey, string> = {
  all: "全部地址",
  seed: "我的精选",
  watchlist: "观察列表",
};

export const DEFAULTS = {
  period: "month" as Period,
  sort: "roi" as SortKey,
  source: "all" as SourceKey,
  minEquity: 10_000,
  minVol: 500_000,
};

export const CACHE_TTL = {
  metricsFreshMs: 3 * 60_000,
  metricsStaleMs: 30 * 60_000,
  positionsMs: 30_000,
  episodesMs: 10 * 60_000,
};

export const FILLS_BUDGET = {
  pageSize: 2000,
  maxPages: 3,
  holdMaxPages: 3,
};

export const MIN_SAMPLE = {
  days: 7,
  volume: 100_000,
};
