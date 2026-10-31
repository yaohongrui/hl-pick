import type { Period } from "./config";

export type Side = "long" | "short";

export interface LeaderboardHeadline {
  address: string;
  accountValue: number;
  pnl: number;
  roi: number;
  vlm: number;
  asOf: number;
  source?: string;
  displayName?: string | null;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  pnl: number;
}

export interface PositionView {
  coin: string;
  side: Side;
  size: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  roe: number;
  leverage: number;
  leverageType: string;
  liquidationPx: number | null;
  marginUsed: number;
  fundingSinceOpen: number;
  holdingMs: number | null;
  holdingPending: boolean;
  holdingTruncated: boolean;
}

export interface TopCoin {
  coin: string;
  notional: number;
  side: Side;
  pnl: number;
}

export interface TraderMetrics {
  address: string;
  period: Period;
  asOf: number;
  dataTs: number;
  stale?: boolean;
  displayName?: string | null;
  source?: string;
  inWatchlist?: boolean;
  headline: {
    roi: number;
    pnl: number;
    vlm: number;
    accountValue: number;
    asOf: number;
  } | null;
  roi: number | null;
  pnl: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  calmar: number | null;
  accountValue: number | null;
  grossNotional: number | null;
  grossLeverage: number | null;
  netLeverage: number | null;
  longNotional: number | null;
  shortNotional: number | null;
  concentration: number | null;
  volume: number | null;
  equity: EquityPoint[];
  positions: PositionView[];
  topCoins: TopCoin[];
  daysCovered: number;
  lowSample: boolean;
  tags: string[];
  warnings: string[];
}

export interface PositionEpisode {
  coin: string;
  side: Side;
  entryTime: number;
  exitTime: number | null;
  holdingMs: number;
  maxSize: number;
  entryPx: number;
  exitPx: number | null;
  realizedPnl: number;
  fees: number;
  partial: boolean;
  open: boolean;
}

export interface EpisodesResponse {
  address: string;
  period: Period;
  asOf: number;
  dataTs: number;
  stale?: boolean;
  episodes: PositionEpisode[];
  truncated: boolean;
  fillsUsed: number;
  coveredFrom: number | null;
  coveredTo: number | null;
  warnings: string[];
}

export interface DeckItem {
  address: string;
  displayName: string | null;
  source: string;
  accountValue: number;
  pnl: number;
  roi: number;
  vlm: number;
  asOf: number;
  tags: string[];
  inWatchlist: boolean;
}

export interface DeckResponse {
  items: DeckItem[];
  nextCursor: number | null;
  total: number;
  asOf: number | null;
}

export interface WatchItem {
  address: string;
  note: string | null;
  addedAt: number;
  accountValue: number | null;
  monthRoi: number | null;
}

export interface PositionsResponse {
  address: string;
  asOf: number;
  accountValue: number | null;
  grossNotional: number | null;
  grossLeverage: number | null;
  netLeverage: number | null;
  longNotional: number;
  shortNotional: number;
  concentration: number | null;
  positions: PositionView[];
  pending: boolean;
}

export interface FillView {
  tid: number;
  time: number;
  coin: string;
  side: "A" | "B";
  px: number;
  sz: number;
  startPosition: number;
  closedPnl: number;
  fee: number;
  dir: string | null;
  hash: string | null;
}

export interface FillsResponse {
  address: string;
  period: string;
  asOf: number;
  fills: FillView[];
  total: number;
  shown: number;
  truncated: boolean;
  coveredFrom: number | null;
  coveredTo: number | null;
  warnings: string[];
}

/* ---------- raw Hyperliquid payloads (only fields we use) ---------- */

export type HlPeriodKey =
  | "day"
  | "week"
  | "month"
  | "allTime"
  | "perpDay"
  | "perpWeek"
  | "perpMonth"
  | "perpAllTime";

export interface HlPortfolioWindow {
  accountValueHistory: [number, string][];
  pnlHistory: [number, string][];
  vlm: string;
}

export interface HlPortfolio {
  [key: string]: HlPortfolioWindow;
}

export interface HlLeverage {
  type: string;
  value: number;
}

export interface HlPosition {
  coin: string;
  szi: string;
  leverage: HlLeverage;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  cumFunding: {
    allTime: string;
    sinceOpen: string;
    sinceChange: string;
  };
}

export interface HlClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary?: {
    accountValue: string;
    totalNtlPos: string;
  };
  withdrawable: string;
  assetPositions: { type: string; position: HlPosition }[];
}

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken: string;
  tid: number;
  twapId?: number | null;
  builderFee?: string;
}

export interface HlLedgerUpdate {
  time: number;
  hash: string;
  delta: {
    type: string;
    usdc?: string;
    [key: string]: unknown;
  };
}

export interface LeaderboardRowRaw {
  ethAddress: string;
  accountValue: string;
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
  prize: number;
  displayName: string | null;
}

export interface LeaderboardFileRaw {
  leaderboardRows: LeaderboardRowRaw[];
}
