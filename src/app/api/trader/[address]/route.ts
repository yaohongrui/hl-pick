import { NextRequest, NextResponse } from "next/server";
import { guard, badRequest, serverError } from "@/lib/http";
import { getTraderMetrics, normalizeAddress } from "@/lib/trader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PERIODS = new Set(["day", "week", "month", "allTime"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const limited = guard(req);
  if (limited) return limited;

  const { address: raw } = await params;
  const address = normalizeAddress(raw);
  if (!address) return badRequest("地址格式不正确");

  const periodParam = req.nextUrl.searchParams.get("period") || "month";
  if (!PERIODS.has(periodParam)) return badRequest("周期参数不正确");
  const force = req.nextUrl.searchParams.get("force") === "1";
  const allowHolding = req.nextUrl.searchParams.get("hold") !== "0";

  try {
    const result = await getTraderMetrics(
      address,
      periodParam as "day" | "week" | "month" | "allTime",
      { force, allowHolding },
    );
    return NextResponse.json(result.payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("trader error", address, err);
    return serverError();
  }
}
