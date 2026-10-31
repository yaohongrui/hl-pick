import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/http";
import { getStatus } from "@/lib/trader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = guard(req, 240);
  if (limited) return limited;
  return NextResponse.json(getStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
