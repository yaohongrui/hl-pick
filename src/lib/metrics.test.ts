import { describe, expect, it } from "vitest";
import {
  buildSeries,
  computeMetrics,
  computeTwr,
  dailyReturns,
  maxDrawdown,
  sharpeRatio,
} from "./metrics";
import type { HlClearinghouseState, HlPortfolio } from "./types";

describe("buildSeries", () => {
  it("aligns equity and pnl by timestamp and carries pnl forward", () => {
    const s = buildSeries(
      [
        [1, "1000"],
        [2, "1100"],
        [3, "2100"],
      ],
      [
        [1, "0"],
        [2, "100"],
      ],
    );
    expect(s).toHaveLength(3);
    expect(s[2]).toMatchObject({ ts: 3, equity: 2100, pnl: 100 });
  });

  it("falls back to equity deltas when pnl is missing", () => {
    const s = buildSeries(
      [
        [1, "1000"],
        [2, "1050"],
      ],
      [],
    );
    expect(s[1].pnl).toBe(50);
  });
});

describe("computeTwr", () => {
  it("does not let a deposit inflate returns", () => {
    // 10% gain, then a 1000 deposit with no pnl, then another ~4.76% gain
    const series = buildSeries(
      [
        [1, "1000"],
        [2, "1100"],
        [3, "2100"],
        [4, "2200"],
      ],
      [
        [1, "0"],
        [2, "100"],
        [3, "100"],
        [4, "200"],
      ],
    );
    const twr = computeTwr(series);
    expect(twr).not.toBeNull();
    // naive equity return would be +120%
    expect(twr!.roi).toBeCloseTo(0.15238, 4);
  });

  it("returns null for a single point", () => {
    expect(computeTwr([{ ts: 1, equity: 100, pnl: 0 }])).toBeNull();
  });

  it("survives zero starting equity by using a unit base", () => {
    // Account starts empty, receives a 100 deposit, then earns 10.
    const series = buildSeries(
      [
        [1, "0"],
        [2, "100"],
        [3, "110"],
      ],
      [
        [1, "0"],
        [2, "0"],
        [3, "10"],
      ],
    );
    const twr = computeTwr(series);
    expect(twr).not.toBeNull();
    expect(twr!.roi).toBeCloseTo(0.1, 6);
  });
});

describe("drawdown and sharpe", () => {
  it("computes peak-to-trough drawdown", () => {
    const dd = maxDrawdown([
      { ts: 1, value: 100 },
      { ts: 2, value: 120 },
      { ts: 3, value: 90 },
      { ts: 4, value: 110 },
    ]);
    expect(dd).toBeCloseTo(0.25, 6);
  });

  it("requires at least 7 daily returns for sharpe", () => {
    expect(sharpeRatio([0.01, 0.02, -0.01])).toBeNull();
  });

  it("annualizes a steady positive daily series", () => {
    const s = sharpeRatio(Array.from({ length: 10 }, () => 0.01));
    // zero variance -> null
    expect(s).toBeNull();
    const mixed = sharpeRatio([0.01, -0.01, 0.02, -0.005, 0.015, -0.01, 0.005, 0.01]);
    expect(mixed).not.toBeNull();
    expect(mixed!).toBeGreaterThan(0);
  });

  it("resamples the index to daily closes", () => {
    const day = 86_400_000;
    const r = dailyReturns([
      { ts: 0, value: 100 },
      { ts: day - 1, value: 110 },
      { ts: day * 2 - 1, value: 121 },
      { ts: day * 3 - 1, value: 133.1 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 6);
    expect(r[1]).toBeCloseTo(0.1, 6);
  });
});

describe("computeMetrics", () => {
  const DAY = 86_400_000;
  const portfolio: HlPortfolio = {
    perpMonth: {
      accountValueHistory: [
        [0, "10000"],
        [3 * DAY, "10500"],
        [6 * DAY, "10200"],
        [10 * DAY, "11000"],
      ],
      pnlHistory: [
        [0, "0"],
        [3 * DAY, "500"],
        [6 * DAY, "200"],
        [10 * DAY, "1000"],
      ],
      vlm: "5000000",
    },
  };

  const clearinghouse: HlClearinghouseState = {
    marginSummary: {
      accountValue: "11000",
      totalNtlPos: "22000",
      totalRawUsd: "9000",
      totalMarginUsed: "2000",
    },
    withdrawable: "9000",
    assetPositions: [
      {
        type: "oneWay",
        position: {
          coin: "BTC",
          szi: "0.1",
          leverage: { type: "cross", value: 10 },
          entryPx: "100000",
          positionValue: "11000",
          unrealizedPnl: "500",
          returnOnEquity: "0.1",
          liquidationPx: "50000",
          marginUsed: "1100",
          maxLeverage: 40,
          cumFunding: { allTime: "0", sinceOpen: "-10", sinceChange: "0" },
        },
      },
      {
        type: "oneWay",
        position: {
          coin: "ETH",
          szi: "-5",
          leverage: { type: "isolated", value: 5 },
          entryPx: "3000",
          positionValue: "11000",
          unrealizedPnl: "-200",
          returnOnEquity: "-0.05",
          liquidationPx: "4000",
          marginUsed: "2200",
          maxLeverage: 25,
          cumFunding: { allTime: "0", sinceOpen: "5", sinceChange: "0" },
        },
      },
    ],
  };

  it("computes account-level metrics and position summaries", () => {
    const m = computeMetrics({
      address: "0x0000000000000000000000000000000000000001",
      period: "month",
      portfolio,
      clearinghouse,
      headline: { roi: 0.1, pnl: 1000, vlm: 5_000_000, accountValue: 11_000, asOf: 10 * DAY },
      holding: { BTC: { entryTime: 0, truncated: false, pending: false } },
      now: 11 * DAY,
    });

    expect(m.roi).toBeCloseTo(0.1, 6);
    expect(m.pnl).toBe(1000);
    expect(m.accountValue).toBe(11000);
    expect(m.grossNotional).toBe(22000);
    expect(m.grossLeverage).toBeCloseTo(2, 6);
    expect(m.netLeverage).toBeCloseTo(0, 6);
    expect(m.longNotional).toBe(11000);
    expect(m.shortNotional).toBe(11000);
    expect(m.concentration).toBeCloseTo(0.5, 6);
    expect(m.positions).toHaveLength(2);
    expect(m.positions[0].coin).toBe("BTC");
    expect(m.positions[0].holdingMs).toBe(11 * DAY);
    expect(m.positions[1].holdingPending).toBe(true);
    expect(m.tags).not.toContain("empty");
    expect(m.lowSample).toBe(false);
  });

  it("handles empty data without NaN", () => {
    const m = computeMetrics({
      address: "0x0000000000000000000000000000000000000002",
      period: "week",
      portfolio: null,
      clearinghouse: null,
      headline: null,
      holding: {},
      now: Date.now(),
    });
    expect(m.roi).toBeNull();
    expect(m.maxDrawdown).toBeNull();
    expect(m.positions).toHaveLength(0);
    expect(Number.isNaN(m.accountValue as number)).toBe(false);
    expect(m.tags).toContain("empty");
  });
});
