import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const buckets = new Map<string, { count: number; reset: number }>();
const MAX_KEYS = 20_000;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

export function guard(
  req: NextRequest,
  limit = Number(process.env.INBOUND_RATE_LIMIT || 90),
  windowMs = 60_000,
): NextResponse | null {
  if (buckets.size > MAX_KEYS) {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }

  const key = clientIp(req);
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now >= b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return null;
  }

  b.count += 1;
  if (b.count > limit) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((b.reset - now) / 1000)),
        },
      },
    );
  }
  return null;
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(message = "数据获取失败，请稍后重试"): NextResponse {
  return NextResponse.json({ error: message }, { status: 502 });
}
