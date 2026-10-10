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
// page, its tab and the screen (`page#tab@phone`), and why. Printed with
// every run. Empty: the entry grid's phone layout, held back here until the
// product owner's word, was ruled on 2026-10-05 and is built (one line a row,
// the rest a tap away, paged).
export const HELD_BACK = {};

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

/**
 * The entry grid on a phone (ruled 2026-10-05), in a real browser: each row
 * one line, its number, the first two columns and "…"; "…" opens the row
 * over the page with every field, which still fits, and Escape puts it back
 * in its place; with forty rows more it pages, Add a row turning to the new
 * one, and the page still fits. Returns what failed.
 */
async function entryChecks(browser, base, shots) {
  const failed = [];
  const check = (ok, what) => ok || failed.push(`entry grid at 390×844: ${what}`);
  const size = SIZES.find((s) => s.name === "phone");
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  page.on("pageerror", (e) => failed.push(`entry grid at 390×844: the page threw: ${e.message}`));
  await page.goto(`${base}gallery/patterns.html#p-entry`);
  await settled(page);
  const line = await page.evaluate(() => {
    const g = document.querySelector("#p-entry om-entry-grid");
    return [...g.querySelectorAll("table.om-entry > tbody > tr[data-row]")].map((tr) => ({
      cells: [...tr.cells].filter((c) => getComputedStyle(c).display !== "none").length,
      height: Math.round(tr.getBoundingClientRect().height),
      more: getComputedStyle(tr.querySelector(".om-entry-more")).display !== "none",
      marked: tr.querySelector(".om-entry-more").classList.contains("om-entry-more-bad"),
    }));
  });
  check(line.length === 2, `${line.length} rows, not the pattern's 2`);
  check(line.every((r) => r.cells === 4), `a row shows other than its number, two fields and "…": ${JSON.stringify(line)}`);
  check(line.every((r) => r.more && r.height <= 64), `a row is not one line: ${JSON.stringify(line)}`);
  check(line[1]?.marked && !line[0]?.marked, `"…" does not mark the row whose hidden field has the server's message: ${JSON.stringify(line)}`);
  await page.locator("#p-entry tbody tr[data-row]").nth(1).locator(".om-entry-more").click();
  const opened = await page.evaluate(() => {
    const d = document.querySelector("#p-entry dialog.om-entry-row-dialog");
    const r = d.getBoundingClientRect();
    const acquired = d.querySelector('input[data-key="acquired"]');
    const err = acquired && acquired.closest("td").querySelector(".om-entry-error");
    return {
      open: d.open,
      inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      title: d.querySelector("h2").textContent,
      fields: [...d.querySelectorAll("td[data-label]")].map((td) => getComputedStyle(td, "::before").content),
      message: err && !err.hidden ? err.textContent : "",
      focused: document.activeElement?.getAttribute("data-key"),
      inForm: acquired?.form === document.querySelector("#p-entry form"),
    };
  });
  check(opened.open && opened.inside, `"…" does not open the row over the page: ${JSON.stringify(opened)}`);
  check(opened.title === "Row 2" && opened.fields.length === 3 && opened.fields.every((c) => c.includes("Quantity") || c.includes("Cost") || c.includes("Acquired")), `the row opened does not show every field under its name: ${JSON.stringify(opened)}`);
  check(opened.message === "Acquired after the opening day, 2026-09-30.", `the hidden field's message is not on it in the row opened: ${JSON.stringify(opened)}`);
  check(opened.focused === "acquired" && opened.inForm, `the keyboard is not on the first field off the line, or it left the form: ${JSON.stringify(opened)}`);
  const fits = fitProblems(await page.evaluate(measureFit), size);
  check(!fits.length, `with a row opened the page does not fit: ${fits.join("; ")}`);
  if (shots) await page.screenshot({ path: join(shots, `patterns-p-entry-row-open-${size.name}.png`) });
  await page.keyboard.press("Escape");
  const back = await page.evaluate(() => {
    const g = document.querySelector("#p-entry om-entry-grid");
    const rows = [...g.querySelectorAll("table.om-entry > tbody > tr[data-row]")];
    return { open: g.querySelector("dialog.om-entry-row-dialog").open, rows: rows.length, second: rows[1]?.querySelector('[data-key="quantity"]').value, focused: document.activeElement?.classList.contains("om-entry-more") };
  });
  check(!back.open && back.rows === 2 && back.second === "4" && back.focused, `Escape does not put the row back in its place, the keyboard on its "…": ${JSON.stringify(back)}`);
  // Many rows: paged, the page still fitting; Add a row turns to the new one.
  await page.evaluate(() => {
    const g = document.querySelector("#p-entry om-entry-grid");
    for (let i = 0; i < 40; i++) g.addRow({ quantity: String(i + 1) });
  });
  await settled(page);
  const paged = await page.evaluate(() => {
    const g = document.querySelector("#p-entry om-entry-grid");
    const nav = g.querySelector("nav.om-entry-pager");
    return { shown: g.querySelectorAll("table.om-entry > tbody > tr[data-row]:not(.om-entry-paged)").length, pager: !nav.hidden, said: nav.querySelector(".pager-said").textContent };
  });
  check(paged.pager && paged.shown > 1 && paged.shown < 42 && paged.said === `Rows 1–${paged.shown} of 42`, `42 rows are not paged: ${JSON.stringify(paged)}`);
  const pagedFits = fitProblems(await page.evaluate(measureFit), size);
  check(!pagedFits.length, `paged, the page does not fit: ${pagedFits.join("; ")}`);
  if (shots) await page.screenshot({ path: join(shots, `patterns-p-entry-paged-${size.name}.png`) });
  await page.locator("#p-entry .om-entry-add").click();
  await settled(page);
  const added = await page.evaluate(() => {
    const g = document.querySelector("#p-entry om-entry-grid");
    return { label: document.activeElement?.getAttribute("aria-label"), said: g.querySelector(".pager-said").textContent };
  });
  check(added.label === "Quantity, row 43" && / of 43$/.test(added.said) && added.said.includes("–43 "), `Add a row does not turn to the new row: ${JSON.stringify(added)}`);
  const addedFits = fitProblems(await page.evaluate(measureFit), size);
  check(!addedFits.length, `a row added, the page does not fit: ${addedFits.join("; ")}`);
  await page.close();
  return failed;
}

/**
 * Search beside the pager and fields gated on a choice (0.11.0), in a real
 * browser at both sizes: the components upgraded with their boxes; a search
 * narrowing the orders' grid in its pager, the accounts' pager over a plain
 * table and the quotes' high-rate grid, each saying how many match; a
 * server's search asked by Enter; a gated field appearing for its choice and
 * leaving for another; each page still fitting. Returns what failed.
 */
async function searchChecks(browser, base, shots) {
  const failed = [];
  for (const size of SIZES) {
    const at = `${size.width}×${size.height}`;
    const check = (ok, what) => ok || failed.push(`search and gated fields at ${at}: ${what}`);
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    page.on("pageerror", (e) => failed.push(`search and gated fields at ${at}: the page threw: ${e.message}`));
    const fits = async (what) => {
      const problems = fitProblems(await page.evaluate(measureFit), size);
      check(!problems.length, `${what}, the page does not fit: ${problems.join("; ")}`);
    };
    const shot = async (name) => {
      if (shots) await page.screenshot({ path: join(shots, `kit-v19-${name}-${size.name}.png`) });
    };

    // The orders: an om-grid's own search, inside an om-pager.
    await page.goto(`${base}gallery/sample.html#book`);
    await settled(page);
    const upgraded = await page.evaluate(() => ({
      defined: ["om-grid", "om-pager", "om-entry-grid"].every((n) => !!customElements.get(n)),
      box: !!document.querySelector("#book om-grid#orders > .om-search input[type=search][aria-label='Search orders']"),
      pager: !!document.querySelector("#book om-pager > nav.om-pager-nav"),
    }));
    check(upgraded.defined && upgraded.box && upgraded.pager, `the components did not upgrade with their boxes: ${JSON.stringify(upgraded)}`);
    await page.locator("#orders .om-search input").fill("nvda");
    await still(page);
    const orders = await page.evaluate(() => {
      const g = document.getElementById("orders");
      const rows = [...g.querySelectorAll("tbody tr[data-key]")].filter((tr) => getComputedStyle(tr).display !== "none");
      return { shown: document.querySelector("#book om-pager").shown, said: g.querySelector(".om-search-said").textContent, symbols: rows.map((tr) => tr.cells[2].textContent) };
    });
    check(orders.shown.total === 5 && orders.symbols.length > 0 && orders.symbols.every((x) => x === "NVDA") && orders.said === "5 of 40 rows",
      `the orders' search does not leave NVDA's five, paged: ${JSON.stringify(orders)}`);
    await fits("the orders searched");
    await shot("orders-search");

    // The accounts: om-pager's own search over a server's plain table.
    await page.goto(`${base}gallery/sample.html#accounts`);
    await settled(page);
    await page.locator("#accounts om-pager > .om-search input").fill("retirement");
    await still(page);
    const accounts = await page.evaluate(() => {
      const p = document.querySelector("#accounts om-pager");
      const rows = [...p.querySelectorAll("tbody tr")].filter((tr) => getComputedStyle(tr).display !== "none");
      return { shown: p.shown, said: p.querySelector(".om-search-said").textContent, names: rows.map((tr) => tr.cells[0].querySelector("strong").textContent) };
    });
    check(accounts.shown.total === 3 && accounts.said === "3 of 30 rows" && accounts.names.every((n) => n.startsWith("Retirement")),
      `the accounts' search does not leave the three Retirement accounts: ${JSON.stringify(accounts)}`);
    await fits("the accounts searched");
    await shot("accounts-search");

    // The quotes: a high-rate grid, streaming, searched.
    await page.goto(`${base}gallery/sample.html#desk-tab`);
    await settled(page);
    await page.locator("#quotes .om-search input").fill("ab");
    await still(page);
    const quotes = await page.evaluate(() => {
      const g = document.getElementById("quotes");
      const symbols = [...g.querySelectorAll("tbody tr[data-key]")].map((tr) => tr.cells[0].textContent.toLowerCase());
      return { symbols, said: g.querySelector(".om-search-said").textContent, count: Number(g.querySelector("table").getAttribute("aria-rowcount")) - 1 };
    });
    check(quotes.symbols.length > 0 && quotes.symbols.every((x) => x.includes("ab")) && quotes.said === `${quotes.count} of 2,000 rows` && quotes.count < 2000,
      `the quotes' search does not draw only what it leaves: ${JSON.stringify({ ...quotes, symbols: quotes.symbols.slice(0, 6) })}`);
    await fits("the quotes searched");
    await shot("quotes-search");

    // A server's search: Enter asks for the first page of what it finds.
    await page.goto(`${base}gallery/patterns.html#p-search`);
    await settled(page);
    const box = page.locator("#p-search om-pager > .om-search input");
    await box.fill("msft");
    await box.press("Enter");
    const asked = await page.locator("#said").textContent();
    check(/[?&]q=msft(&|#|\.|$)/.test(asked) && !asked.includes("offset="), `Enter does not ask the server for the first page of q=msft: "${asked}"`);
    await fits("a server's search asked");
    await shot("server-search");

    // Gated fields: the client ID only for a commercial key.
    await page.goto(`${base}gallery/patterns.html#p-gated`);
    await settled(page);
    const gate = '#p-gated [data-om-applies-when="key_type"]';
    const before = await page.evaluate((g) => ({ hidden: document.querySelector(g).hidden, disabled: document.querySelector(`${g} input`).disabled }), gate);
    check(before.hidden && before.disabled, `a personal key shows the client ID: ${JSON.stringify(before)}`);
    await shot("gated-personal");
    await page.locator('#p-gated label.option:has(input[value="commercial"])').click();
    const after = await page.evaluate((g) => ({ hidden: document.querySelector(g).hidden, disabled: document.querySelector(`${g} input`).disabled, shown: document.querySelector(g).getBoundingClientRect().height > 0 }), gate);
    check(!after.hidden && !after.disabled && after.shown, `a commercial key does not show the client ID: ${JSON.stringify(after)}`);
    await fits("the client ID shown");
    await shot("gated-commercial");

    // The sample's Fields: each kind's own field.
    await page.goto(`${base}gallery/sample.html#form`);
    await settled(page);
    await page.selectOption("#kind", "bank");
    const kinds = await page.evaluate(() => ["brokerage", "bank", "wallet"].map((k) => !document.getElementById(`kind-${k}`).hidden));
    check(kinds.join() === "false,true,false", `choosing Bank does not show the routing number alone: ${kinds}`);
    await fits("a bank's field shown");
    await shot("gated-kind-bank");
    await page.close();
  }
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
    const searched = await searchChecks(browser, base, shots);
    console.log(searched.length ? `search and gated fields: FAILED\n  ${searched.join("\n  ")}` : "search and gated fields: the components upgrade with their boxes; a search narrows the orders' grid in its pager, the accounts' pager and the quotes' high-rate grid, each saying how many match; Enter asks a server; a gated field appears for its choice; every page still fits, at both sizes");
    failed.push(...searched);
    const entry = await entryChecks(browser, base, shots);
    console.log(entry.length ? `the entry grid on a phone: FAILED\n  ${entry.join("\n  ")}` : `the entry grid on a phone: a row one line, its number, two fields and "…"; "…" opens the row over the page with every field and the hidden field's message, the page still fitting; Escape puts it back; 42 rows paged, the page fitting; Add a row turns to the new one`);
    failed.push(...entry);
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
