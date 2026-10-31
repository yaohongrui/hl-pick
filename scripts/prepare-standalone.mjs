import fs from "node:fs";

const staticSrc = ".next/static";
const staticDest = ".next/standalone/.next/static";
if (fs.existsSync(staticSrc)) {
  fs.rmSync(staticDest, { recursive: true, force: true });
  fs.cpSync(staticSrc, staticDest, { recursive: true });
}

if (fs.existsSync("public")) {
  fs.rmSync(".next/standalone/public", { recursive: true, force: true });
  fs.cpSync("public", ".next/standalone/public", { recursive: true });
}

console.log("[build] standalone static assets copied");
