import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./config";

const REPO_URL = "https://github.com/lidge-jun/opencodex";
/** Marker so the prompt is shown exactly once per install. */
const MARKER = ".star-prompted";

/**
 * On the FIRST interactive `ocx start`, print a one-time GitHub-star request and drop a marker file
 * so it never shows again. No-op for the background service (OCX_SERVICE=1) and non-TTY/piped runs.
 */
export function maybeShowStarPrompt(): void {
  if (process.env.OCX_SERVICE || !process.stdout.isTTY) return;
  const dir = getConfigDir();
  const marker = join(dir, MARKER);
  if (existsSync(marker)) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(marker, new Date().toISOString());
  } catch { /* best-effort: if the marker can't be written, still show it this once */ }

  const RESET = "\x1b[0m", PURPLE = "\x1b[38;5;141m", BOLD = "\x1b[1m", UL = "\x1b[4m", DIM = "\x1b[2m";
  console.log("");
  console.log(`  ${PURPLE}${BOLD}⭐  Enjoying opencodex?${RESET}`);
  console.log("  A GitHub star genuinely helps the project grow — thank you!");
  console.log(`  ${UL}${PURPLE}${REPO_URL}${RESET}`);
  console.log(`  ${DIM}(shown once)${RESET}`);
  console.log("");
}
