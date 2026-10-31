import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const args = process.argv.slice(2);
const prune = args.includes("--prune");
const fileArg = args.find((arg) => !arg.startsWith("--"));

const file =
  fileArg || process.env.SEED_FILE || path.join("data", "seed-addresses.txt");

if (!fs.existsSync(file)) {
  console.log(
    `[seed] ${file} not found — skipping. Drop a txt with one address per line and re-run.`,
  );
  process.exit(0);
}

const raw = fs.readFileSync(file, "utf8");
const lines = raw.split(/\r?\n/);

const db = getDb();
const now = Date.now();

const upsert = db.prepare(`
  INSERT INTO addresses(address, source, display_name, tags, excluded, first_seen, last_seen)
  VALUES(?, 'seed', ?, NULL, 0, ?, ?)
  ON CONFLICT(address) DO UPDATE SET
    source = CASE
      WHEN addresses.source IN ('manual', 'watch') THEN addresses.source
      ELSE 'seed'
    END,
    display_name = COALESCE(excluded.display_name, addresses.display_name),
    last_seen = excluded.last_seen
`);

let valid = 0;
let duplicate = 0;
let commented = 0;
const invalid: { line: number; text: string; reason: string }[] = [];
const seen = new Set<string>();

const insertAll = db.transaction(() => {
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const lineNo = idx + 1;
    if (!trimmed) return;
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
      commented++;
      return;
    }
    const [addrPart, ...rest] = trimmed.split(",");
    const addr = addrPart.trim().toLowerCase();
    const label = rest.join(",").trim() || null;
    if (!ADDRESS_RE.test(addr)) {
      invalid.push({ line: lineNo, text: trimmed.slice(0, 80), reason: "格式不是 0x + 40 位十六进制" });
      return;
    }
    if (seen.has(addr)) {
      duplicate++;
      return;
    }
    seen.add(addr);
    upsert.run(addr, label, now, now);
    valid++;
  });
});

insertAll();

let pruned = 0;
if (prune) {
  const keep = [...seen];
  const notIn = keep.length ? `AND address NOT IN (${keep.map(() => "?").join(",")})` : "";
  pruned = db
    .prepare(
      `DELETE FROM addresses
        WHERE source = 'seed'
          ${notIn}
          AND address NOT IN (SELECT address FROM watchlist)`,
    )
    .run(...keep).changes;
}

console.log(`[seed] file: ${file}`);
console.log(`[seed] imported ${valid}, duplicates ${duplicate}, comments ${commented}, invalid ${invalid.length}`);
if (prune) console.log(`[seed] pruned ${pruned} seed addresses no longer in file`);
if (invalid.length) {
  console.log("[seed] invalid lines (first 20):");
  for (const row of invalid.slice(0, 20)) {
    console.log(`  line ${row.line}: ${row.reason} :: ${row.text}`);
  }
}

const total = db
  .prepare("SELECT COUNT(*) AS c FROM addresses WHERE source = 'seed'")
  .get() as { c: number };
console.log(`[seed] addresses table now has ${total.c} seed addresses`);
