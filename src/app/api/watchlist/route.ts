import { NextRequest, NextResponse } from "next/server";
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
} from "@/lib/deck";
import { badRequest, guard } from "@/lib/http";
import { normalizeAddress } from "@/lib/trader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = guard(req);
  if (limited) return limited;
  return NextResponse.json(
    { items: getWatchlist() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const limited = guard(req);
  if (limited) return limited;

  let body: { address?: string; note?: string };
  try {
    body = (await req.json()) as { address?: string; note?: string };
  } catch {
    return badRequest("请求体不是合法 JSON");
  }

  const address = normalizeAddress(body.address);
  if (!address) return badRequest("地址格式不正确");
  addToWatchlist(address, body.note ?? null);
  return NextResponse.json({ ok: true, address });
}

export async function DELETE(req: NextRequest) {
  const limited = guard(req);
  if (limited) return limited;

  const fromQuery = req.nextUrl.searchParams.get("address");
  let fromBody: string | undefined;
  if (!fromQuery) {
    try {
      const body = (await req.json()) as { address?: string };
      fromBody = body.address;
    } catch {
      /* ignore */
    }
  }
  const address = normalizeAddress(fromQuery || fromBody);
  if (!address) return badRequest("地址格式不正确");
  removeFromWatchlist(address);
  return NextResponse.json({ ok: true, address });
}
