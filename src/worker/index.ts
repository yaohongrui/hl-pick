import fs from "node:fs";
import path from "node:path";
import { getDb, finishSyncRun, startSyncRun } from "../lib/db";
import { getClearinghouseState } from "../lib/hl/client";
import { syncLeaderboard } from "../lib/leaderboard";
import { getTraderMetrics } from "../lib/trader";

const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* ignore */
  }
}

const LEADERBOARD_INTERVAL = Number(process.env.SYNC_INTERVAL || 10 * 60_000);
const SNAPSHOT_INTERVAL = Number(process.env.SNAPSHOT_INTERVAL || 15 * 60_000);
const WARM_INTERVAL = Number(process.env.WARM_INTERVAL || 60 * 60_000);
const WARM_TOP = Number(process.env.WARM_TOP || 200);
const SNAPSHOT_TOP = Number(process.env.SNAPSHOT_TOP || 300);
const WARM_ON_START = process.env.WARM_ON_START !== "0";

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), "[worker]", ...args);
}

async function runLeaderboard() {
  const r = await syncLeaderboard();
  log(
    `leaderboard ${r.status}`,
    r.status === "ok" ? `rows=${r.rows}` : "not-modified",
  );
}

function topAddresses(orderBy: string, limit: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT address FROM leaderboard
        WHERE as_of = (SELECT MAX(as_of) FROM leaderboard)
          AND account_value >= 10000
          AND month_vlm >= 500000
        ORDER BY ${orderBy} DESC
        LIMIT ?`,
    )
    .all(limit) as { address: string }[];
  return rows.map((r) => r.address);
}

async function runWarm() {
  const runId = startSyncRun("warm");
  const addresses = topAddresses("month_roi", WARM_TOP);
  log(`warming ${addresses.length} cards`);
  let ok = 0;
  let failed = 0;
  for (const address of addresses) {
    try {
      await getTraderMetrics(address, "month", {
        allowHolding: false,
        // Refresh sequentially so the shared HL limiter is not flooded by
        // hundreds of fire-and-forget background refreshes.
        backgroundRefresh: false,
      });
      ok++;
    } catch (err) {
      failed++;
      log("warm failed", address, err instanceof Error ? err.message : err);
    }
    if ((ok + failed) % 25 === 0) {
      log(`warm progress ${ok + failed}/${addresses.length}`);
    }
  }
  finishSyncRun(runId, "ok", { ok, failed, total: addresses.length });
  log(`warm done ok=${ok} failed=${failed}`);
}

async function runSnapshots() {
  const runId = startSyncRun("snapshots");
  const addresses = topAddresses("month_vlm", SNAPSHOT_TOP);
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO position_snapshots(
      address, ts, account_value, gross_notional, net_notional, gross_leverage, positions_json
    ) VALUES(?, ?, ?, ?, ?, ?, ?)
  `);
  const ts = Date.now();
  let ok = 0;
  let failed = 0;

  for (const address of addresses) {
    try {
      const ch = await getClearinghouseState(address);
      const accountValue = Number(ch.marginSummary.accountValue) || 0;
      const gross = Number(ch.marginSummary.totalNtlPos) || 0;
      let long = 0;
      let short = 0;
      for (const { position: p } of ch.assetPositions ?? []) {
        const v = Math.abs(Number(p.positionValue) || 0);
        if ((Number(p.szi) || 0) >= 0) long += v;
        else short += v;
      }
      const net = Math.abs(long - short);
      const leverage = accountValue > 0 ? gross / accountValue : 0;
      insert.run(
        address,
        ts,
        accountValue,
        gross,
        net,
        leverage,
        JSON.stringify(
          (ch.assetPositions ?? []).map(({ position: p }) => ({
            coin: p.coin,
            szi: p.szi,
            value: Number(p.positionValue) || 0,
            leverage: p.leverage?.value ?? 0,
          })),
        ),
      );
      ok++;
    } catch (err) {
      failed++;
      log("snapshot failed", address, err instanceof Error ? err.message : err);
    }
  }

  db.prepare("DELETE FROM position_snapshots WHERE ts < ?").run(
    Date.now() - 30 * 86_400_000,
  );
  finishSyncRun(runId, "ok", { ok, failed, total: addresses.length });
  log(`snapshots done ok=${ok} failed=${failed}`);
}

function every(name: string, ms: number, fn: () => Promise<void>) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void fn()
      .catch((err) => log(name, "error", err))
      .finally(() => {
        running = false;
      });
  }, ms);
  return timer;
}

async function main() {
  log("starting");
  await runLeaderboard().catch((err) => log("leaderboard error", err));

  every("leaderboard", LEADERBOARD_INTERVAL, runLeaderboard);
  every("warm", WARM_INTERVAL, runWarm);
  every("snapshots", SNAPSHOT_INTERVAL, runSnapshots);
  log(
    `scheduled leaderboard=${LEADERBOARD_INTERVAL}ms warm=${WARM_INTERVAL}ms snapshots=${SNAPSHOT_INTERVAL}ms`,
  );

  // Snapshot first (cheap, ~600 weight), then warm the card cache serially.
  await runSnapshots().catch((err) => log("snapshots error", err));
  if (WARM_ON_START) {
    await runWarm().catch((err) => log("warm error", err));
  }
}

process.on("SIGTERM", () => {
  log("SIGTERM, exiting");
  process.exit(0);
});
process.on("SIGINT", () => {
  log("SIGINT, exiting");
  process.exit(0);
});

void main();
