#!/usr/bin/env node
// Every page fits one screen: the kit's overflow check, in a real browser.
//
//   node tools/fit.mjs [--shots DIR] [page ...]
//
// Serves the built kit (dist/<version>/) at /.meridian/ui/<version>/, on
// loopback, and opens each of the gallery's pages in headless Chromium
// (Playwright, pinned with its browser in the bench image: Dockerfile.check)
// at the two screens every page is held to (lib/fit.js's SIZES: 1440×900 and
// 390×844), and each of its tabs: a tab linking `#id` to an element with
// that id on the page is opened by its hash. It fails, naming each page,
// size, tab and the element that overflows (or the one-line row that wraps),
// when any does not fit. --shots writes a screenshot of each to DIR.
//
// A test elsewhere (a plugin's preview pages, the dashboard's rendered pages)
// uses the same check through checkFit below, or lib/fit.js's measureFit and
// fitProblems in its own page.evaluate.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SIZES, measureFit, fitProblems } from "../src/lib/fit.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const KIT = join(ROOT, "dist", VERSION);

// The gallery's pages, every one held to the rule: on its own, and the four
// plugin pages framed by the stand-in host too, where the framed page is held
// to its frame (the budget the host gives it) as well, each of its tabs.
export const GALLERY = [
  "gallery.html",
  "gallery/sample.html",
  "gallery/patterns.html",
  "gallery/accounts.html",
  "gallery/accounts-many.html",
  "gallery/host.html",
  "gallery/host.html?page=patterns.html",
  "gallery/host.html?page=accounts.html",
  "gallery/host.html?page=accounts-many.html",
];

// What the check measures but does not fail on, each until a ruling: the
// page, its tab and the screen, and why. Printed with every run.
const ENTRY_AT_PHONE =
  "om-entry-grid's cards at a phone's width (ruled in design/the-kit-fits-a-phone-and-richer-cells): the pattern's three rows of three fields do not fit 390×844; the entry grid's phone layout under the one-screen rule needs the product owner's word";
export const HELD_BACK = {
  "gallery/patterns.html#p-entry@phone": ENTRY_AT_PHONE,
  "gallery/host.html?page=patterns.html, the framed page#p-entry@phone": ENTRY_AT_PHONE,
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  const prefix = `/.meridian/ui/${VERSION}/`;
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.startsWith(prefix) ? join(KIT, normalize(path.slice(prefix.length))) : null;
    if (!file || !file.startsWith(KIT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** Wait until the page, and any frame in it, has drawn and stopped moving:
 * two animation frames after its fonts and the frames' loads, then until its
 * size holds for a few frames (a pager settles on its rows). */
async function settled(page) {
  await page.waitForLoadState("load");
  for (const frame of page.frames()) await frame.waitForLoadState("load").catch(() => {});
  await still(page);
}

async function still(target) {
  await target.evaluate(async () => {
    await document.fonts.ready;
    const frame = () => new Promise((ok) => requestAnimationFrame(() => ok()));
    let last = "";
    let same = 0;
    for (let i = 0; i < 60 && same < 4; i++) {
      await frame();
      const now = `${document.documentElement.scrollHeight}×${document.documentElement.scrollWidth}`;
      same = now === last ? same + 1 : 0;
      last = now;
    }
  });
}

/** The page's tabs that open by hash: `#id` naming an element on the page. */
async function hashTabs(page) {
  return page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll("nav.tabs a.tab[href^='#']")]
        .map((a) => a.getAttribute("href").slice(1))
        .filter((id) => id && document.getElementById(id)),
    ),
  ]);
}

/**
 * Hold the page open in `page` to the rule at each size, and each of its hash
 * tabs. Returns a line per problem ([] when it fits), each naming the size,
 * the tab, and the element. `shots` names a directory for a screenshot of each.
 */
export async function checkFit(page, url, { sizes = SIZES, tabs = true, shots = null, label = url, framed = false } = {}) {
  const problems = [];
  const shot = async (id, size, suffix = "") => {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    const file = `${label.replace(/^gallery\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-html/g, "").replace(/^-|-$/g, "")}${id ? `-${id}` : ""}${suffix}-${size.name}.png`;
    await page.screenshot({ path: join(shots, file) });
  };
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(url);
    await settled(page);
    const ids = tabs ? await hashTabs(page) : [];
    for (const id of ids.length ? ids : [null]) {
      if (id) {
        await page.evaluate((h) => { location.hash = h; }, id);
        await settled(page);
      }
      const where = `${label}${id ? `#${id}` : ""}`;
      for (const p of fitProblems(await page.evaluate(measureFit), size)) problems.push({ where, size, text: `${where}: ${p}` });
      await shot(id, size);
    }
    // The page in the host's frame, held to the frame: its budget.
    const frame = framed ? page.frames().find((f) => f !== page.mainFrame()) : null;
    if (frame) {
      await still(frame);
      const inner = tabs ? await hashTabs(frame) : [];
      for (const id of inner.length ? inner : [null]) {
        if (id) {
          await frame.evaluate((h) => { location.hash = h; }, id);
          await still(frame);
        }
        const where = `${label}, the framed page${id ? `#${id}` : ""}`;
        for (const p of fitProblems(await frame.evaluate(measureFit))) problems.push({ where, size, text: `${where}: ${p} (at ${size.width}×${size.height})` });
        if (id) await shot(`framed-${id}`, size);
      }
    }
  }
  return problems;
}

/** The problems a run fails on, and those held back until a ruling. */
export function sorted(problems, label) {
  const failing = [];
  const held = [];
  for (const p of problems) {
    const key = `${p.where}@${p.size.name}`;
    if (Object.hasOwn(HELD_BACK, key)) held.push(`${p.text}\n    held back: ${HELD_BACK[key]}`);
    else failing.push(p.text);
  }
  return { failing, held };
}

/**
 * One-line rows in a real browser: a click on a row opens its detail over the
 * page, which still fits; Escape closes it; and with script off its "…"
 * opens it all the same. And a pager turns its pages. Returns what failed.
 */
async function rowChecks(browser, base, shots) {
  const failed = [];
  const check = (ok, what) => ok || failed.push(`one-line rows: ${what}`);
  const url = `${base}gallery/patterns.html#p-rows`;
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    page.on("pageerror", (e) => failed.push(`one-line rows: the page threw: ${e.message}`));
    await page.goto(url);
    await settled(page);
    const row = page.locator("#p-rows table.one-line tbody tr").nth(1);
    await row.locator("td").first().click();
    const opened = await page.evaluate(() => {
      const d = document.querySelectorAll("#p-rows details.row-detail")[1];
      const r = d.querySelector(".row-detail-pop").getBoundingClientRect();
      return { open: d.open, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, others: document.querySelectorAll("details.row-detail[open]").length };
    });
    check(opened.open, `at ${size.width}×${size.height} a click on a row does not open its detail`);
    check(opened.inside, `at ${size.width}×${size.height} a row's detail is not within the screen`);
    check(opened.others === 1, `at ${size.width}×${size.height} ${opened.others} details are open, not one`);
    const fits = fitProblems(await page.evaluate(measureFit), size);
    check(!fits.length, `with a detail open the page does not fit: ${fits.join("; ")}`);
    if (shots) await page.screenshot({ path: join(shots, `patterns-p-rows-detail-open-${size.name}.png`) });
    await page.keyboard.press("Escape");
    check(!(await page.evaluate(() => !!document.querySelector("details.row-detail[open]"))), `at ${size.width}×${size.height} Escape does not close the detail`);
    await page.close();
  }
  // Without script: the "…" is a summary, and opens the detail natively.
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const off = await plain.newPage();
  await off.goto(`${base}gallery/patterns.html`);
  await off.locator("details.row-detail > summary").first().click();
  const without = await off.evaluate(() => {
    const d = document.querySelector("details.row-detail");
    const r = d.querySelector(".row-detail-pop").getBoundingClientRect();
    return { open: d.open, shown: r.width > 0 && r.height > 0, fixed: getComputedStyle(d.querySelector(".row-detail-pop")).position };
  });
  check(without.open && without.shown && without.fixed === "fixed", `with script off the "…" does not open the detail over the page: ${JSON.stringify(without)}`);
  await plain.close();
  // A pager of rows all here turns its pages in place.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}gallery/sample.html#book`);
  await settled(page);
  const before = await page.evaluate(() => document.querySelector("#book om-pager").shown);
  await page.locator("#book om-pager nav.pager button", { hasText: "Next" }).click();
  const after = await page.evaluate(() => document.querySelector("#book om-pager").shown);
  check(before.first === 1 && before.last > 1 && before.total === 40, `the orders' pager does not start at its first page: ${JSON.stringify(before)}`);
  check(after.first === before.last + 1, `Next does not turn to the next page: ${JSON.stringify(before)} then ${JSON.stringify(after)}`);
  const said = await page.locator("#book om-pager .pager-said").textContent();
  check(said === `Rows ${after.first}–${after.last} of 40`, `the pager says "${said}"`);
  await page.close();
  return failed;
}

async function main() {
  const argv = process.argv.slice(2);
  let shots = null;
  const pages = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shots") shots = resolve(argv[++i]);
    else pages.push(argv[i]);
  }
  if (!existsSync(KIT)) {
    console.error(`fit FAILED: dist/${VERSION}/ is not built (node tools/build.mjs)`);
    process.exit(1);
  }
  const { chromium } = await import("playwright-core");
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/.meridian/ui/${VERSION}/`;
  const browser = await chromium.launch();
  const failed = [];
  const heldBack = [];
  let checked = 0;
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => failed.push(`${page.url()}: the page threw: ${e.message}`));
    for (const p of pages.length ? pages : GALLERY) {
      const { failing, held } = sorted(await checkFit(page, base + p, { shots, label: p, framed: p.includes("host.html") }), p);
      checked++;
      const all = SIZES.map((s) => `${s.width}×${s.height}`).join(" and ");
      console.log(failing.length ? `${p}: does not fit\n  ${failing.join("\n  ")}` : `${p}: fits at ${all}${held.length ? ", but for what is held back" : ""}`);
      if (held.length) console.log(`  ${held.join("\n  ")}`);
      failed.push(...failing);
      heldBack.push(...held);
    }
    const rows = await rowChecks(browser, base, shots);
    console.log(rows.length ? `one-line rows and the pager: FAILED\n  ${rows.join("\n  ")}` : "one-line rows and the pager: a row's detail opens on a click on its row and over the page, which still fits; Escape closes it; with script off its … opens it; a pager turns its pages");
    failed.push(...rows);
  } finally {
    await browser.close();
    server.close();
  }
  if (failed.length) {
    console.error(`\nfit FAILED: ${failed.length} problem${failed.length === 1 ? "" : "s"} on ${checked} page${checked === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log(`fit OK: ${checked} pages fit one screen at ${SIZES.map((s) => `${s.width}×${s.height}`).join(" and ")}, every tab, no one-line row wrapped${heldBack.length ? `; ${heldBack.length} held back until a ruling` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
