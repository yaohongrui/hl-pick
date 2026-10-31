import type {
  HlClearinghouseState,
  HlFill,
  HlLedgerUpdate,
  HlPortfolio,
  HlPortfolioWindow,
  LeaderboardFileRaw,
} from "../types";

const INFO_URL =
  process.env.HL_API_URL || "https://api.hyperliquid.xyz/info";
const LEADERBOARD_URL =
  process.env.LEADERBOARD_URL ||
  "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

const CAP_PER_MIN = Number(process.env.HL_WEIGHT_CAP_PER_MIN || 700);

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class WeightLimiter {
  private entries: { t: number; w: number }[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly cap: number) {}

  private prune(now: number) {
    this.entries = this.entries.filter((e) => now - e.t < 60_000);
  }

  used(): number {
    const now = Date.now();
    this.prune(now);
    return this.entries.reduce((s, e) => s + e.w, 0);
  }

  acquire(weight: number): Promise<void> {
    const task = async () => {
      for (;;) {
        const now = Date.now();
        this.prune(now);
        const used = this.entries.reduce((s, e) => s + e.w, 0);
        if (used + weight <= this.cap) {
          this.entries.push({ t: now, w: weight });
          return;
        }
        const oldest = this.entries[0]?.t ?? now;
        const wait = Math.max(200, 60_000 - (now - oldest) + 50);
        await sleep(Math.min(wait, 60_000));
      }
    };
    const p = this.chain.then(task, task);
    this.chain = p.catch(() => {});
    return p;
  }

  add(weight: number) {
    if (weight > 0) this.entries.push({ t: Date.now(), w: weight });
  }
}

const limiter = new WeightLimiter(CAP_PER_MIN);

export const hlStats = {
  capPerMin: CAP_PER_MIN,
  requests: 0,
  totalWeight: 0,
  lastError: null as string | null,
  lastRequestAt: null as number | null,
};

export function currentMinuteWeight(): number {
  return limiter.used();
}

async function request<T>(body: unknown, weight: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    await limiter.acquire(weight);
    try {
      hlStats.requests += 1;
      hlStats.totalWeight += weight;
      hlStats.lastRequestAt = Date.now();
      const res = await fetch(INFO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (res.status === 429) {
        hlStats.lastError = "429 rate limited";
        await sleep(2_500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        throw new Error(`Hyperliquid ${res.status}: ${text}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      hlStats.lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 2) await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Hyperliquid request failed");
}

function fillsExtraWeight(count: number): number {
  return Math.ceil(count / 20);
}

export async function getPortfolio(
  user: string,
  period: string,
): Promise<HlPortfolio> {
  const raw = await request<unknown>({ type: "portfolio", user, period }, 20);
  // Hyperliquid returns an array of [periodKey, window] pairs. Normalize it so
  // the rest of the app can index by period key.
  if (Array.isArray(raw)) {
    const out: HlPortfolio = {};
    for (const entry of raw) {
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string"
      ) {
        out[entry[0]] = entry[1] as HlPortfolioWindow;
      }
    }
    return out;
  }
  return raw as HlPortfolio;
}

export async function getClearinghouseState(
  user: string,
): Promise<HlClearinghouseState> {
  return request<HlClearinghouseState>(
    { type: "clearinghouseState", user },
    2,
  );
}

export async function getUserFills(user: string): Promise<HlFill[]> {
  const fills = await request<HlFill[]>({ type: "userFills", user }, 20);
  limiter.add(fillsExtraWeight(fills.length));
  return fills;
}

export async function getFillsByTime(
  user: string,
  startTime: number,
  endTime?: number,
): Promise<HlFill[]> {
  const body: Record<string, unknown> = {
    type: "userFillsByTime",
    user,
    startTime,
  };
  if (endTime != null) body.endTime = endTime;
  const fills = await request<HlFill[]>(body, 20);
  limiter.add(fillsExtraWeight(fills.length));
  return fills;
}

export async function getLedgerUpdates(
  user: string,
  startTime: number,
): Promise<HlLedgerUpdate[]> {
  const updates = await request<HlLedgerUpdate[]>(
    { type: "userNonFundingLedgerUpdates", user, startTime },
    20,
  );
  limiter.add(fillsExtraWeight(updates.length));
  return updates;
}

export interface LeaderboardFetch {
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  rows: LeaderboardFileRaw["leaderboardRows"];
}

export async function fetchLeaderboard(
  etag?: string | null,
  lastModified?: string | null,
): Promise<LeaderboardFetch> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "hl-pick/0.1 (personal research)",
  };
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const res = await fetch(LEADERBOARD_URL, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  if (res.status === 304) {
    return {
      notModified: true,
      etag: res.headers.get("etag") ?? etag ?? null,
      lastModified: res.headers.get("last-modified") ?? lastModified ?? null,
      rows: [],
    };
  }
  if (!res.ok) {
    throw new Error(`Leaderboard ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as LeaderboardFileRaw;
  if (!data || !Array.isArray(data.leaderboardRows)) {
    throw new Error("Leaderboard payload has unexpected shape");
  }
  return {
    notModified: false,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    rows: data.leaderboardRows,
  };
}
