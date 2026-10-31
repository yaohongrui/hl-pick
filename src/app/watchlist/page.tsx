import { Suspense } from "react";
import { WatchlistPage } from "@/components/watchlist/WatchlistPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <WatchlistPage />
    </Suspense>
  );
}
