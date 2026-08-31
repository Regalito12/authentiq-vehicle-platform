import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const prohibited = tracked.filter((file) => {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  return normalized.endsWith(".dump")
    || normalized.endsWith(".sql.gz")
    || normalized.includes("/backups/")
    || normalized.includes("/browser-check/")
    || normalized.includes("/animation-studio-kit/")
    || /(^|\/)\.env(?:\.[^/]+)?$/.test(normalized) && !normalized.endsWith(".env.example") && !normalized.endsWith(".env.production.example");
});

if (prohibited.length) {
  console.error(`REPOSITORY HYGIENE FAIL · no se deben versionar artefactos locales o backups: ${prohibited.join(", ")}`);
  process.exit(1);
}

console.log(`REPOSITORY HYGIENE PASS · ${tracked.length} archivos rastreados sin backups, dumps ni secretos locales`);
