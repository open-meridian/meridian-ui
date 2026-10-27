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
  "gallery/sidebar.html",
  "gallery/sidebar-manage.html",
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
 * Kit 0.13.0, the sidebar (rulings 447 to 451), in a real browser at 1280,
 * 582 and 375 px wide, light and dark: nothing sideways and the page fitting;
 * one item aria-current, by hash, by query and by the `current` attribute
 * (a Manage page keeping its own tab row, one sidebar); on a desktop the tab
 * order (collapse, then the items in order), the focus ring seen, collapsing
 * by the keyboard to icons and the choice remembered across a reload; below
 * 768 px the bar (Menu and the current item), Enter opening the drawer with
 * focus on the current item and Tab never reaching the page under it, Escape closing it and focus back
 * on Menu. Returns what failed.
 */
export const SIDEBAR_WIDTHS = [1280, 582, 375];

async function sidebarChecks(browser, base, shots) {
  const failed = [];
  for (const width of SIDEBAR_WIDTHS) {
    for (const mode of ["light", "dark"]) {
      const at = `${width}px ${mode}`;
      const check = (ok, what) => ok || failed.push(`sidebar at ${at}: ${what}`);
      const size = { name: `${width}`, width, height: 800 };
      const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: mode });
      const page = await context.newPage();
      page.on("pageerror", (e) => failed.push(`sidebar at ${at}: the page threw: ${e.message}`));
      const shot = async (name) => {
        if (shots) await page.screenshot({ path: join(shots, `sidebar-${name}-${width}-${mode}.png`) });
      };
      const state = () => page.evaluate(() => {
        const s = document.querySelector("om-sidebar");
        const root = document.documentElement;
        const current = [...s.querySelectorAll("a[aria-current='page']")].map((a) => a.textContent);
        return {
          sideways: root.scrollWidth > root.clientWidth,
          current,
          here: s.querySelector(".om-sidebar-here").textContent,
          narrow: s.hasAttribute("data-narrow"),
          navShown: getComputedStyle(s.querySelector(":scope > .om-sidebar-nav") || s).display !== "none",
          barShown: getComputedStyle(s.querySelector(".om-sidebar-bar")).display !== "none",
          width: Math.round((s.querySelector(":scope > .om-sidebar-nav") || s).getBoundingClientRect().width),
          collapsed: s.collapsed,
          sidebars: document.querySelectorAll("om-sidebar").length,
        };
      });
      const focused = () => page.evaluate(() => {
        const el = document.activeElement;
        const st = getComputedStyle(el);
        return {
          text: (el.textContent || "").trim(),
          cls: el.className || el.localName,
          inDrawer: !!el.closest("dialog.om-sidebar-drawer"),
          // Past the drawer's last control focus leaves the document (the
          // browser's own chrome), never reaching the page under it.
          outside: el !== document.body && !el.closest("dialog.om-sidebar-drawer"),
          ring: el.matches(":focus-visible") && st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0,
        };
      });
      const fits = async (what) => {
        const problems = fitProblems(await page.evaluate(measureFit), size);
        check(!problems.length, `${what}, the page does not fit: ${problems.join("; ")}`);
      };

      await page.goto(`${base}gallery/sidebar.html#holds`);
      await settled(page);
      let s = await state();
      check(!s.sideways, "the page scrolls sideways");
      check(s.current.length === 1 && s.current[0] === "Holds", `#holds marks ${JSON.stringify(s.current)} current`);
      await fits("on #holds");
      await shot("admin");

      if (width >= 768) {
        check(!s.narrow && s.navShown && !s.barShown, `on a desktop it is not the sidebar: ${JSON.stringify(s)}`);
        // The tab order: the collapse button, then the items in order.
        const order = [];
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press("Tab");
          order.push(await focused());
        }
        check(order[0].cls.includes("om-sidebar-collapse"), `the first Tab is ${order[0].cls}, not the collapse button`);
        check(order.slice(1).map((f) => f.text).join("|") === "Plugins|Versions · Browse · Registries|Model routing", `Tab goes ${order.map((f) => f.text || f.cls).join(" → ")}`);
        check(order.every((f) => f.ring), "a focused control shows no focus ring");
        // A click on an item: a plain link, the mark following the hash.
        await page.locator("om-sidebar a.om-sidebar-link", { hasText: "Permissions" }).click();
        await settled(page);
        s = await state();
        check(page.url().endsWith("sidebar.html#permissions"), `the link went to ${page.url()}`);
        check(s.current.join() === "Permissions", `after a click ${JSON.stringify(s.current)} is current`);
        check((await page.locator("#where").textContent()) === "Permissions", "the page's heading did not follow");
        // Collapse by the keyboard; remembered across a reload.
        await page.locator(".om-sidebar-collapse").focus();
        await page.keyboard.press("Enter");
        s = await state();
        check(s.collapsed && s.width <= 60, `Enter on the collapse button leaves it ${s.width}px wide, collapsed ${s.collapsed}`);
        await fits("collapsed");
        await shot("collapsed");
        await page.reload();
        await settled(page);
        s = await state();
        check(s.collapsed && s.current.join() === "Permissions", `after a reload: collapsed ${s.collapsed}, current ${JSON.stringify(s.current)}`);
        const tip = await page.locator("om-sidebar a.om-sidebar-link", { hasText: "Holds" }).getAttribute("title");
        check(tip === "Holds", `collapsed, an icon's tooltip is ${JSON.stringify(tip)}`);
        await page.locator(".om-sidebar-collapse").click();
        check(!(await state()).collapsed, "the collapse button does not expand it again");
      } else {
        check(s.narrow && !s.navShown && s.barShown && s.here === "Holds", `below 768px it is not the bar naming Holds: ${JSON.stringify(s)}`);
        await page.keyboard.press("Tab");
        let f = await focused();
        check(f.cls.includes("om-sidebar-open") && f.ring, `the first Tab is ${f.cls} (ring ${f.ring}), not Menu`);
        await page.keyboard.press("Enter");
        await settled(page);
        f = await focused();
        check(f.inDrawer && f.text === "Holds", `Enter on Menu leaves focus on ${f.text || f.cls} (in the drawer: ${f.inDrawer})`);
        check((await page.locator(".om-sidebar-open").getAttribute("aria-expanded")) === "true", "Menu does not say the drawer is open");
        // No collapse button in the drawer: not drawn, not in the accessibility tree.
        const collapse = await page.evaluate(() => {
          const b = document.querySelector("dialog.om-sidebar-drawer button.om-sidebar-collapse");
          return b ? { drawn: b.getClientRects().length > 0 && getComputedStyle(b).display !== "none", hidden: b.hidden } : null;
        });
        check(!collapse || (!collapse.drawn && collapse.hidden), `the drawer shows the collapse button: ${JSON.stringify(collapse)}`);
        const named = await page.getByRole("button", { name: /Collapse the menu|Expand the menu/ }).count();
        check(named === 0, `the drawer's accessibility tree has ${named} collapse button(s)`);
        let kept = true;
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press("Tab");
          if ((await focused()).outside) kept = false;
        }
        check(kept, "Tab reaches the page under the open drawer");
        const box = await page.evaluate(() => {
          const r = document.querySelector("dialog.om-sidebar-drawer").getBoundingClientRect();
          return { left: r.left, right: r.right, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
        check(box.left === 0 && box.right <= width && !box.sideways, `the drawer is not within the screen from the left: ${JSON.stringify(box)}`);
        await shot("drawer");
        await page.keyboard.press("Escape");
        await settled(page);
        f = await focused();
        s = await state();
        check(f.cls.includes("om-sidebar-open"), `after Escape focus is on ${f.text || f.cls}, not Menu`);
        check(!(await page.evaluate(() => document.querySelector("om-sidebar").drawerOpen)) && !s.navShown, "Escape does not close the drawer");
        check((await page.locator(".om-sidebar-open").getAttribute("aria-expanded")) === "false", "Menu still says the drawer is open");
        // An item followed from the drawer: the drawer shuts, the mark follows.
        await page.keyboard.press("Enter");
        await page.locator("dialog.om-sidebar-drawer a", { hasText: "Time zone" }).click();
        await settled(page);
        s = await state();
        check(!(await page.evaluate(() => document.querySelector("om-sidebar").drawerOpen)), "following an item leaves the drawer open");
        check(s.current.join() === "Time zone" && s.here === "Time zone", `after following Time zone: ${JSON.stringify(s)}`);
      }

      // One address of three by its query: Versions · Browse · Registries.
      await page.goto(`${base}gallery/sidebar.html?tab=registries`);
      await settled(page);
      s = await state();
      check(s.current.join() === "Versions · Browse · Registries", `?tab=registries marks ${JSON.stringify(s.current)} current`);

      // A plugin's Manage page: its own tab row in the shell, Plugins current, one sidebar.
      await page.goto(`${base}gallery/sidebar-manage.html#settings`);
      await settled(page);
      s = await state();
      const tabs = await page.evaluate(() => {
        const nav = document.querySelector(".om-shell-main nav.tabs");
        return { shown: !!nav && getComputedStyle(nav).display !== "none", on: nav?.querySelector("[aria-current='page']")?.textContent };
      });
      check(s.current.join() === "Plugins" && s.sidebars === 1, `the Manage page marks ${JSON.stringify(s.current)} with ${s.sidebars} sidebars`);
      check(tabs.shown && tabs.on === "Settings", `the Manage page's own tabs: ${JSON.stringify(tabs)}`);
      check(!s.sideways, "the Manage page scrolls sideways");
      await fits("the Manage page");
      await shot("manage");
      await context.close();
    }
  }
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

/**
 * Kit 0.12.0, in a real browser at both sizes: an entry grid's instrument
 * column searching the page's own server for a few and posting the ID chosen,
 * on a page on its own (as core's own pages are) and in the stand-in host's
 * frame (as a plugin's page is), the matches within the screen and the page
 * still fitting; facts on one line, a row's whole a click away; and a next
 * step's link opening the host's own tab from the framed page, while on its
 * own it is words. Returns what failed.
 */
async function v20Checks(browser, base, shots) {
  const failed = [];
  for (const size of SIZES) {
    const at = `${size.width}×${size.height}`;
    const check = (ok, what) => ok || failed.push(`kit 0.12.0 at ${at}: ${what}`);
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    page.on("pageerror", (e) => failed.push(`kit 0.12.0 at ${at}: the page threw: ${e.message}`));
    const fits = async (what, target = page) => {
      const problems = target === page ? fitProblems(await page.evaluate(measureFit), size) : fitProblems(await target.evaluate(measureFit));
      check(!problems.length, `${what}, the page does not fit: ${problems.join("; ")}`);
    };
    const shot = async (name) => {
      if (shots) await page.screenshot({ path: join(shots, `kit-v20-${name}-${size.name}.png`) });
    };
    // What the page asks its server, from here on.
    const listen = (target) => target.evaluate(() => {
      const real = window.fetch;
      window.__asked = [];
      window.fetch = (input, init) => {
        window.__asked.push(String(typeof input === "string" ? input : input.url));
        return real(input, init);
      };
    });
    const matches = (target) => target.evaluate(() => {
      // The grid's, over the page (the sample's picker has one of its own, hidden).
      const list = [...document.querySelectorAll("body > ul.om-picker-list")].find((l) => !l.hidden);
      if (!list) return null;
      const r = list.getBoundingClientRect();
      return {
        options: [...list.querySelectorAll("[role=option]")].map((li) => li.textContent),
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
        asked: window.__asked,
      };
    });
    const chosen = (target, n) => target.evaluate((i) => {
      const tr = document.querySelectorAll("#watchlist tbody tr[data-row]")[i];
      const post = tr.querySelector('td input[type="hidden"]');
      return { shown: tr.querySelector('[data-key="instrument"]').value, value: post.value, name: post.getAttribute("name") };
    }, n);

    // On its own, as core's own pages are.
    await page.goto(`${base}gallery/sample.html#watchlist`);
    await settled(page);
    const up = await page.evaluate(() => {
      const g = document.querySelector("#watchlist om-entry-grid");
      const box = g.querySelector('[data-key="instrument"]');
      return { defined: !!customElements.get("om-entry-grid"), upgraded: !!g.querySelector("table.om-entry"), role: box?.getAttribute("role"), first: box?.value, rows: g.querySelectorAll("tbody tr[data-row]").length };
    });
    check(up.defined && up.upgraded && up.role === "combobox" && up.rows === 2, `the watchlist's grid did not upgrade with its instrument column: ${JSON.stringify(up)}`);
    check(up.first === "Microsoft Corporation common stock (MSFT · XNAS)", `an ID given is not shown by its name: ${JSON.stringify(up)}`);
    await listen(page);
    await page.locator("#watchlist .om-entry-add").click();
    await page.keyboard.type("appl");
    await page.waitForSelector("ul.om-picker-list:not([hidden]) [role=option]", { timeout: 5000 }).catch(() => {});
    const found = await matches(page);
    check(found && found.options.length === 1 && /Apple Inc\. common stock/.test(found.options[0]) && /INS-3f1c9a02/.test(found.options[0]) && /ticker:AAPL/.test(found.options[0]),
      `typing does not show the few that match, with name, identifiers and ID: ${JSON.stringify(found)}`);
    check(found && found.inside, `the matches are not within the screen: ${JSON.stringify(found)}`);
    const asked = (found?.asked || []).map((u) => new URL(u));
    check(asked.length >= 1 && asked.every((u) => u.searchParams.get("limit") === "8" && u.pathname.endsWith("/gallery/search")) && asked.at(-1).searchParams.get("q") === "appl",
      `the search did not ask the page's own server for a few: ${JSON.stringify(found?.asked)}`);
    await fits("the matches open");
    await shot("instrument-search");
    await page.keyboard.press("Enter");
    const one = await chosen(page, 2);
    check(one.value === "INS-3f1c9a02" && one.name === "watchlist[2].instrument" && one.shown === "Apple Inc. common stock (AAPL · XNAS)", `choosing does not set the cell to the ID: ${JSON.stringify(one)}`);
    await page.locator("#watchlist button.primary", { hasText: "Save" }).click();
    const sent = await page.locator("#watched").textContent();
    check(sent.includes("watchlist[0].instrument=INS-8d20b7e4") && sent.includes("watchlist[2].instrument=INS-3f1c9a02") && !sent.includes("Apple Inc"), `the form would not post the IDs: "${sent}"`);
    await fits("an instrument chosen");
    await shot("instrument-chosen");

    // In the stand-in host's frame, as a plugin's page is.
    await page.goto(`${base}gallery/host.html`);
    await settled(page);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    await frame.evaluate(() => { location.hash = "watchlist"; });
    await still(frame);
    await listen(frame);
    await frame.locator("#watchlist .om-entry-add").click();
    await page.keyboard.type("micro");
    await frame.waitForSelector("ul.om-picker-list:not([hidden]) [role=option]", { timeout: 5000 }).catch(() => {});
    const framed = await matches(frame);
    check(framed && framed.options.length === 1 && /Microsoft/.test(framed.options[0]) && framed.inside, `framed, typing does not show the matches within the frame: ${JSON.stringify(framed)}`);
    await fits("framed, the matches open", frame);
    await shot("framed-instrument-search");
    await page.keyboard.press("Enter");
    const two = await chosen(frame, 2);
    check(two.value === "INS-8d20b7e4" && two.name === "watchlist[2].instrument", `framed, choosing does not set the cell to the ID: ${JSON.stringify(two)}`);
    await shot("framed-instrument-chosen");

    // Facts: one line a row, the label a row header, the whole a click away.
    await page.goto(`${base}gallery/patterns.html#p-facts`);
    await settled(page);
    const facts = await page.evaluate(() => [...document.querySelectorAll("#p-facts table.one-line tbody tr")].map((tr) => ({
      height: Math.round(tr.getBoundingClientRect().height), label: tr.querySelector("th[scope=row]").textContent, transform: getComputedStyle(tr.querySelector("th")).textTransform,
      labelWidth: Math.round(tr.querySelector("th").getBoundingClientRect().width), rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    })));
    const wide = size.width > 640 ? 12 : 7.5;
    check(facts.length === 3 && facts.every((f) => f.height <= 48 && f.transform === "none" && Math.abs(f.labelWidth - wide * f.rem) <= 1),
      `facts are not one line a row with plain labels ${wide}rem wide: ${JSON.stringify(facts)}`);
    await page.locator("#p-facts tbody tr").nth(2).locator("td").first().click();
    const detail = await page.evaluate(() => document.querySelectorAll("#p-facts details.row-detail")[2].open);
    check(detail, "a click on a fact's row does not open its whole");
    await fits("a fact's whole open");
    await shot("facts");
    await page.keyboard.press("Escape");

    // Prepare: the act's own form posts with the reserved field; its submit without.
    for (const where of ["alone", "framed"]) {
      let target = page;
      if (where === "alone") {
        await page.goto(`${base}gallery/patterns.html#p-prepare`);
        await settled(page);
      } else {
        await page.goto(`${base}gallery/host.html?page=patterns.html`);
        await settled(page);
        target = page.frames().find((f) => f !== page.mainFrame());
        await target.evaluate(() => { location.hash = "p-prepare"; });
        await still(target);
      }
      await target.locator("#p-prepare form").first().locator("button", { hasText: "Prepare" }).click();
      const prepared = await target.locator("#said").textContent();
      await target.locator("#p-prepare form").first().locator("button.primary").click();
      const made = await target.locator("#said").textContent();
      check(/[?&\s]?prepare=1/.test(prepared) && prepared.includes("account_id=ACC-7b20c1e5") && prepared.includes("csrf="), `${where}, Prepare does not post the form with prepare=1: "${prepared}"`);
      check(!made.includes("prepare=") && made.includes("account_id=ACC-7b20c1e5"), `${where}, the act's submit posts prepare: "${made}"`);
      await fits(`${where}, Prepare`, target);
      await shot(`prepare-${where}`);
    }

    // om-account-map, page-size="auto" and grouped, three unlinked accounts on
    // three connections (SnapTrade's Account links): every page holds rows
    // under their heads, never a head alone, and the page still fits.
    await page.goto(`${base}gallery/accounts.html`);
    await settled(page);
    await page.evaluate(() => {
      const data = {
        external_accounts: [1, 2, 3].map((i) => ({ external_account_id: `st-${i}`, name: `Account ${i}`, detail: "Interactive Brokers · Cash", custodian: "Interactive Brokers", account_type: "Cash", connection: `Interactive Brokers · Connection ${i}`, connection_id: `c-${i}` })),
        accounts: [{ account_id: "ACC-1", name: "Main", open: true }],
        links: [],
      };
      const main = document.querySelector("main");
      main.innerHTML = `<header class="page-head"><div><h1>Account links</h1></div></header><section class="panel"><om-account-map action="link" token-name="csrf" token="t" page-size="auto" group-by="connection"><script type="application/json">${JSON.stringify(data)}</script></om-account-map></section>`;
    });
    await still(page);
    const mapPages = [];
    for (let i = 0; i < 8; i++) {
      const now = await page.evaluate(() => {
        const m = document.querySelector("om-account-map");
        const pager = m.querySelector(".om-account-map-pager");
        return {
          body: [...m.querySelectorAll("tbody tr")].map((tr) => (tr.classList.contains("om-account-map-group") ? "H" : tr.dataset.external)),
          where: pager.hidden ? "one page" : pager.querySelector(".om-account-map-page").textContent,
          last: pager.hidden || pager.querySelectorAll("button")[1].disabled,
        };
      });
      mapPages.push(now);
      if (now.last) break;
      await page.locator("om-account-map .om-account-map-pager").first().locator("button").nth(1).click();
      await still(page);
    }
    const rowsShown = mapPages.flatMap((p) => p.body.filter((e) => e !== "H"));
    check(mapPages.every((p) => p.body.some((e) => e !== "H") && p.body.at(-1) !== "H") && rowsShown.join() === "st-1,st-2,st-3" && mapPages.length <= 3,
      `the grouped map's pages are not rows under their heads: ${JSON.stringify(mapPages)}`);
    if (size.width > 640) check(mapPages.length === 1 && mapPages[0].where === "one page", `at a desktop's height the three accounts are not one page: ${JSON.stringify(mapPages)}`);
    await fits("the grouped map, its last page");
    await shot("account-map-grouped");

    // om-account-map with prepare, on its own and framed: "Prepare link", posting prepare=1.
    for (const where of ["alone", "framed"]) {
      await page.goto(where === "alone" ? `${base}gallery/accounts.html` : `${base}gallery/host.html?page=accounts.html`);
      await settled(page);
      const target = where === "alone" ? page : page.frames().find((f) => f !== page.mainFrame());
      // Prepare, and an account named as the first unlinked one, so it is
      // suggested; the gallery's own notice over the map goes, so the row its
      // suggestion makes taller still leaves the framed phone page room.
      await target.evaluate(() => {
        for (const n of document.querySelectorAll("main > .notice")) n.hidden = true;
        const m = document.getElementById("map");
        m.setAttribute("prepare", "");
        const data = m.data;
        const free = data.external_accounts.find((x) => !data.links.some((l) => l.external_account_id === x.external_account_id));
        data.accounts.push({ account_id: "ACC-SUGGESTED", name: free.name, custodian: free.custodian, account_type: free.account_type, open: true });
        m.data = data;
      });
      await still(target);
      await fits(`${where}, the map with prepare`, target);
      await shot(`account-map-prepare-${where}`);
      const sent = await target.evaluate(() => {
        const m = document.getElementById("map");
        let posted = null;
        m.addEventListener("om-link", (e) => { e.preventDefault(); posted = { ...e.detail, form: undefined, fields: Object.fromEntries(new FormData(e.detail.form)) }; }, { once: true });
        const take = m.querySelector("tr.om-account-map-row button[type=submit]");
        const words = take ? take.textContent : null;
        take?.form.requestSubmit(take);
        return { words, posted, labels: [...m.querySelectorAll("button[type=submit]")].map((b) => b.textContent).filter((t) => /^(Link|Unlink|Create and link)$/.test(t)) };
      });
      check(sent.words === "Prepare link" && sent.posted?.prepare === true && sent.posted?.fields?.prepare === "1" && sent.posted?.fields?.account_id === "ACC-SUGGESTED" && sent.labels.length === 0,
        `${where}, the map with prepare does not offer Prepare link posting prepare=1: ${JSON.stringify(sent)}`);
    }

    // A next step on its own: words, and nothing asked.
    await page.goto(`${base}gallery/patterns.html#p-next`);
    await settled(page);
    const before = page.url();
    await page.locator('#p-next a[data-om-opens="settings"]').click();
    const alone = await page.evaluate(() => {
      const a = document.querySelector('#p-next a[data-om-opens="settings"]');
      return { same: getComputedStyle(a).color === getComputedStyle(a.parentElement).color, tabindex: a.getAttribute("tabindex") };
    });
    check(page.url() === before && alone.same && alone.tabindex === null, `on its own, a next step is not its words: ${JSON.stringify(alone)} ${page.url()}`);
    await shot("next-step-alone");

    // Framed: the link opens the host's own Settings tab.
    await page.goto(`${base}gallery/host.html?page=patterns.html`);
    await settled(page);
    const pf = page.frames().find((f) => f !== page.mainFrame());
    await pf.evaluate(() => { location.hash = "p-next"; });
    await still(pf);
    const link = await pf.evaluate(() => {
      const a = document.querySelector('#p-next a[data-om-opens="settings"]');
      return { tabindex: a.getAttribute("tabindex"), role: a.getAttribute("role"), cursor: getComputedStyle(a).cursor };
    });
    check(link.tabindex === "0" && link.role === "link" && link.cursor === "pointer", `framed, a next step is not a link: ${JSON.stringify(link)}`);
    await fits("framed, a next step", pf);
    await shot("next-step-framed");
    await pf.locator('#p-next a[data-om-opens="settings"]').click();
    await page.waitForFunction(() => !document.getElementById("core").hidden, null, { timeout: 5000 }).catch(() => {});
    const host = await page.evaluate(() => ({
      core: !document.getElementById("core").hidden,
      frame: document.getElementById("plugin").hidden,
      title: document.getElementById("core-title").textContent,
      on: document.querySelector("#host-tabs .tab[aria-current=page]")?.textContent,
    }));
    check(host.core && host.frame && host.title === "Settings" && host.on === "Settings", `the next step does not open the host's Settings tab: ${JSON.stringify(host)}`);
    await fits("the host's tab opened");
    await shot("next-step-opened");
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
    const v20 = await v20Checks(browser, base, shots);
    console.log(v20.length ? `kit 0.12.0: FAILED\n  ${v20.join("\n  ")}` : "kit 0.12.0: an instrument column searches the page's own server for a few and posts the ID chosen, on its own and framed, the matches within the screen; facts one line a row, the whole a click away; a next step opens the host's tab from the frame and is words on its own; Prepare posts the act's form with prepare=1, on its own and framed; a grouped account map pages rows under their heads; the map with prepare offers Prepare link posting prepare=1, on its own and framed; every page still fits, at both sizes");
    failed.push(...v20);
    const entry = await entryChecks(browser, base, shots);
    console.log(entry.length ? `the entry grid on a phone: FAILED\n  ${entry.join("\n  ")}` : `the entry grid on a phone: a row one line, its number, two fields and "…"; "…" opens the row over the page with every field and the hidden field's message, the page still fitting; Escape puts it back; 42 rows paged, the page fitting; Add a row turns to the new one`);
    failed.push(...entry);
    const sidebar = await sidebarChecks(browser, base, shots);
    console.log(sidebar.length ? `kit 0.13.0, the sidebar: FAILED\n  ${sidebar.join("\n  ")}` : `kit 0.13.0, the sidebar: at ${SIDEBAR_WIDTHS.join(", ")} px, light and dark, nothing sideways and the page fitting; one item aria-current by hash, by query and on a Manage page by its attribute, which keeps its own tabs under one sidebar; on a desktop Tab goes collapse then the items in order, each with its focus ring, Enter collapses it to icons with tooltips, remembered across a reload; below 768 px the bar names the current item, Menu opens the drawer, with no collapse button, with focus on it and Tab never reaching the page under it, Escape closes it with focus back on Menu, and an item followed shuts it`);
    failed.push(...sidebar);
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
