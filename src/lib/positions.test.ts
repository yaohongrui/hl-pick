import { describe, expect, it } from "vitest";
import {
  computeEntryTime,
  rebuildEpisodes,
  type FillRow,
} from "./positions";

function fill(partial: Partial<FillRow> & Pick<FillRow, "time" | "start_position" | "sz" | "side">): FillRow {
  return {
    address: "0x0000000000000000000000000000000000000001",
    tid: partial.time,
    coin: "BTC",
    px: 100,
    closed_pnl: 0,
    fee: 0,
    dir: null,
    hash: null,
    ...partial,
  };
}

describe("rebuildEpisodes", () => {
  it("builds one episode with weighted entry/exit and realized pnl", () => {
    const fills: FillRow[] = [
      fill({ time: 1, start_position: 0, sz: 10, side: "B", px: 100, fee: 1 }),
      fill({ time: 2, start_position: 10, sz: 5, side: "B", px: 110, fee: 1 }),
      fill({ time: 3, start_position: 15, sz: 5, side: "A", px: 120, fee: 1, closed_pnl: 50 }),
      fill({ time: 4, start_position: 10, sz: 10, side: "A", px: 90, fee: 1, closed_pnl: -200 }),
    ];
    const r = rebuildEpisodes(fills, 1, 10);
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0];
    expect(e.side).toBe("long");
    expect(e.entryTime).toBe(1);
    expect(e.exitTime).toBe(4);
    expect(e.holdingMs).toBe(3);
    expect(e.maxSize).toBe(15);
    expect(e.entryPx).toBeCloseTo((100 * 10 + 110 * 5) / 15, 6);
    expect(e.exitPx).toBeCloseTo((120 * 5 + 90 * 10) / 15, 6);
    expect(e.realizedPnl).toBe(-150);
    expect(e.fees).toBe(4);
    expect(e.partial).toBe(false);
    expect(e.open).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it("splits a flip into a closed and an open episode", () => {
    const fills: FillRow[] = [
      fill({ time: 1, start_position: 0, sz: 10, side: "B", px: 100 }),
      fill({ time: 2, start_position: 10, sz: 20, side: "A", px: 120, closed_pnl: 200 }),
    ];
    const r = rebuildEpisodes(fills, 0, 5);
    expect(r.episodes).toHaveLength(2);
    const closed = r.episodes.find((e) => !e.open)!;
    const opened = r.episodes.find((e) => e.open)!;
    expect(closed.side).toBe("long");
    expect(closed.realizedPnl).toBe(200);
    expect(closed.exitTime).toBe(2);
    expect(opened.side).toBe("short");
    expect(opened.entryTime).toBe(2);
    expect(opened.maxSize).toBe(10);
    expect(opened.holdingMs).toBe(3);
  });

  it("marks an episode partial when the window starts mid-position", () => {
    const fills: FillRow[] = [
      fill({ time: 5, start_position: 7, sz: 3, side: "B", px: 100 }),
      fill({ time: 6, start_position: 10, sz: 10, side: "A", px: 110, closed_pnl: 50 }),
    ];
    const r = rebuildEpisodes(fills, 0, 10);
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0].partial).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it("reports truncation when coverage does not reach the period start", () => {
    const fills: FillRow[] = [
      fill({ time: 10, start_position: 0, sz: 1, side: "B", px: 100 }),
      fill({ time: 11, start_position: 1, sz: 1, side: "A", px: 110, closed_pnl: 10 }),
    ];
    const r = rebuildEpisodes(fills, 5, 20);
    expect(r.truncated).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("handles no fills", () => {
    const r = rebuildEpisodes([], 0, 10);
    expect(r.episodes).toEqual([]);
    expect(r.truncated).toBe(true);
  });
});

describe("computeEntryTime", () => {
  it("finds the last zero/opposite-to-current transition", () => {
    const fills: FillRow[] = [
      fill({ time: 1, start_position: 0, sz: 10, side: "B" }),
      fill({ time: 2, start_position: 10, sz: 10, side: "A" }),
      fill({ time: 3, start_position: 0, sz: 5, side: "B" }),
      fill({ time: 4, start_position: 5, sz: 2, side: "B" }),
    ];
    const res = computeEntryTime(fills, 7);
    expect(res.entryTime).toBe(3);
    expect(res.truncated).toBe(false);
  });

  it("reports truncation when the position predates coverage", () => {
    const fills: FillRow[] = [
      fill({ time: 1, start_position: 10, sz: 2, side: "B" }),
      fill({ time: 2, start_position: 12, sz: 1, side: "B" }),
    ];
    const res = computeEntryTime(fills, 13);
    expect(res.entryTime).toBeNull();
    expect(res.truncated).toBe(true);
    expect(res.coveredFrom).toBe(1);
  });

  it("flags truncation when the reconstructed direction does not match", () => {
    const fills: FillRow[] = [
      fill({ time: 1, start_position: 0, sz: 10, side: "B" }),
    ];
    const res = computeEntryTime(fills, -5);
    expect(res.entryTime).toBeNull();
    expect(res.truncated).toBe(true);
  });

  it("tolerates size drift while the direction still matches", () => {
    const fills: FillRow[] = [
      fill({ time: 1, start_position: 0, sz: 10, side: "B" }),
    ];
    const res = computeEntryTime(fills, 7);
    expect(res.entryTime).toBe(1);
    expect(res.truncated).toBe(false);
  });
});
