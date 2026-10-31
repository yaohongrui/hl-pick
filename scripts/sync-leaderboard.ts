import { syncLeaderboard } from "../src/lib/leaderboard";

const force = process.argv.includes("--force");

syncLeaderboard({ force })
  .then((r) => {
    if (r.status === "skipped") {
      console.log(
        `[leaderboard] not modified (etag ${r.etag ?? "n/a"}), last as_of ${new Date(r.asOf).toISOString()}`,
      );
    } else {
      console.log(
        `[leaderboard] synced ${r.rows} rows at ${new Date(r.asOf).toISOString()}`,
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("[leaderboard] sync failed:", err);
    process.exit(1);
  });
