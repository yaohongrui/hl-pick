import { type Period, type SortKey, type SourceKey } from "./config";
import { getDb } from "./db";
import type { DeckItem, DeckResponse, WatchItem } from "./types";

const PERIOD_PREFIX: Record<Period, string> = {
  day: "day",
  week: "week",
  month: "month",
  allTime: "all",
};

const SORT_COLUMN: Record<SortKey, string> = {
  roi: "roi",
  pnl: "pnl",
  vlm: "vlm",
};

function isPeriod(v: string): v is Period {
  return v === "day" || v === "week" || v === "month" || v === "allTime";
}
function isSort(v: string): v is SortKey {
  return v === "roi" || v === "pnl" || v === "vlm";
}
function isSource(v: string): v is SourceKey {
  return v === "all" || v === "seed" || v === "watchlist";
}

export interface DeckQuery {
  period: string;
  sort: string;
  source: string;
  minEquity: number;
  minVol: number;
  cursor: number;
  limit: number;
}

export function getDeck(q: DeckQuery): DeckResponse {
  const period: Period = isPeriod(q.period) ? q.period : "month";
  const sort: SortKey = isSort(q.sort) ? q.sort : "roi";
  const source: SourceKey = isSource(q.source) ? q.source : "all";
  const p = PERIOD_PREFIX[period];
  const sortCol = `${p}_${SORT_COLUMN[sort]}`;
  const offset = Math.max(0, Math.floor(q.cursor) || 0);
  const limit = Math.min(100, Math.max(1, Math.floor(q.limit) || 50));

  const db = getDb();

  const sql = `
    WITH latest AS (
      SELECT MAX(as_of) AS as_of FROM leaderboard
    ),
    base AS (
      SELECT l.address, l.as_of, l.account_value,
             l.day_pnl, l.day_roi, l.day_vlm,
             l.week_pnl, l.week_roi, l.week_vlm,
             l.month_pnl, l.month_roi, l.month_vlm,
             l.all_pnl, l.all_roi, l.all_vlm
        FROM leaderboard l, latest
       WHERE l.as_of = latest.as_of
      UNION ALL
      SELECT a.address, 0 AS as_of, 0 AS account_value,
             0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        FROM addresses a, latest
       WHERE a.excluded = 0
         AND a.source IN ('seed', 'manual', 'watch')
         AND NOT EXISTS (
           SELECT 1 FROM leaderboard l2, latest
            WHERE l2.address = a.address AND l2.as_of = latest.as_of
         )
    )
    SELECT b.address,
           b.as_of,
           b.account_value,
           b.${p}_pnl AS pnl,
           b.${p}_roi AS roi,
           b.${p}_vlm AS vlm,
           CASE
             WHEN w.address IS NOT NULL THEN 'watchlist'
             WHEN a.source = 'seed' THEN 'seed'
             WHEN a.source IS NOT NULL THEN a.source
             ELSE 'leaderboard'
           END AS source,
           a.display_name,
           CASE WHEN w.address IS NULL THEN 0 ELSE 1 END AS in_watchlist,
           COUNT(*) OVER() AS total
      FROM base b
      LEFT JOIN addresses a ON a.address = b.address
      LEFT JOIN watchlist w ON w.address = b.address
     WHERE (b.as_of = 0 OR b.account_value >= @minEquity)
       AND (b.as_of = 0 OR b.${p}_vlm >= @minVol)
       AND (
         @source = 'all'
         OR (@source = 'seed' AND a.source = 'seed')
         OR (@source = 'watchlist' AND w.address IS NOT NULL)
       )
     ORDER BY (b.as_of = 0) ASC, b.${sortCol} DESC NULLS LAST,
              b.account_value DESC, b.address ASC
     LIMIT @limit OFFSET @offset
  `;

  const rows = db
    .prepare(sql)
    .all({
      minEquity: q.minEquity,
      minVol: q.minVol,
      source,
      limit,
      offset,
    }) as {
    address: string;
    as_of: number;
    account_value: number;
    pnl: number | null;
    roi: number | null;
    vlm: number | null;
    source: string;
    display_name: string | null;
    in_watchlist: number;
    total: number;
  }[];

  const total = rows[0]?.total ?? 0;
  const asOfRow = db
    .prepare("SELECT MAX(as_of) AS as_of FROM leaderboard")
    .get() as { as_of: number | null } | undefined;

  const items: DeckItem[] = rows.map((r) => {
    const tags: string[] = [];
    if ((r.account_value ?? 0) >= 1_000_000) tags.push("whale");
    if ((r.vlm ?? 0) < 100_000) tags.push("low-sample");
    if (r.source === "seed") tags.push("seed");
    if (r.in_watchlist === 1) tags.push("watch");
    if (r.as_of === 0) tags.push("unenriched");
    const extremeThreshold =
      period === "day" ? 0.5 : period === "week" ? 1.5 : period === "month" ? 3 : 20;
    if (Math.abs(Number(r.roi) || 0) > extremeThreshold) tags.push("extreme");
    return {
      address: r.address,
      displayName: r.display_name,
      source: r.source,
      accountValue: Number(r.account_value) || 0,
      pnl: Number(r.pnl) || 0,
      roi: Number(r.roi) || 0,
      vlm: Number(r.vlm) || 0,
      asOf: Number(r.as_of) || 0,
      tags,
      inWatchlist: r.in_watchlist === 1,
    };
  });

  const next =
    items.length === limit && offset + items.length < total
      ? offset + items.length
      : null;

  return {
    items,
    nextCursor: next,
    total,
    asOf: asOfRow?.as_of ?? null,
  };
}

export function getWatchlist(): WatchItem[] {
  const rows = getDb()
    .prepare(
      `SELECT w.address, w.note, w.added_at,
              l.account_value, l.month_roi
         FROM watchlist w
         LEFT JOIN leaderboard l
           ON l.address = w.address
          AND l.as_of = (SELECT MAX(as_of) FROM leaderboard)
        ORDER BY w.added_at DESC`,
    )
    .all() as {
    address: string;
    note: string | null;
    added_at: number;
    account_value: number | null;
    month_roi: number | null;
  }[];
  return rows.map((r) => ({
    address: r.address,
    note: r.note,
    addedAt: Number(r.added_at),
    accountValue: r.account_value == null ? null : Number(r.account_value),
    monthRoi: r.month_roi == null ? null : Number(r.month_roi),
  }));
}

export function addToWatchlist(address: string, note?: string | null): void {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO addresses(address, source, display_name, tags, excluded, first_seen, last_seen)
       VALUES(?, 'watch', NULL, NULL, 0, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         source = CASE WHEN addresses.source = 'seed' THEN 'seed' ELSE 'watch' END,
         last_seen = excluded.last_seen`,
    ).run(address, now, now);
    db.prepare(
      `INSERT INTO watchlist(address, note, added_at) VALUES(?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET note = COALESCE(excluded.note, watchlist.note)`,
    ).run(address, note ?? null, now);
  });
  tx();
}

export function removeFromWatchlist(address: string): void {
  getDb().prepare("DELETE FROM watchlist WHERE address = ?").run(address);
}

export function isInWatchlist(address: string): boolean {
  return Boolean(
    getDb().prepare("SELECT 1 FROM watchlist WHERE address = ?").get(address),
  );
}
