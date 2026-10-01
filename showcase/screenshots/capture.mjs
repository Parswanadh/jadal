// C8 screenshot runner — Playwright, placeholder-first.
//
// Captures every showcase screen: /farmer, /coordinator, /canal, /phone,
// /demo (plus / cover). Independent of C1-C7 markup: navigates each route,
// waits for network idle + a fixed settle delay, takes a viewport/fullPage
// shot. No secrets; BASE_URL is a placeholder until preview deploys land.
//
// Usage (PowerShell):
//   $env:BASE_URL = "http://localhost:5173"   # or https://demo.jadal.example.com
//   node ./showcase/screenshots/capture.mjs [--base-url <url>] [--out <dir>] [--tolerant]
//
// Exit code: 0 when all shots succeed; 1 listing failures (unless --tolerant).
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(path.join(here, "screenshots.config.json"), "utf8"),
);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const BASE_URL =
  arg("--base-url", process.env.BASE_URL || config.baseUrl).replace(/\/$/, "");
const OUT_DIR = path.resolve(here, arg("--out", process.env.OUT_DIR || config.outDir));
const TOLERANT = process.argv.includes("--tolerant");

const { chromium } = await import("@playwright/test").catch(() => {
  console.error(
    "[screenshots] @playwright/test is not installed.\n" +
      "  cd showcase && npm install && npx playwright install chromium",
  );
  process.exit(2);
});

mkdirSync(OUT_DIR, { recursive: true });

const viewports = config.viewports;
const browser = await chromium.launch();
const failures = [];

for (const route of config.routes) {
  const vp = viewports[route.viewport] ?? viewports.desktop;
  const url = `${BASE_URL}${route.path}`;
  const file = path.join(OUT_DIR, `${route.name}.png`);
  const page = await browser.newPage({
    viewport: vp,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  try {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (!res || res.status() >= 400) {
      throw new Error(`HTTP ${res ? res.status() : "no-response"} for ${url}`);
    }
    await page.waitForTimeout(config.waitMsAfterLoad ?? 1500);
    await page.screenshot({ path: file, fullPage: route.fullPage ?? false });
    console.log(`[screenshots] ok  ${route.path} [${route.viewport}] -> ${file}`);
  } catch (err) {
    failures.push({ route: route.name, url, error: String(err && err.message ? err.message : err) });
    console.error(`[screenshots] FAIL ${url}: ${failures[failures.length - 1].error}`);
  } finally {
    await page.close();
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`[screenshots] ${failures.length}/${config.routes.length} failed. BASE_URL=${BASE_URL}`);
  for (const f of failures) console.error(`  - ${f.route} (${f.url}): ${f.error}`);
  if (!TOLERANT) process.exit(1);
} else {
  console.log(`[screenshots] all ${config.routes.length} shots saved to ${OUT_DIR}`);
}
