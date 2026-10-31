import { CACHE_TTL, type Period } from "./config";
import { normalizeAddress } from "./address";
import { getDb } from "./db";
import {
  getClearinghouseState,
  getPortfolio,
  hlStats,
  currentMinuteWeight,
} from "./hl/client";
import { lastSyncRun } from "./db";
import { leaderboardAsOf } from "./leaderboard";
import { computeMetrics } from "./metrics";
import {
  computeHoldings,
  getHoldingMap,
  type FillRow,
} from "./positions";
import type {
  PositionView,
  PositionsResponse,
  TraderMetrics,
} from "./types";

export { normalizeAddress };

interface AddressMeta {
  address: string;
  source: string;
  displayName: string | null;
  tags: string[];
  inWatchlist: boolean;
  exists: boolean;
}

export function getAddressMeta(address: string): AddressMeta {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.address, a.source, a.display_name,
              (w.address IS NOT NULL) AS in_watchlist
         FROM addresses a
         LEFT JOIN watchlist w ON w.address = a.address
        WHERE a.address = ?`,
    )
    .get(address) as
    | {
        address: string;
        source: string;
        display_name: string | null;
        in_watchlist: number;
      }
    | undefined;
  const w = db
    .prepare("SELECT address FROM watchlist WHERE address = ?")
    .get(address);
  if (!row) {
    return {
      address,
      source: "leaderboard",
      displayName: null,
      tags: [],
      inWatchlist: Boolean(w),
      exists: false,
    };
  }
  return {
    address,
    source: row.source,
    displayName: row.display_name,
    tags: [],
    inWatchlist: row.in_watchlist === 1,
    exists: true,
  };
}

export interface HeadlineRow {
  roi: number;
  pnl: number;
  vlm: number;
  accountValue: number;
  asOf: number;
}

export function getHeadline(
  address: string,
  period: Period,
): HeadlineRow | null {
  const prefix = period === "allTime" ? "all" : period;
  const row = getDb()
    .prepare(
      `SELECT l.as_of, l.account_value,
              l.${prefix}_pnl AS pnl, l.${prefix}_roi AS roi, l.${prefix}_vlm AS vlm
         FROM leaderboard l
        WHERE l.address = ?
          AND l.as_of = (SELECT MAX(as_of) FROM leaderboard)`,
    )
    .get(address) as
    | {
        as_of: number;
        account_value: number;
        pnl: number | null;
        roi: number | null;
        vlm: number | null;
      }
    | undefined;

  if (!row) return null;
  return {
    roi: Number(row.roi) || 0,
    pnl: Number(row.pnl) || 0,
    vlm: Number(row.vlm) || 0,
    accountValue: Number(row.account_value) || 0,
    asOf: Number(row.as_of),
  };
}

function readCache(
  address: string,
  period: Period,
): { payload: TraderMetrics; dataTs: number } | null {
  const row = getDb()
    .prepare(
      "SELECT payload_json, data_ts FROM metric_cache WHERE address = ? AND period = ?",
    )
    .get(address, period) as { payload_json: string; data_ts: number } | undefined;
  if (!row) return null;
  try {
    return {
      payload: JSON.parse(row.payload_json) as TraderMetrics,
      dataTs: Number(row.data_ts),
    };
  } catch {
    return null;
  }
}

function writeCache(address: string, period: Period, payload: TraderMetrics): void {
  getDb()
    .prepare(
      `INSERT INTO metric_cache(address, period, as_of, payload_json, data_ts)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(address, period) DO UPDATE SET
         as_of = excluded.as_of,
         payload_json = excluded.payload_json,
         data_ts = excluded.data_ts`,
    )
    .run(address, period, payload.asOf, JSON.stringify(payload), payload.dataTs);
}

const inflightMetrics = new Map<string, Promise<TraderMetrics>>();

function triggerHolding(address: string, positions: PositionView[]) {
  if (process.env.AUTO_HOLDING === "0") return;
  const pending = positions.filter((p) => p.holdingPending);
  if (!pending.length) return;
  void computeHoldings(
    address,
    pending.map((p) => ({
      coin: p.coin,
      signedSize: p.side === "long" ? p.size : -p.size,
    })),
  )
    .then(() => {
      // Let the next card refresh pick up the newly computed holding times
      // instead of serving the old payload for the full TTL.
      getDb().prepare("DELETE FROM metric_cache WHERE address = ?").run(address);
    })
    .catch(() => {});
}

async function refreshMetrics(
  address: string,
  period: Period,
  allowHolding: boolean,
): Promise<TraderMetrics> {
  const key = `${address}:${period}`;
  const existing = inflightMetrics.get(key);
  if (existing) return existing;

  const p = (async () => {
    const [portfolio, clearinghouse] = await Promise.all([
      getPortfolio(address, period),
      getClearinghouseState(address),
    ]);
    const headline = getHeadline(address, period);
    const holding = getHoldingMap(address);
    const meta = getAddressMeta(address);
    const extraTags: string[] = [];
    if (meta.source === "seed") extraTags.push("seed");
    if (meta.inWatchlist) extraTags.push("watch");

    const metrics = computeMetrics({
      address,
      period,
      portfolio,
      clearinghouse,
      headline,
      holding,
      now: Date.now(),
      extraTags,
    });
    metrics.displayName = meta.displayName;
    metrics.source = meta.source;
    metrics.inWatchlist = meta.inWatchlist;

    writeCache(address, period, metrics);
    // Only the active card (or the detail page) pays for fill-level holding
    // reconstruction; prefetched neighbours just show "计算中".
    if (allowHolding) triggerHolding(address, metrics.positions);
    return metrics;
  })();

  inflightMetrics.set(key, p);
  try {
    return await p;
  } finally {
    inflightMetrics.delete(key);
  }
}

export interface MetricsResult {
  payload: TraderMetrics;
  stale: boolean;
}

export async function getTraderMetrics(
  address: string,
  period: Period,
  options?: {
    force?: boolean;
    allowHolding?: boolean;
    backgroundRefresh?: boolean;
  },
): Promise<MetricsResult> {
  const allowHolding = options?.allowHolding !== false;
  const cached = readCache(address, period);
  const age = cached ? Date.now() - cached.dataTs : Infinity;

  if (cached && !options?.force) {
    if (age < CACHE_TTL.metricsFreshMs) {
      if (allowHolding && age > 5_000) {
        triggerHolding(address, cached.payload.positions ?? []);
      }
      return { payload: cached.payload, stale: false };
    }
    if (age < CACHE_TTL.metricsStaleMs) {
      // The warm job opts into blocking refreshes. Without this, calling
      // getTraderMetrics for hundreds of stale addresses would queue hundreds
      // of background fetches and starve the shared rate limiter.
      if (options?.backgroundRefresh === false) {
        try {
          const payload = await refreshMetrics(address, period, allowHolding);
          return { payload, stale: false };
        } catch {
          return { payload: { ...cached.payload, stale: true }, stale: true };
        }
      }
      void refreshMetrics(address, period, allowHolding).catch(() => {});
      if (allowHolding && age > 5_000) {
        triggerHolding(address, cached.payload.positions ?? []);
      }
      return { payload: { ...cached.payload, stale: true }, stale: true };
    }
  }

  try {
    const payload = await refreshMetrics(address, period, allowHolding);
    return { payload, stale: false };
  } catch (err) {
    if (cached) {
      return { payload: { ...cached.payload, stale: true }, stale: true };
    }
    throw err;
  }
}

/* ---------------- positions ---------------- */

const positionsMemory = new Map<
  string,
  { ts: number; payload: PositionsResponse }
>();
const inflightPositions = new Map<string, Promise<PositionsResponse>>();

export async function getPositionsPayload(
  address: string,
  options?: { force?: boolean },
): Promise<PositionsResponse> {
  const mem = positionsMemory.get(address);
  if (
    mem &&
    !options?.force &&
    Date.now() - mem.ts < CACHE_TTL.positionsMs &&
    !mem.payload.pending
  ) {
    return mem.payload;
  }

  const existing = inflightPositions.get(address);
  if (existing) return existing;

  const p = (async () => {
    try {
      const ch = await getClearinghouseState(address);
      const holding = getHoldingMap(address);
      const snapshot = computeMetrics({
        address,
        period: "day",
        portfolio: null,
        clearinghouse: ch,
        headline: null,
        holding,
        now: Date.now(),
      });

      const pending = snapshot.positions.some((p) => p.holdingPending);
      if (pending) {
        const signed = (ch.assetPositions ?? []).map(({ position }) => ({
          coin: position.coin,
          signedSize: Number(position.szi) || 0,
        }));
        void computeHoldings(address, signed).catch(() => {});
      }

      const payload: PositionsResponse = {
        address,
        asOf: Date.now(),
        accountValue: snapshot.accountValue,
        grossNotional: snapshot.grossNotional,
        grossLeverage: snapshot.grossLeverage,
        netLeverage: snapshot.netLeverage,
        longNotional: snapshot.longNotional ?? 0,
        shortNotional: snapshot.shortNotional ?? 0,
        concentration: snapshot.concentration,
        positions: snapshot.positions,
        pending,
      };
      positionsMemory.set(address, { ts: Date.now(), payload });
      return payload;
    } catch (err) {
      if (mem) return mem.payload;
      throw err;
    }
  })();

  inflightPositions.set(address, p);
  try {
    return await p;
  } finally {
    inflightPositions.delete(address);
  }
}

/* ---------------- status ---------------- */

export function getStatus() {
  const db = getDb();
  const counts = {
    leaderboard: (db.prepare("SELECT COUNT(*) AS c FROM leaderboard").get() as { c: number }).c,
    seed: (db.prepare("SELECT COUNT(*) AS c FROM addresses WHERE source='seed'").get() as { c: number }).c,
    watchlist: (db.prepare("SELECT COUNT(*) AS c FROM watchlist").get() as { c: number }).c,
    cachedMetrics: (db.prepare("SELECT COUNT(*) AS c FROM metric_cache").get() as { c: number }).c,
    storedFills: (db.prepare("SELECT COUNT(*) AS c FROM fills").get() as { c: number }).c,
  };
  return {
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || "/add-pick",
    leaderboardAsOf: leaderboardAsOf(),
    leaderboardSync: lastSyncRun("leaderboard"),
    warmSync: lastSyncRun("warm"),
    snapshotsSync: lastSyncRun("snapshots"),
    hl: {
      ...hlStats,
      currentMinuteWeight: currentMinuteWeight(),
    },
    counts,
    now: Date.now(),
  };
}

export type { FillRow };
