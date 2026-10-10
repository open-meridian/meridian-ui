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
// document. Then tests/bench/entry-grid.html, the entry grid in a real
// browser: its page with script turned off posts the page's own table; with
// script, a cell is checked as it is typed and holds the submit, the server's
// messages are on their cells, a spreadsheet's paste fills across and down,
// rows are added and removed, and the form posts each row by its path; at a
// phone's width each row is one line with 44px targets, its other fields in
// the row opened over the page, and nothing scrolls sideways, in light and
// dark; and typing into a grid's first row, a sum and
// a page's rule run on every key, keeps each frame's main-thread time at the
// 95th percentile under 16.7 ms: a number typed into 1,000 rows, and a cell's
// message coming and going in 50 (in 100 and 1,000, for the record). It fails when a budget or a check is
// not held, and prints what it measured either way.
//
// Every budget is 16.7 ms wherever the bench runs, but for three on GitHub's
// hosted runners (MERIDIAN_BENCH_ENV=github-runner, which the Makefile sets
// there): a page a frame and the map's filters, each drawing a page of rows
// none of which was in the document, and typing into 1,000 rows of inputs.
// What those frames cost is the browser's own work (laying out and painting
// fifty new rows; walking the layers of 6,000 inputs), not the kit's script,
// and on the slower of the runners' mixed hardware it is two to three times
// what it is on a developer's machine. Each runner budget is what was
// measured on the runners, with room over the worst run (RUNNER_MEASURED).
// The pre-push gate, on a developer's machine, holds them to 16.7 ms.
//
// A frame time is wall-clock time, so it counts every moment the browser was
// not running: another process on the machine, the VM's CPUs taken by the
// host. On a shared machine (the pre-push gate beside another repository's
// gates, a CI runner) one run's p95 says as much about the machine as about
// the kit: the same commit measured a map frame at 11 ms p95 and 40 ms in two
// runs a minute apart, the machine otherwise idle. So a held scenario whose
// p95 is over budget is run again, up to RUNS_MOST times, and judged by the
// least each frame took in any run. Each run takes the same steps from the
// same state (the map and the entry grid step once a frame from a reset;
// the grid's updates come at a steady rate, so its frames are alike), so a
// frame the kit makes slow is slow in every run and stays in the p95, while
// time taken by something else lands on different frames each run and falls
// out. The budget does not move; a run under it the first time is not run
// again; every run's p95 is printed, with the machine's load average; and the
// checks that are not about time (one draw a frame, rows in the document,
// every update applied, the order) are held in every run. What this cannot
// tell from the machine is a cost of the kit's own that lands on different
// frames each run (a collector's pause, say): a scenario passing only on
// its re-runs, every run's own p95 over budget, is worth a look.

import { createServer } from "node:http";
import { loadavg } from "node:os";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const KIT = join(ROOT, "dist", VERSION);
const BUDGET_MS = 16.7;
// Where the bench runs: GitHub's hosted runners, or anywhere else.
const ENV = process.env.MERIDIAN_BENCH_ENV === "github-runner" ? "github-runner" : "local";
// The frame time p95 (ms) each runner budget was set from: every run of the
// bench on GitHub's runners (ubuntu-latest, 4 CPUs) from 2026-10-01 to
// 2026-10-03, seven for the map and five for the entry grid (from 0.9.0).
const RUNNER_MEASURED = {
  page: [29.1, 33.2, 38.9, 19.5, 34.7, 12.8, 34.8],
  filter: [14.5, 30.5, 33.0, 13.2, 34.9, 9.6, 31.5],
  entry1000: [11.8, 16.3, 14.4, 8.8, 12.6],
};
/** The budget a held scenario is held to here. */
const budgetOf = (s) => (ENV === "github-runner" && s.runner) || BUDGET_MS;

// The most runs a held scenario over its budget is given (see above).
const RUNS_MOST = 5;
// As the bench pages work them out: a percentile, and to a hundredth.
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
const round = (x) => Math.round(x * 100) / 100;

/**
 * A held scenario, run until its frame time p95 is under `budget` or it has
 * had RUNS_MOST runs, judged by the least time each frame took over the
 * runs. Returns the first run's result with that frame time, `runs` (how
 * many), `p95s` (each run's own) and `all` (every run, for the checks that
 * are held in each).
 */
async function hold(run, budget) {
  const all = [];
  for (;;) {
    all.push(await run());
    const frames = Math.min(...all.map((r) => r.work.length));
    const least = Array.from({ length: frames }, (_, i) => Math.min(...all.map((r) => r.work[i])));
    if (pct(least, 95) < budget || all.length >= RUNS_MOST) {
      const { work, ...first } = all[0];
      return {
        ...first,
        frames,
        frameTimeMs: { p50: round(pct(least, 50)), p95: round(pct(least, 95)), p99: round(pct(least, 99)), max: round(Math.max(...least)) },
        framesOver16_7Ms: least.filter((w) => w > 16.7).length,
        runs: all.length,
        p95s: all.map((r) => r.frameTimeMs.p95),
        all: all.map(({ work, ...r }) => r),
      };
    }
  }
}

/** The machine's load average, over 1, 5 and 15 minutes: what else it was doing. */
const busy = () => loadavg().map((x) => x.toFixed(2)).join(" ");

/** How many runs a held frame time was judged over, when more than one. */
const over = (r) => (r.runs > 1 ? `; the least a frame took in ${r.runs} runs, whose own p95s were ${r.p95s.join(", ")}` : "");

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
  { name: "map budget: a page a frame, through every page", action: "page", held: true, runner: 45 },
  { name: "map budget: Unlinked, Linked and All, one a frame", action: "filter", held: true, runner: 45 },
  { name: "map budget: grouping and folding, one a frame", action: "group", held: true },
  { name: "map budget: typing in a row's chooser of open accounts", action: "chooser", held: true },
  { name: "for the record: 20,000 and 15,000, typing a search", externals: 20000, accounts: 15000, action: "type", frames: 120, held: false },
  { name: "for the record: 20,000 and 15,000, a page a frame", externals: 20000, accounts: 15000, action: "page", frames: 120, held: false },
];
// The entry grid's: typing into the first row, held at a size a person types
// and recorded where a message's coming and going moves a thousand rows.
const ENTRY_SCENARIOS = [
  { name: "entry budget: typing a number into the first of 1,000 rows, a sum and a page's rule on every key", rows: 1000, values: "number", held: true, runner: 22 },
  { name: "entry budget: a cell's message coming and going, every other key, in the first of 50 rows", rows: 50, values: "messages", held: true },
  { name: "for the record: the same in the first of 100 rows", rows: 100, values: "messages", held: false },
  { name: "for the record: the same in the first of 1,000 rows; then 500 rows pasted", rows: 1000, values: "messages", paste: 500, held: false },
];
// A page of rows (50), the head of a group a page opens inside, and one row's choices.
const MAP_ROWS_MOST = 52;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const prefix = `/.meridian/ui/${VERSION}/`;
    // A form's post, answered with the fields it carried, in order, as JSON
    // (as plain text, so the browser shows it as it is).
    if (req.method === "POST" && path === "/bench/echo") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify([...new URLSearchParams(body)]));
      });
      return;
    }
    let file = null;
    if (path.startsWith(prefix)) file = join(KIT, normalize(path.slice(prefix.length)));
    // The kit beside the bench pages too, so a page can link it without script.
    else if (path.startsWith("/bench/kit/")) file = join(KIT, normalize(path.slice("/bench/kit/".length)));
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
    `  frame time (ms)     p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max}  (${r.framesOver16_7Ms} frames over 16.7)` +
    (r.held ? `; budget p95 ${r.budget}${over(r)}` : "")
  );
}

function line(r) {
  const f = r.frameTimeMs;
  const i = r.intervalMs;
  return (
    `${r.name}\n` +
    `  ${r.mode}, ${r.rows} rows, ${r.updatesSent} updates in ${r.seconds} s; ${r.frames} frames at ${r.fps} fps; at most ${r.domRowsMax} rows in the document\n` +
    `  frame time (ms)     p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max}  (${r.framesOver16_7Ms} frames over 16.7)${over(r)}\n` +
    `  frame interval (ms) p50 ${i.p50}  p95 ${i.p95}  p99 ${i.p99}  max ${i.max}  (${r.longIntervals} over 25)\n` +
    `  every row current: ${r.current}; order exact: ${r.freeze ? "held (frozen)" : r.ordered}; setRows took ${r.setRowsMs} ms`
  );
}

/** What the echo answered: the fields a form posted, in order. */
async function echoed(page) {
  await page.waitForURL(/\/bench\/echo$/, { timeout: 10000 });
  return JSON.parse(await page.evaluate(() => (document.querySelector("pre") || document.body).textContent));
}

const names = (fields) => fields.map(([k]) => k);

/**
 * The entry grid in a real browser. Each check pushes what failed onto
 * `failed`, and returns what it measured.
 */
async function entryChecks(browser, base, failed) {
  const url = `${base}/bench/entry-grid.html`;
  const check = (ok, what) => {
    if (!ok) failed.push(`entry grid: ${what}`);
    return ok;
  };
  const out = {};

  // Where the kit is not served: script off, the page's own table is the form.
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const off = await plain.newPage();
  await off.goto(url);
  check(await off.locator("#fallback").isVisible(), "with script off, the page's own table is not shown");
  await off.fill('input[name="lots[2].quantity"]', "1");
  await off.fill('input[name="lots[2].terms.cost"]', "25.00");
  await off.fill('input[name="lots[2].acquired"]', "2026-05-06");
  await off.selectOption('select[name="lots[2].method"]', "specific");
  await off.click("#save");
  const without = await echoed(off);
  out.noScript = without;
  check(JSON.stringify(names(without)) === JSON.stringify(["csrf", ...[0, 1, 2].flatMap((i) => ["quantity", "terms.cost", "currency", "acquired", "method"].map((f) => `lots[${i}].${f}`))]), `with script off, the form posted ${JSON.stringify(names(without))}`);
  check(without.some(([k, v]) => k === "lots[2].terms.cost" && v === "25.00"), "with script off, the row typed was not posted");
  await plain.close();

  // With the kit: checked as typed, the submit held, the server's word, paste, rows, and the post.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => failed.push(`entry grid: the page threw: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.entryReady === true, null, { timeout: 30000 });
  check((await page.locator("#fallback").count()) === 0, "the page's own table is still there beside the kit's");
  const declared = await page.evaluate(() => window.cellState(1, "acquired"));
  check(declared.message === "Acquired after the opening day, 2026-09-30." && declared.invalid === "true", `the server's message is not on its cell: ${JSON.stringify(declared)}`);
  check((await page.locator("#lots .om-entry-messages li").first().textContent()) === "Checked against the statement of 2026-09-30.", "the server's message for the table is not over it");
  const cost = page.locator('#lots input[name="lots[0].terms.cost"]');
  await cost.fill("1,500.00");
  const typed = await page.evaluate(() => window.cellState(0, "cost"));
  check(typed.message === "Write it without grouping commas, like 1234.5" && typed.invalid === "true" && typed.describedBy.includes("error"), `a bad cell is not said as it is typed: ${JSON.stringify(typed)}`);
  await page.click("#save");
  await page.waitForTimeout(300);
  const held = page.url() === url;
  const focused = await page.evaluate(() => document.activeElement.getAttribute("name"));
  check(held, "a submit with a bad cell was not held");
  check(focused === "lots[0].terms.cost", `a held submit took the keyboard to ${focused}`);
  await cost.fill("1500.00");
  await page.locator('#lots input[name="lots[1].acquired"]').fill("2026-09-30");
  const pasted = await page.evaluate(() => window.pasteInto(1, "quantity", "4\t600.00\tusd\n7\t700.123\teur\n8\t800\tgbp\n"));
  check(pasted.prevented && pasted.rows === 4, `a paste did not fill down, adding rows: ${JSON.stringify(pasted)}`);
  const badPaste = await page.evaluate(() => [window.cellState(2, "cost"), window.cellState(2, "currency"), window.cellState(3, "acquired")]);
  check(badPaste[0].message === "At most 2 decimal places" && badPaste[1].value === "EUR", `a pasted cell is not checked: ${JSON.stringify(badPaste)}`);
  check(badPaste[2].message === "", "a pasted row's empty optional cell is said to be wrong");
  await page.locator('#lots input[name="lots[2].terms.cost"]').fill("700.12");
  // Enter on the last row adds one; Add a row adds another; a row is removed.
  await page.locator('#lots input[name="lots[3].quantity"]').focus();
  await page.keyboard.press("Enter");
  const afterEnter = await page.evaluate(() => [document.querySelectorAll("#lots tbody tr[data-row]").length, document.activeElement.getAttribute("aria-label")]);
  check(afterEnter[0] === 5 && afterEnter[1] === "Quantity, row 5", `Enter on the last row did not add one: ${JSON.stringify(afterEnter)}`);
  await page.click("#lots .om-entry-add");
  await page.click('#lots button[aria-label="Remove row 3"]');
  const shown = await page.evaluate(() => document.querySelectorAll("#lots tbody tr[data-row]").length);
  check(shown === 5, `after Add a row and a Remove, ${shown} rows are shown, not 5`);
  await page.click("#save");
  const sent = await echoed(page);
  out.withScript = sent;
  const lots = [0, 1, 2].flatMap((i) => ["quantity", "terms.cost", "currency", "acquired", "method"].map((f) => `lots[${i}].${f}`));
  check(JSON.stringify(names(sent)) === JSON.stringify(["csrf", ...lots]), `the kit's form posted ${JSON.stringify(names(sent))}: the rows typed, by path, the blank ones not`);
  const value = (k) => sent.find(([n]) => n === k)?.[1];
  check(value("lots[1].quantity") === "4" && value("lots[1].currency") === "USD" && value("lots[2].quantity") === "8" && value("lots[2].currency") === "GBP", `the rows posted are not the rows shown: ${JSON.stringify(sent)}`);
  await page.close();

  // A phone, in light and dark.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", (e) => failed.push(`entry grid at 390px: the page threw: ${e.message}`));
  await phone.goto(url);
  await phone.waitForFunction(() => window.entryReady === true, null, { timeout: 30000 });
  for (const scheme of ["light", "dark"]) {
    await phone.emulateMedia({ colorScheme: scheme });
    const l = await phone.evaluate(() => window.layout());
    out[`phone-${scheme}`] = l;
    check(l.table === "table" && l.row === "table-row" && l.head !== "none", `at 390px, ${scheme}: the grid is not a table of rows: ${JSON.stringify(l)}`);
    check(l.onTheLine === 4 && l.rowHeight <= 64, `at 390px, ${scheme}: a row is not one line of its number, two fields and "…": ${JSON.stringify(l)}`);
    check(l.smallestTarget >= 44, `at 390px, ${scheme}: a target is ${l.smallestTarget}px tall, under 44`);
    check(l.scrollWidth <= l.width, `at 390px, ${scheme}: the page scrolls sideways (${l.scrollWidth}px of ${l.width})`);
    check(l.errorInk === l.danger, `at 390px, ${scheme}: a cell's message is ${l.errorInk}, not the scheme's danger ${l.danger}`);
  }
  check(out["phone-light"].danger !== out["phone-dark"].danger, "the danger colour is the same in light and dark: the scheme is not followed");
  const opened = await phone.evaluate(() => window.openRow(1));
  out.phoneRow = opened;
  check(opened.open && opened.left >= 0 && opened.top >= 0 && opened.right <= opened.width && opened.bottom <= opened.height, `at 390px the row opened is not within the screen: ${JSON.stringify(opened)}`);
  check(opened.shown === 5 && opened.labels.every((c) => !["none", "normal", ""].includes(c)), `at 390px the row opened does not show its five fields, each named by its column: ${JSON.stringify(opened)}`);
  check(opened.smallestTarget >= 44, `at 390px a target in the row opened is ${opened.smallestTarget}px tall, under 44`);
  check(opened.back, "at 390px Done does not put the row back in its place");
  const dialog = await phone.evaluate(() => window.openCsv());
  out.phoneDialog = dialog;
  check(dialog.open && dialog.left >= 0 && dialog.right <= dialog.width && dialog.scrollWidth <= dialog.width, `at 390px the CSV dialog does not fit: ${JSON.stringify(dialog)}`);
  await phone.close();

  // The budget: typing into a grid's first row (every rule run on each key),
  // a number into 1,000 rows, and a cell's message coming and going in 50,
  // held; the message in 100 and 1,000, and a paste of 500 rows, for the
  // record. A
  // message coming or going changes its row's height, and the browser lays
  // out every row under it again: in a table or any other layout, that costs
  // in proportion to the rows below (tests/bench/entry-grid.html).
  const bench = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  bench.on("pageerror", (e) => failed.push(`entry grid bench: the page threw: ${e.message}`));
  await bench.goto(url);
  await bench.waitForFunction(() => window.entryReady === true, null, { timeout: 30000 });
  out.budget = [];
  for (const s of ENTRY_SCENARIOS) {
    const run = () => bench.evaluate((o) => window.runEntryBench(o), s);
    const r = s.held ? await hold(run, budgetOf(s)) : await run();
    delete r.work;
    r.name = s.name;
    r.held = s.held;
    r.budget = budgetOf(s);
    out.budget.push(r);
    if (s.held) check(r.frameTimeMs.p95 < r.budget, `${s.name}: frame time p95 ${r.frameTimeMs.p95} ms, over ${r.budget}${over(r)}`);
    if (s.paste) check(r.rowsAfterPaste === s.rows + s.paste - 1, `a paste of ${s.paste} rows into the last of ${s.rows} left ${r.rowsAfterPaste} rows`);
  }
  await bench.close();
  return out;
}

function entryLines(e) {
  const lines = [
    `entry grid: script off, the page's own table posted ${e.noScript.length} fields; with the kit, ${e.withScript.length} (the rows typed, by path, the blank ones not)`,
    `entry grid: at 390px each row one line (${e["phone-light"].rowHeight}px, its number, two fields and "…"), its other fields in the row opened (${e.phoneRow.shown} fields, within the screen), the smallest target ${e["phone-light"].smallestTarget}px, ${e["phone-light"].scrollWidth}px wide of ${e["phone-light"].width}; danger ${e["phone-light"].danger} light, ${e["phone-dark"].danger} dark`,
  ];
  for (const r of e.budget) {
    const f = r.frameTimeMs;
    lines.push(
      `\n${r.name}\n` +
        `  ${r.rows} rows, ${r.frames} frames; declared JSON drawn in ${r.drawnMs} ms, painted by ${r.paintedMs} ms\n` +
        `  frame time (ms)     p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max}  (${r.framesOver16_7Ms} frames over 16.7)${r.held ? `; budget p95 ${r.budget}${over(r)}` : ""}\n` +
        `  of which the grid's script (ms) p50 ${r.scriptMs.p50}  p95 ${r.scriptMs.p95}` +
        (r.paste ? `\n  ${r.paste} rows of 6 cells pasted at once into the last row in ${r.pasteMs} ms, painted by ${r.pastePaintedMs} ms` : ""),
    );
  }
  return lines.join("\n");
}

async function main() {
  if (!existsSync(KIT)) throw new Error(`dist/${VERSION}/ is not built: run node tools/build.mjs first`);
  const server = await serve();
  const { port } = server.address();
  const browser = await chromium.launch();
  const results = [];
  let failed = [];
  let entry = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => failed.push(`the page threw: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/bench/grid.html?kit=${VERSION}`);
    await page.waitForFunction(() => window.benchReady === true, null, { timeout: 30000 });
    const ua = await page.evaluate(() => navigator.userAgent);
    console.log(`browser: ${browser.browserType().name()} ${browser.version()} (${ua.includes("Headless") ? "headless" : "headed"}); cpus seen: ${await page.evaluate(() => navigator.hardwareConcurrency)}; load average ${busy()}`);
    const own = [...MAP_SCENARIOS, ...ENTRY_SCENARIOS].filter((s) => s.held && budgetOf(s) !== BUDGET_MS);
    console.log(
      ENV === "github-runner"
        ? `budgets: GitHub's runner: ${BUDGET_MS} ms a frame at p95, but ${own.map((s) => `${budgetOf(s)} ms for ${s.name.replace(/^[a-z ]+budget: /, "")}`).join("; ")} (measured there: ${Object.entries(RUNNER_MEASURED).map(([k, v]) => `${k} ${Math.min(...v)} to ${Math.max(...v)}`).join(", ")})\n`
        : `budgets: ${BUDGET_MS} ms a frame at p95, every one\n`,
    );
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
      const run = () => page.evaluate((opts) => window.runBench(opts), s);
      const r = s.held ? await hold(run, BUDGET_MS) : await run();
      delete r.work;
      r.held = s.held;
      results.push(r);
      console.log(line(r) + "\n");
      if (!s.held) continue;
      if (!(r.frameTimeMs.p95 < BUDGET_MS)) failed.push(`${s.name}: frame time p95 ${r.frameTimeMs.p95} ms, over ${BUDGET_MS}${over(r)}`);
      for (const each of r.all) {
        if (each.updatesSent !== s.rate * s.seconds) failed.push(`${s.name}: ${each.updatesSent} updates sent of ${s.rate * s.seconds}`);
        if (!each.current) failed.push(`${s.name}: a row does not hold its last update`);
        if (!s.freeze && !each.ordered) failed.push(`${s.name}: the order is not exact`);
        if (each.size !== s.rows) failed.push(`${s.name}: ${each.size} rows, not ${s.rows}`);
        if (each.domRowsMax > 80) failed.push(`${s.name}: ${each.domRowsMax} rows in the document; virtual scrolling should hold a view's worth`);
      }
    }

    // The account map.
    const mapPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    mapPage.on("pageerror", (e) => failed.push(`the map's page threw: ${e.message}`));
    await mapPage.goto(`http://127.0.0.1:${port}/bench/account-map.html?kit=${VERSION}`);
    await mapPage.waitForFunction(() => window.benchReady === true, null, { timeout: 30000 });
    for (const s of MAP_SCENARIOS) {
      const run = () => mapPage.evaluate((opts) => window.runMapBench(opts), s);
      const r = s.held ? await hold(run, budgetOf(s)) : await run();
      delete r.work;
      r.held = s.held;
      r.budget = budgetOf(s);
      results.push(r);
      console.log(mapLine(r) + "\n");
      if (r.placed && s.held) {
        const review = await mapPage.evaluate(() => window.openReview());
        console.log(`map: the review of ${review.pairs} suggestions drawn in ${review.drawnMs} ms\n`);
      }
      if (!s.held) continue;
      if (!(r.frameTimeMs.p95 < r.budget)) failed.push(`${s.name}: frame time p95 ${r.frameTimeMs.p95} ms, over ${r.budget}${over(r)}`);
      const draws = Math.max(...r.all.map((each) => each.drawsPerFrameMax));
      const rows = Math.max(...r.all.map((each) => each.rowsInDocumentMax));
      if (draws > 1) failed.push(`${s.name}: ${draws} draws in one frame; at most one`);
      if (rows > MAP_ROWS_MOST) failed.push(`${s.name}: ${rows} rows in the document; a page holds at most ${MAP_ROWS_MOST}`);
    }

    // The entry grid.
    entry = await entryChecks(browser, `http://127.0.0.1:${port}`, failed);
    results.push({ name: "entry grid", ...entry });
    console.log(entryLines(entry) + "\n");
  } finally {
    await browser.close();
    server.close();
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
  if (failed.length) {
    console.error(`bench FAILED:\n  ${failed.join("\n  ")}\nthe machine's load average at the end: ${busy()} (a frame time counts whatever else it was doing)`);
    process.exit(1);
  }
  const held = results.filter((r) => r.held && !r.action);
  const mapHeld = results.filter((r) => r.held && r.action);
  const p95 = (r) => `${r.frameTimeMs.p95}${r.budget && r.budget !== BUDGET_MS ? ` (of ${r.budget})` : ""}${r.runs > 1 ? ` (${r.runs} runs)` : ""}`;
  console.log(
    `bench OK: grid frame time p95 ${held.map(p95).join(", ")} ms; map ${mapHeld.map(p95).join(", ")} ms; entry grid ${entry.budget.filter((r) => r.held).map(p95).join(", ")} ms; ` +
      (ENV === "github-runner" ? `each under ${BUDGET_MS} but where its runner budget is given` : `each under ${BUDGET_MS}`),
  );
}

main().catch((e) => {
  console.error(`bench FAILED: ${e.stack || e.message}`);
  process.exit(1);
});
