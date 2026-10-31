import { Suspense } from "react";
import { Deck } from "@/components/deck/Deck";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <Deck />
    </Suspense>
  );
}
