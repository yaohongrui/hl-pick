import { NextRequest, NextResponse } from "next/server";
import { getDeck } from "@/lib/deck";
import { guard } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = guard(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  try {
    const data = getDeck({
      period: sp.get("period") || "month",
      sort: sp.get("sort") || "roi",
      source: sp.get("source") || "all",
      minEquity: Number(sp.get("minEquity") ?? 10_000),
      minVol: Number(sp.get("minVol") ?? 500_000),
      cursor: Number(sp.get("cursor") ?? 0),
      limit: Number(sp.get("limit") ?? 50),
    });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("deck error", err);
    return NextResponse.json(
      { error: "读取地址池失败" },
      { status: 500 },
    );
  }
}
