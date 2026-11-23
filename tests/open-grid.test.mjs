// 0.17.0: things to open in a grid (.open-grid), paged by om-pager in whole
// grid rows; om-pager's `label`; om-status's `badge`; and the CSS each needs.

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { put, read, settle } from "./helpers.mjs";

const TILE = 100;
const GAP = 10;
const REST = 100;
const NAV = 40;

/** Lay out a grid of tiles as a browser would: `columns` a row, each tile
 * 100px tall with 10px between rows, the pager 40px when shown, 100px of the
 * rest of the page; the budget is the window's height. */
function layout(height, columns) {
  window.happyDOM.setViewport({ width: 1280, height });
  const shown = (el) => !el.hidden && !el.closest("[hidden]");
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    let h = 0;
    if (this.matches(".open-grid > li")) h = shown(this) ? TILE : 0;
    else if (this.matches("nav.pager")) h = shown(this) ? NAV : 0;
    else if (this.localName === "main") {
      const tiles = [...this.querySelectorAll(".open-grid > li")].filter(shown).length;
      const lines = Math.ceil(tiles / columns);
      const nav = [...this.querySelectorAll("om-pager > nav.pager")].filter(shown).length;
      h = REST + lines * TILE + Math.max(0, lines - 1) * GAP + nav * NAV;
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, width: 1000, height: h, bottom: h };
  };
  const computed = globalThis.getComputedStyle;
  const style = function (el, ...rest) {
    const st = computed.call(this, el, ...rest);
    if (!el.classList?.contains("open-grid")) return st;
    return new Proxy(st, {
      get(target, key) {
        if (key === "display") return "grid";
        if (key === "gridTemplateColumns") return Array.from({ length: columns }, () => "[line] 165px").join(" ") + " [end]";
        if (key === "rowGap") return `${GAP}px`;
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  };
  globalThis.getComputedStyle = style;
  window.getComputedStyle = style;
  return () => {
    proto.getBoundingClientRect = original;
    globalThis.getComputedStyle = computed;
    window.getComputedStyle = computed;
  };
}

const tiles = (n) =>
  `<ul class="open-grid">${Array.from({ length: n }, (_, i) => `<li><a class="open-item" href="#${i + 1}"><span class="monogram">P</span><strong>plugin-${i + 1}</strong><span class="button">Open</span></a></li>`).join("")}</ul>`;

const visible = (pager) => [...pager.querySelectorAll(".open-grid > li")].filter((li) => !li.hidden).length;

test("om-pager pages a grid's items by whole grid rows, its columns read from the grid", async () => {
  // 600 high: 600 - 100 - 40 = 460 for tiles; rows of 100 with 10 between: 4 rows. Two columns: 8 a page.
  const undo = layout(600, 2);
  try {
    put(`<main><om-pager id="p" label="">${tiles(21)}</om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    assert.deepEqual(pager.shown, { first: 1, last: 8, total: 21, size: 8 });
    assert.equal(visible(pager), 8);
    assert.equal(pager.querySelector(".pager-said").textContent, "1–8 of 21", "label=\"\": the range alone");
    pager.turn(1);
    assert.deepEqual(pager.shown, { first: 9, last: 16, total: 21, size: 8 });
  } finally {
    undo();
  }
});

test("om-pager over a grid: three columns, whole rows; all fitting, no pager", async () => {
  let undo = layout(600, 3);
  try {
    put(`<main><om-pager id="p">${tiles(21)}</om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    assert.equal(pager.shown.size, 12, "4 rows of 3");
    assert.equal(pager.shown.size % 3, 0, "never a part row");
    assert.equal(pager.querySelector(".pager-said").textContent, "Rows 1–12 of 21", "no label: Rows, as before");
    undo();
    undo = layout(1200, 7);
    pager.refit();
    assert.equal(visible(pager), 21);
    assert.equal(pager.querySelector("nav.om-pager-nav").hidden, true, "one page: no pager");
  } finally {
    undo();
  }
});

test("om-pager's label names what it pages", async () => {
  const undo = layout(600, 2);
  try {
    put(`<main><om-pager id="p" label="Plugins">${tiles(21)}</om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    assert.equal(pager.querySelector(".pager-said").textContent, "Plugins 1–8 of 21");
  } finally {
    undo();
  }
});

async function badge(attrs, inside = "") {
  put(`<table class="one-line"><tbody><tr><td><om-status badge ${attrs}>${inside}</om-status></td></tr></tbody></table>`);
  await settle();
  return document.querySelector("om-status");
}

test("om-status badge: the label is a worded badge toned by its state, the note its description", async () => {
  for (const [state, tone] of [["ok", "badge good"], ["warn", "badge warn"], ["error", "badge bad"], ["busy", "badge"], ["", "badge"]]) {
    const el = await badge(`state="${state}" label="Working" detail="Last data 20 s ago."`, "Working");
    const button = el.querySelector("button");
    assert.equal(button.className, `om-status-badge ${tone}`, `${state || "no state"}: ${tone}`);
    assert.equal(button.textContent, "Working", "its words are the label, shown");
    assert.equal(button.querySelector(".visually-hidden"), null, "shown, not visually hidden");
    const ids = (button.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
    assert.deepEqual(ids.map((id) => document.getElementById(id).textContent), ["Last data 20 s ago."]);
  }
});

test("om-status badge: dropped, the dot is back; a tap holds the note open", async () => {
  const el = await badge('state="error" label="Not healthy" detail="Tradier refused the token (401)."');
  const button = el.querySelector("button");
  button.click();
  assert.equal(el.hasAttribute("open"), true);
  el.removeAttribute("badge");
  assert.equal(el.querySelector("button").className, "om-status-dot");
  assert.equal(el.querySelector("button .visually-hidden").textContent, "Not healthy");
});

test("the CSS: open grid, monogram, segmented, empty icon, attention bar, a status let out of a one-line cell, the badge's note over the page", () => {
  const css = read("src/css/components.css");
  for (const rule of [
    ".open-grid {",
    ".open-item {",
    ".open-item:focus-visible",
    ".open-grid.list {",
    ".monogram {",
    ".monogram.small {",
    ".segmented {",
    '.segmented button[aria-pressed="true"]',
    ".empty-state .empty-icon {",
    "tr.attention > :first-child { box-shadow: inset 3px 0 0 var(--warn-ink); }",
    "table.one-line td:has(om-status) { overflow: visible; }",
    "om-status[badge] .om-status-note { position: fixed;",
  ]) {
    assert.ok(css.includes(rule), rule);
  }
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.open-item, \.open-item:hover \{ transition: none; transform: none; \}/);
});
