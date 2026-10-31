import {
  finishSyncRun,
  getDb,
  getState,
  setState,
  startSyncRun,
} from "./db";
import { fetchLeaderboard } from "./hl/client";
import type { LeaderboardRowRaw } from "./types";

const ETAG_KEY = "leaderboard_etag";
const LASTMOD_KEY = "leaderboard_last_modified";
const LAST_SYNC_KEY = "leaderboard_last_sync";

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function windows(row: LeaderboardRowRaw): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {
    day: [0, 0, 0],
    week: [0, 0, 0],
    month: [0, 0, 0],
    allTime: [0, 0, 0],
  };
  for (const [key, v] of row.windowPerformances ?? []) {
    if (!out[key]) continue;
    out[key] = [num(v.pnl), num(v.roi), num(v.vlm)];
  }
  return out;
}

export interface SyncResult {
  status: "ok" | "skipped";
  rows: number;
  asOf: number;
  downloaded: boolean;
  etag: string | null;
}

export async function syncLeaderboard(options?: {
  force?: boolean;
}): Promise<SyncResult> {
  const db = getDb();
  const runId = startSyncRun("leaderboard");
  const etag = options?.force ? null : getState(ETAG_KEY);
  const lastModified = options?.force ? null : getState(LASTMOD_KEY);

  try {
    const res = await fetchLeaderboard(etag, lastModified);
    const now = Date.now();

    if (res.notModified) {
      setState(LAST_SYNC_KEY, String(now));
      finishSyncRun(runId, "skipped", { reason: "not-modified", etag });
      return {
        status: "skipped",
        rows: 0,
        asOf: Number(getState("leaderboard_as_of") ?? 0),
        downloaded: false,
        etag: res.etag,
      };
    }

    const insert = db.prepare(`
      INSERT INTO leaderboard (
        address, as_of, account_value,
        day_pnl, day_roi, day_vlm,
        week_pnl, week_roi, week_vlm,
        month_pnl, month_roi, month_vlm,
        all_pnl, all_roi, all_vlm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        as_of = excluded.as_of,
        account_value = excluded.account_value,
        day_pnl = excluded.day_pnl, day_roi = excluded.day_roi, day_vlm = excluded.day_vlm,
        week_pnl = excluded.week_pnl, week_roi = excluded.week_roi, week_vlm = excluded.week_vlm,
        month_pnl = excluded.month_pnl, month_roi = excluded.month_roi, month_vlm = excluded.month_vlm,
        all_pnl = excluded.all_pnl, all_roi = excluded.all_roi, all_vlm = excluded.all_vlm
    `);

    const writeAll = db.transaction((rows: LeaderboardRowRaw[]) => {
      let count = 0;
      for (const row of rows) {
        const addr = row.ethAddress?.toLowerCase();
        if (!addr) continue;
        const w = windows(row);
        insert.run(
          addr,
          now,
          num(row.accountValue),
          w.day[0], w.day[1], w.day[2],
          w.week[0], w.week[1], w.week[2],
          w.month[0], w.month[1], w.month[2],
          w.allTime[0], w.allTime[1], w.allTime[2],
        );
        count++;
      }
      return count;
    });

    const count = writeAll(res.rows);
    db.prepare("DELETE FROM leaderboard WHERE as_of < ?").run(
      now - 7 * 86_400_000,
    );

    if (res.etag) setState(ETAG_KEY, res.etag);
    if (res.lastModified) setState(LASTMOD_KEY, res.lastModified);
    setState(LAST_SYNC_KEY, String(now));
    setState("leaderboard_as_of", String(now));

    finishSyncRun(runId, "ok", {
      rows: count,
      downloaded: true,
      etag: res.etag,
    });
    return {
      status: "ok",
      rows: count,
      asOf: now,
      downloaded: true,
      etag: res.etag,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncRun(runId, "error", { message });
    throw err;
  }
}

export function leaderboardAsOf(): number | null {
  const v = getState("leaderboard_as_of");
  return v ? Number(v) : null;
}

export function lastLeaderboardCheck(): number | null {
  const v = getState(LAST_SYNC_KEY);
  return v ? Number(v) : null;
}
