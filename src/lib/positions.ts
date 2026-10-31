import { CACHE_TTL, type Period } from "./config";
import { getDb, getState, setState } from "./db";
import { getUserFills } from "./hl/client";
import type {
  EpisodesResponse,
  HlFill,
  PositionEpisode,
  Side,
} from "./types";

export interface FillRow {
  address: string;
  tid: number;
  time: number;
  coin: string;
  px: number;
  sz: number;
  side: "A" | "B";
  start_position: number;
  closed_pnl: number;
  fee: number;
  dir: string | null;
  hash: string | null;
}

const inflightFills = new Map<string, Promise<void>>();

function toRow(address: string, f: HlFill): FillRow | null {
  const tid = Number(f.tid);
  const time = Number(f.time);
  const px = Number(f.px);
  const sz = Number(f.sz);
  const start = Number(f.startPosition);
  if (![tid, time, px, sz, start].every(Number.isFinite)) return null;
  return {
    address,
    tid,
    time,
    coin: f.coin,
    px,
    sz,
    side: f.side,
    start_position: start,
    closed_pnl: Number(f.closedPnl) || 0,
    fee: Number(f.fee) || 0,
    dir: f.dir ?? null,
    hash: f.hash ?? null,
  };
}

export function storeFills(address: string, fills: HlFill[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO fills(
      address, tid, time, coin, px, sz, side, start_position,
      closed_pnl, fee, dir, hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let n = 0;
  const tx = db.transaction((rows: FillRow[]) => {
    for (const r of rows) {
      const info = stmt.run(
        r.address, r.tid, r.time, r.coin, r.px, r.sz, r.side,
        r.start_position, r.closed_pnl, r.fee, r.dir, r.hash,
      );
      n += info.changes;
    }
  });
  const rows = fills.map((f) => toRow(address, f)).filter(Boolean) as FillRow[];
  tx(rows);
  return n;
}

/**
 * Fetch the most recent 2000 fills and merge them into local storage.
 * Hyperliquid's per-user fill history is capped at 2000 per response; for
 * very high-frequency accounts that is only minutes of data — callers must
 * surface the truncation rather than pretend the history is complete.
 */
export async function ensureRecentFills(
  address: string,
  maxAgeMs = 5 * 60_000,
): Promise<void> {
  const key = `fills_fetch:${address}`;
  const last = Number(getState(key) ?? 0);
  if (last && Date.now() - last < maxAgeMs) return;

  const existing = inflightFills.get(address);
  if (existing) return existing;

  const p = (async () => {
    try {
      const fills = await getUserFills(address);
      storeFills(address, fills);
      setState(key, String(Date.now()));
    } catch (err) {
      // Back off for the same TTL after a failure instead of retrying on every
      // 5-second poll while Hyperliquid is unavailable.
      setState(key, String(Date.now()));
      throw err;
    } finally {
      inflightFills.delete(address);
    }
  })();
  inflightFills.set(address, p);
  return p;
}

export function loadFills(
  address: string,
  sinceTime?: number,
): FillRow[] {
  const db = getDb();
  const rows = sinceTime
    ? db
        .prepare(
          "SELECT * FROM fills WHERE address = ? AND time >= ? ORDER BY time ASC, tid ASC",
        )
        .all(address, sinceTime)
    : db
        .prepare("SELECT * FROM fills WHERE address = ? ORDER BY time ASC, tid ASC")
        .all(address);
  return rows as FillRow[];
}

function loadCoinFills(address: string, coin: string): FillRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM fills WHERE address = ? AND coin = ? ORDER BY time ASC, tid ASC",
    )
    .all(address, coin) as FillRow[];
}

export interface HoldingResult {
  entryTime: number | null;
  truncated: boolean;
  coveredFrom: number | null;
}

/**
 * Find the fill that established the current position direction. If we cannot
 * see a zero/opposite startPosition, the position predates our fill window.
 */
export function computeEntryTime(
  fills: FillRow[],
  currentSignedSize: number,
): HoldingResult {
  if (!fills.length) return { entryTime: null, truncated: true, coveredFrom: null };
  const wantLong = currentSignedSize > 0;
  let pos = fills[0].start_position;
  let entryTime: number | null = null;

  for (const f of fills) {
    const signed = f.side === "B" ? f.sz : -f.sz;
    const next = pos + signed;
    if (wantLong ? pos <= 0 && next > 0 : pos >= 0 && next < 0) {
      entryTime = f.time;
    }
    pos = next;
  }

  const matches = Math.sign(pos) === Math.sign(currentSignedSize);

  return {
    entryTime,
    truncated: entryTime == null || !matches,
    coveredFrom: fills[0].time,
  };
}

export function getHoldingMap(address: string): Record<
  string,
  {
    entryTime: number | null;
    coveredFrom: number | null;
    truncated: boolean;
    pending: boolean;
  }
> {
  const rows = getDb()
    .prepare(
      "SELECT coin, entry_time, covered_from, truncated, data_ts FROM position_holding WHERE address = ?",
    )
    .all(address) as {
    coin: string;
    entry_time: number | null;
    covered_from: number | null;
    truncated: number;
    data_ts: number;
  }[];
  const now = Date.now();
  const out: Record<
    string,
    {
      entryTime: number | null;
      coveredFrom: number | null;
      truncated: boolean;
      pending: boolean;
    }
  > = {};
  for (const r of rows) {
    out[r.coin] = {
      entryTime: r.entry_time,
      coveredFrom: r.covered_from,
      truncated: r.truncated === 1,
      // Positions change; refresh holding-time reconstruction periodically.
      pending: now - Number(r.data_ts) > 10 * 60_000,
    };
  }
  return out;
}

export function saveHolding(
  address: string,
  coin: string,
  entryTime: number | null,
  coveredFrom: number | null,
  truncated: boolean,
): void {
  getDb()
    .prepare(
      `INSERT INTO position_holding(address, coin, entry_time, covered_from, truncated, data_ts)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(address, coin) DO UPDATE SET
         entry_time = excluded.entry_time,
         covered_from = excluded.covered_from,
         truncated = excluded.truncated,
         data_ts = excluded.data_ts`,
    )
    .run(address, coin, entryTime, coveredFrom, truncated ? 1 : 0, Date.now());
}

const inflightHoldings = new Map<string, Promise<void>>();

export async function computeHoldings(
  address: string,
  positions: { coin: string; signedSize: number }[],
): Promise<void> {
  if (!positions.length) return;
  const existing = inflightHoldings.get(address);
  if (existing) return existing;

  const p = (async () => {
    try {
      await ensureRecentFills(address);
      for (const pos of positions) {
        const fills = loadCoinFills(address, pos.coin);
        const res = computeEntryTime(fills, pos.signedSize);
        saveHolding(address, pos.coin, res.entryTime, res.coveredFrom, res.truncated);
      }
    } finally {
      inflightHoldings.delete(address);
    }
  })();
  inflightHoldings.set(address, p);
  return p;
}

/* ---------------- episode reconstruction ---------------- */

interface MutableEpisode {
  coin: string;
  side: Side;
  entryTime: number;
  exitTime: number | null;
  maxSize: number;
  openQty: number;
  entryNotional: number;
  exitQty: number;
  exitNotional: number;
  realizedPnl: number;
  fees: number;
  partial: boolean;
}

function finalize(ep: MutableEpisode, now: number): PositionEpisode {
  const open = ep.exitTime == null;
  return {
    coin: ep.coin,
    side: ep.side,
    entryTime: ep.entryTime,
    exitTime: ep.exitTime,
    holdingMs: Math.max(0, (ep.exitTime ?? now) - ep.entryTime),
    maxSize: ep.maxSize,
    entryPx: ep.openQty > 0 ? ep.entryNotional / ep.openQty : 0,
    exitPx: ep.exitQty > 0 ? ep.exitNotional / ep.exitQty : null,
    realizedPnl: ep.realizedPnl,
    fees: ep.fees,
    partial: ep.partial,
    open,
  };
}

export function rebuildEpisodes(
  fills: FillRow[],
  periodStart: number,
  now: number,
): {
  episodes: PositionEpisode[];
  truncated: boolean;
  warnings: string[];
  coveredFrom: number | null;
  coveredTo: number | null;
} {
  if (!fills.length) {
    return {
      episodes: [],
      truncated: true,
      warnings: ["没有可用的成交数据"],
      coveredFrom: null,
      coveredTo: null,
    };
  }

  const byCoin = new Map<string, FillRow[]>();
  for (const f of fills) {
    const arr = byCoin.get(f.coin) ?? [];
    arr.push(f);
    byCoin.set(f.coin, arr);
  }

  const episodes: PositionEpisode[] = [];
  const pushEpisode = (e: PositionEpisode) => {
    // Ignore floating-point dust positions that Hyperliquid sometimes emits.
    if (e.maxSize * Math.abs(e.entryPx) < 1) return;
    episodes.push(e);
  };
  let sawPartial = false;

  for (const [coin, coinFills] of byCoin) {
    coinFills.sort((a, b) => a.time - b.time || a.tid - b.tid);
    let pos = coinFills[0].start_position;
    let ep: MutableEpisode | null = null;

    const openEpisode = (
      side: Side,
      qty: number,
      price: number,
      time: number,
      partial: boolean,
    ): MutableEpisode => ({
      coin,
      side,
      entryTime: time,
      exitTime: null,
      maxSize: qty,
      openQty: qty,
      entryNotional: price * qty,
      exitQty: 0,
      exitNotional: 0,
      realizedPnl: 0,
      fees: 0,
      partial,
    });

    if (pos !== 0) {
      ep = openEpisode(pos > 0 ? "long" : "short", Math.abs(pos), coinFills[0].px, coinFills[0].time, true);
    }

    for (const f of coinFills) {
      const signed = f.side === "B" ? f.sz : -f.sz;
      const next = pos + signed;
      const sameSign = pos === 0 || next === 0 || pos * next > 0;

      if (ep) ep.fees += f.fee;

      if (pos === 0 && next !== 0) {
        ep = openEpisode(next > 0 ? "long" : "short", Math.abs(next), f.px, f.time, false);
        ep.fees += f.fee;
      } else if (ep && sameSign) {
        const absPrev = Math.abs(pos);
        const absNext = Math.abs(next);
        if (absNext > absPrev) {
          // adding
          ep.openQty += absNext - absPrev;
          ep.entryNotional += f.px * (absNext - absPrev);
          ep.maxSize = Math.max(ep.maxSize, absNext);
        } else if (absNext < absPrev) {
          // reducing
          const closedQty = absPrev - absNext;
          ep.exitQty += closedQty;
          ep.exitNotional += f.px * closedQty;
          ep.realizedPnl += f.closed_pnl;
          ep.maxSize = Math.max(ep.maxSize, absNext);
        }
        if (next === 0 && ep) {
          ep.exitTime = f.time;
          pushEpisode(finalize(ep, now));
          ep = null;
        }
      } else if (ep && pos * next < 0) {
        // flip: close old, open new remainder
        const closedQty = Math.abs(pos);
        ep.exitQty += closedQty;
        ep.exitNotional += f.px * closedQty;
        ep.realizedPnl += f.closed_pnl;
        ep.exitTime = f.time;
        pushEpisode(finalize(ep, now));
        // The flip fill's fee was already charged to the closing episode.
        ep = openEpisode(next > 0 ? "long" : "short", Math.abs(next), f.px, f.time, false);
      }
      pos = next;
    }

    if (ep) pushEpisode(finalize(ep, now));
  }

  const coveredFrom = Math.min(...fills.map((f) => f.time));
  const coveredTo = Math.max(...fills.map((f) => f.time));
  sawPartial = episodes.some((e) => e.partial);
  const truncated = coveredFrom > periodStart || sawPartial;

  const overlapping = episodes
    .filter((e) => (e.exitTime ?? now) >= periodStart)
    .sort((a, b) => b.entryTime - a.entryTime);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      "成交数据未覆盖完整周期，更早的仓位可能未包含；高频账户的可用历史会更短。",
    );
  }

  return { episodes: overlapping, truncated, warnings, coveredFrom, coveredTo };
}

export function periodStart(period: Period, now: number): number {
  switch (period) {
    case "day":
      return now - 86_400_000;
    case "week":
      return now - 7 * 86_400_000;
    case "month":
      return now - 30 * 86_400_000;
    case "allTime":
      return 0;
  }
}

export function getCachedEpisodes(
  address: string,
  period: Period,
): { payload: EpisodesResponse; dataTs: number } | null {
  const row = getDb()
    .prepare(
      "SELECT payload_json, data_ts FROM position_episodes WHERE address = ? AND period = ?",
    )
    .get(address, period) as { payload_json: string; data_ts: number } | undefined;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload_json) as EpisodesResponse, dataTs: row.data_ts };
  } catch {
    return null;
  }
}

export function saveEpisodes(
  address: string,
  period: Period,
  payload: EpisodesResponse,
  truncated: boolean,
): void {
  getDb()
    .prepare(
      `INSERT INTO position_episodes(address, period, as_of, payload_json, data_ts, truncated)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(address, period) DO UPDATE SET
         as_of = excluded.as_of,
         payload_json = excluded.payload_json,
         data_ts = excluded.data_ts,
         truncated = excluded.truncated`,
    )
    .run(address, period, payload.asOf, JSON.stringify(payload), payload.dataTs, truncated ? 1 : 0);
}

const inflightEpisodes = new Map<string, Promise<EpisodesResponse>>();

export async function buildEpisodes(
  address: string,
  period: Period,
  options?: { force?: boolean },
): Promise<{ payload: EpisodesResponse; stale: boolean }> {
  const key = `${address}:${period}`;
  const cached = getCachedEpisodes(address, period);
  const fresh =
    cached && Date.now() - cached.dataTs < CACHE_TTL.episodesMs;

  if (cached && fresh && !options?.force) {
    return { payload: cached.payload, stale: false };
  }

  const existing = inflightEpisodes.get(key);
  if (existing) {
    const payload = await existing;
    return { payload, stale: false };
  }

  const p = (async () => {
    const now = Date.now();
    const start = periodStart(period, now);
    await ensureRecentFills(address);
    const fills = loadFills(address, start > 0 ? start : undefined);
    const rebuilt = rebuildEpisodes(fills, start, now);
    const payload: EpisodesResponse = {
      address,
      period,
      asOf: now,
      dataTs: now,
      episodes: rebuilt.episodes,
      truncated: rebuilt.truncated,
      fillsUsed: fills.length,
      coveredFrom: rebuilt.coveredFrom,
      coveredTo: rebuilt.coveredTo,
      warnings: rebuilt.warnings,
    };
    saveEpisodes(address, period, payload, rebuilt.truncated);
    return payload;
  })();

  inflightEpisodes.set(key, p);
  try {
    const payload = await p;
    return { payload, stale: false };
  } catch (err) {
    if (cached) {
      return { payload: { ...cached.payload, stale: true }, stale: true };
    }
    throw err;
  } finally {
    inflightEpisodes.delete(key);
  }
}
