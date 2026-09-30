#!/usr/bin/env node
// The high-rate grid's budget and the account map's, held in a real browser.
//
//   node tools/bench.mjs [--json]
//
// Serves the built kit (dist/<version>/) at /.meridian/ui/<version>/ and
// tests/bench/ beside it, on loopback, opens tests/bench/grid.html in
// headless Chromium (Playwright, pinned with its browser in the bench image:
// see Dockerfile.check) and runs each scenario there. The budget: 10,000
// rows taking 1,000 updates a second for 5 seconds, each frame's main-thread
// time at the 95th percentile under 16.7 ms (one frame at 60 Hz), with every
// update applied and the order exact. Then tests/bench/account-map.html: 2,000
// external accounts and 1,500 of the deployment's, declared as JSON, and each
// action a person takes on them, one a frame (typing a search, four keys a
// frame, paging, the filters, grouping and folding, typing in a row's
// chooser), each frame's main-thread time at the 95th percentile under
// 16.7 ms, at most one draw a frame, and at most a page of rows in the
// document. It fails when a budget is not held, and prints what it measured
// either way.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const KIT = join(ROOT, "dist", VERSION);
const BUDGET_MS = 16.7;

// The budget's scenarios are held to it; the others are measured for the record.
const SCENARIOS = [
  { name: "idle: the machine's own frame rhythm", rows: 10000, rate: 0, seconds: 2, held: false },
  { name: "budget: 10,000 rows, 1,000 updates/s, sorted by the streaming column", rows: 10000, rate: 1000, seconds: 5, held: true },
  { name: "budget: the same, while scrolling 24 px a frame", rows: 10000, rate: 1000, seconds: 5, scroll: 24, held: true },
  { name: "budget: the same, the sort frozen", rows: 10000, rate: 1000, seconds: 5, freeze: true, held: true },
  { name: "for the record: 10,000 rows, 1,000 updates/s, standard mode", rows: 10000, rate: 1000, seconds: 3, highRate: false, held: false },
];

// The account map's: each action on 2,000 and 1,500 is held to the budget;
// twenty thousand and fifteen thousand are measured for the record.
const MAP_SCENARIOS = [
  { name: "map budget: typing a search, a key a frame", action: "type", held: true },
  { name: "map budget: typing a search, four keys a frame", action: "type-fast", held: true },
  { name: "map budget: a page a frame, through every page", action: "page", held: true },
  { name: "map budget: Unlinked, Linked and All, one a frame", action: "filter", held: true },
  { name: "map budget: grouping and folding, one a frame", action: "group", held: true },
  { name: "map budget: typing in a row's chooser of open accounts", action: "chooser", held: true },
  { name: "for the record: 20,000 and 15,000, typing a search", externals: 20000, accounts: 15000, action: "type", frames: 120, held: false },
  { name: "for the record: 20,000 and 15,000, a page a frame", externals: 20000, accounts: 15000, action: "page", frames: 120, held: false },
];
// A page of rows (50), the head of a group a page opens inside, and one row's choices.
const MAP_ROWS_MOST = 52;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const prefix = `/.meridian/ui/${VERSION}/`;
    let file = null;
    if (path.startsWith(prefix)) file = join(KIT, normalize(path.slice(prefix.length)));
    else if (path.startsWith("/bench/")) file = join(ROOT, "tests/bench", normalize(path.slice("/bench/".length)));
    const inside = file && (file.startsWith(KIT) || file.startsWith(join(ROOT, "tests/bench")));
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

function mapLine(r) {
  const f = r.frameTimeMs;
  const placed = r.placed
    ? `\n  declared JSON (${Math.round(r.placed.bytes / 1024)} KB) parsed, modelled and drawn in ${r.placed.drawnMs} ms, painted by ${r.placed.paintedMs} ms; ${r.placed.suggestions} suggestions`
    : "";
  return (
    `${r.name}${placed}\n` +
    `  ${r.externals} external and ${r.accounts} deployment accounts, ${r.action}: ${r.frames} frames; at most ${r.rowsInDocumentMax} rows in the document, ${r.drawsPerFrameMax} draw a frame\n` +
    `  frame time (ms)     p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max}  (${r.framesOver16_7Ms} frames over 16.7)`
  );
}

function line(r) {
  const f = r.frameTimeMs;
  const i = r.intervalMs;
  return (
    `${r.name}\n` +
    `  ${r.mode}, ${r.rows} rows, ${r.updatesSent} updates in ${r.seconds} s; ${r.frames} frames at ${r.fps} fps; at most ${r.domRowsMax} rows in the document\n` +
    `  frame time (ms)     p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max}  (${r.framesOver16_7Ms} frames over 16.7)\n` +
    `  frame interval (ms) p50 ${i.p50}  p95 ${i.p95}  p99 ${i.p99}  max ${i.max}  (${r.longIntervals} over 25)\n` +
    `  every row current: ${r.current}; order exact: ${r.freeze ? "held (frozen)" : r.ordered}; setRows took ${r.setRowsMs} ms`
  );
}

async function main() {
  if (!existsSync(KIT)) throw new Error(`dist/${VERSION}/ is not built: run node tools/build.mjs first`);
  const server = await serve();
  const { port } = server.address();
  const browser = await chromium.launch();
  const results = [];
  let failed = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => failed.push(`the page threw: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/bench/grid.html?kit=${VERSION}`);
    await page.waitForFunction(() => window.benchReady === true, null, { timeout: 30000 });
    const ua = await page.evaluate(() => navigator.userAgent);
    console.log(`browser: ${browser.browserType().name()} ${browser.version()} (${ua.includes("Headless") ? "headless" : "headed"}); cpus seen: ${await page.evaluate(() => navigator.hardwareConcurrency)}\n`);
    // The flash, drawn by a real engine, under both conventions, then under reduced motion.
    // A rise is always --buy-wash and a fall --sell-wash; red-up swaps what
    // those are, so its rise is green-up's fall colour.
    let greenUp = null;
    for (const direction of ["green-up", "red-up"]) {
      const f = await page.evaluate((d) => window.checkFlash(d), direction);
      greenUp ??= f;
      const swapped = direction === "green-up" || (f.buyWash === greenUp.sellWash && f.sellWash === greenUp.buyWash);
      const ok = f.up.animation === "om-flash-up-1" && f.down.animation === "om-flash-down-1" && f.up.background === f.buyWash && f.down.background === f.sellWash && f.buyWash !== f.sellWash && swapped;
      console.log(`flash, ${direction}: a rise ${f.up.background}, a fall ${f.down.background} ${ok ? "(as the convention says)" : "(WRONG)"}`);
      if (!ok) failed.push(`flash, ${direction}: ${JSON.stringify(f)}`);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await page.evaluate(() => window.checkFlash("green-up"));
    console.log(`flash, reduced motion: ${still.up.flash === null && still.up.animation === "none" ? "none" : "(WRONG) " + JSON.stringify(still.up)}\n`);
    if (!(still.reduced && still.up.flash === null && still.up.animation === "none")) failed.push(`flash under reduced motion: ${JSON.stringify(still)}`);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => delete document.documentElement.dataset.omDirection);

    for (const s of SCENARIOS) {
      const r = await page.evaluate((opts) => window.runBench(opts), s);
      r.held = s.held;
      results.push(r);
      console.log(line(r) + "\n");
      if (!s.held) continue;
      if (!(r.frameTimeMs.p95 < BUDGET_MS)) failed.push(`${s.name}: frame time p95 ${r.frameTimeMs.p95} ms, over ${BUDGET_MS}`);
      if (r.updatesSent !== s.rate * s.seconds) failed.push(`${s.name}: ${r.updatesSent} updates sent of ${s.rate * s.seconds}`);
      if (!r.current) failed.push(`${s.name}: a row does not hold its last update`);
      if (!s.freeze && !r.ordered) failed.push(`${s.name}: the order is not exact`);
      if (r.size !== s.rows) failed.push(`${s.name}: ${r.size} rows, not ${s.rows}`);
      if (r.domRowsMax > 80) failed.push(`${s.name}: ${r.domRowsMax} rows in the document; virtual scrolling should hold a view's worth`);
    }

    // The account map.
    const mapPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    mapPage.on("pageerror", (e) => failed.push(`the map's page threw: ${e.message}`));
    await mapPage.goto(`http://127.0.0.1:${port}/bench/account-map.html?kit=${VERSION}`);
    await mapPage.waitForFunction(() => window.benchReady === true, null, { timeout: 30000 });
    for (const s of MAP_SCENARIOS) {
      const r = await mapPage.evaluate((opts) => window.runMapBench(opts), s);
      r.held = s.held;
      results.push(r);
      console.log(mapLine(r) + "\n");
      if (r.placed && s.held) {
        const review = await mapPage.evaluate(() => window.openReview());
        console.log(`map: the review of ${review.pairs} suggestions drawn in ${review.drawnMs} ms\n`);
      }
      if (!s.held) continue;
      if (!(r.frameTimeMs.p95 < BUDGET_MS)) failed.push(`${s.name}: frame time p95 ${r.frameTimeMs.p95} ms, over ${BUDGET_MS}`);
      if (r.drawsPerFrameMax > 1) failed.push(`${s.name}: ${r.drawsPerFrameMax} draws in one frame; at most one`);
      if (r.rowsInDocumentMax > MAP_ROWS_MOST) failed.push(`${s.name}: ${r.rowsInDocumentMax} rows in the document; a page holds at most ${MAP_ROWS_MOST}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
  if (failed.length) {
    console.error(`bench FAILED:\n  ${failed.join("\n  ")}`);
    process.exit(1);
  }
  const held = results.filter((r) => r.held && !r.action);
  const mapHeld = results.filter((r) => r.held && r.action);
  console.log(`bench OK: grid frame time p95 ${held.map((r) => r.frameTimeMs.p95).join(", ")} ms; map ${mapHeld.map((r) => r.frameTimeMs.p95).join(", ")} ms; each under ${BUDGET_MS}`);
}

main().catch((e) => {
  console.error(`bench FAILED: ${e.stack || e.message}`);
  process.exit(1);
});
