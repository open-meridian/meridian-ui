// Every page fits one screen (meridian-design
// tasks/design/every-page-fits-one-screen.md): the height budget, compact
// chrome and one-row tabs, one-line rows and their detail, om-pager (as many
// rows a page as fit, in place or from the server), and the overflow check's
// words. What only a real browser's layout can say, tools/fit.mjs holds
// (make fit); here happy-dom, with each box's height given.

import "./dom.mjs";
import "../src/components/index.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { put, read, settle } from "./helpers.mjs";
import { SIZES, fitProblems } from "../src/lib/fit.js";
import { rowsThatFit } from "../src/lib/budget.js";

const BASE = read("src/css/base.css");
const COMPONENTS = read("src/css/components.css");
const SETTINGS = { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true };

/** The kit's CSS over `body` in a window `width` wide. */
function styled(body, width = 1440) {
  const win = new Window({ url: "https://plugin.example/app/", width, height: 900, settings: SETTINGS });
  const doc = win.document;
  const style = doc.createElement("style");
  style.textContent = BASE + COMPONENTS;
  doc.head.appendChild(style);
  doc.body.innerHTML = body;
  return { win, doc, style: (sel) => win.getComputedStyle(doc.querySelector(sel)) };
}

// ── The budget, the chrome, the rows ─────────────────────────────────────────

test("the page's height budget is its own viewport, a property a page may set", () => {
  assert.match(BASE, /:root \{ --om-page-height: 100vh; \}/);
  assert.match(BASE, /@supports \(height: 100dvh\) \{ :root \{ --om-page-height: 100dvh; \} \}/);
  assert.match(read("tools/lint.mjs"), /"om-page-height":/, "lint knows it as the kit's own");
});

test("the head is one row: its heading and line cut, its actions never wrapping", () => {
  const { style } = styled(`<main class="page"><header class="page-head" id="head"><div><h1 id="h">Positions</h1><p id="line">Every account this plugin reads.</p></div>
    <div class="actions" id="actions"><button>Export</button></div></header></main>`);
  assert.equal(style("#head").flexWrap, "nowrap");
  assert.equal(style("#actions").flexWrap, "nowrap");
  for (const sel of ["#h", "#line"]) {
    assert.equal(style(sel).whiteSpace, "nowrap", sel);
    assert.equal(style(sel).textOverflow, "ellipsis", sel);
  }
  // A line holding a status is not cut: its note would be.
  const held = styled(`<header class="page-head"><div><h1>A</h1><p id="line"><om-status state="ok">Up to date</om-status></p></div></header>`);
  assert.notEqual(held.style("#line").overflow, "hidden");
});

test("tabs are one row at every width: they scroll sideways within it, never wrap", () => {
  for (const width of [1440, 390]) {
    const { style } = styled(`<nav class="tabs" id="tabs"><a class="tab" id="tab" href="#a">Accounts</a><a class="tab" href="#b">Statements</a></nav>`, width);
    assert.equal(style("#tabs").flexWrap, "nowrap", `${width}`);
    assert.equal(style("#tabs").overflowX, "auto", `${width}`);
    assert.equal(style("#tab").flexShrink, "0", `${width}: a tab keeps its words`);
  }
});

test("a one-line table: fixed layout, every cell one line cut with an ellipsis; the .more cell holds the detail", () => {
  const { style } = styled(`<table class="one-line" id="t"><tbody><tr><td id="c">A long cause <span class="hint" id="hint">and its hint</span></td>
    <td class="more" id="more"><details class="row-detail"><summary>…</summary><div class="row-detail-pop" id="pop">All of it</div></details></td></tr></tbody></table>`);
  assert.equal(style("#t").tableLayout, "fixed");
  assert.equal(style("#c").whiteSpace, "nowrap");
  assert.equal(style("#c").overflow, "hidden");
  assert.equal(style("#c").textOverflow, "ellipsis");
  assert.equal(style("#hint").display, "inline", "a cell's hint follows its value on the line");
  assert.equal(style("#more").overflow, "visible");
  assert.equal(style("#pop").position, "fixed", "open, the detail stands over the page and never lengthens it");
  assert.equal(style("#pop").whiteSpace, "normal");
});

test("at a phone's width what is wide-only goes; at a desktop's it stays", () => {
  const html = `<table class="one-line"><thead><tr><th>Account</th><th class="wide-only" id="th">Note</th></tr></thead>
    <tbody><tr><td>Main</td><td class="wide-only" id="td">Rebalanced at the close</td></tr></tbody></table>`;
  const phone = styled(html, 390);
  assert.equal(phone.style("#th").display, "none");
  assert.equal(phone.style("#td").display, "none");
  const desk = styled(html, 1440);
  assert.notEqual(desk.style("#td").display, "none");
});

test("a one-line list row keeps its text on one line and its actions beside it", () => {
  const { style } = styled(`<div class="list-row one-line" id="row"><div class="grow" id="grow"><span class="title">Schwab</span><span class="meta" id="meta">Needs sign-in</span></div><button id="b">Reconnect</button></div>`, 390);
  assert.equal(style("#row").flexWrap, "nowrap");
  assert.equal(style("#grow").whiteSpace, "nowrap");
  assert.equal(style("#grow").textOverflow, "ellipsis");
  assert.equal(style("#meta").display, "inline");
  assert.equal(style("#b").flexShrink, "0");
});

// ── Row details, with the kit's script ──────────────────────────────────────

const TABLE = `<table class="one-line"><tbody>
  <tr id="r1"><td id="c1">Main</td><td><a href="#x" id="link">Open</a></td><td class="more"><details class="row-detail" id="d1"><summary id="s1">…</summary><div class="row-detail-pop" id="p1">Main, all of it</div></details></td></tr>
  <tr id="r2"><td id="c2">Retirement</td><td></td><td class="more"><details class="row-detail" id="d2"><summary>…</summary><div class="row-detail-pop">Retirement</div></details></td></tr>
</tbody></table><p id="outside">Elsewhere</p>`;
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

afterEach(() => document.body.replaceChildren());

test("a click anywhere on a row opens its detail; one open closes another", () => {
  put(TABLE);
  click(document.getElementById("c1"));
  assert.equal(document.getElementById("d1").open, true);
  click(document.getElementById("c2"));
  // The first click outside an open detail only closes it, as a dialog's backdrop does.
  assert.equal(document.getElementById("d1").open, false);
  assert.equal(document.getElementById("d2").open, false);
  click(document.getElementById("c2"));
  assert.equal(document.getElementById("d2").open, true);
});

test("a link on the row is the link's, and a click inside the detail leaves it open", () => {
  put(TABLE);
  click(document.getElementById("link"));
  assert.equal(document.getElementById("d1").open, false, "a link in the row does not open the detail");
  click(document.getElementById("c1"));
  click(document.getElementById("p1"));
  assert.equal(document.getElementById("d1").open, true);
});

test("Escape closes an open detail and gives the keyboard back to its summary; a click outside closes it", () => {
  put(TABLE);
  click(document.getElementById("c1"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.getElementById("d1").open, false);
  assert.equal(document.activeElement, document.getElementById("s1"));
  click(document.getElementById("c1"));
  click(document.getElementById("outside"));
  assert.equal(document.getElementById("d1").open, false);
});

test("a cut cell gets its whole text as its title, once, when the pointer comes over it", () => {
  put(TABLE);
  const cell = document.getElementById("c2");
  Object.defineProperty(cell, "scrollWidth", { value: 300 });
  Object.defineProperty(cell, "clientWidth", { value: 120 });
  cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  assert.equal(cell.getAttribute("title"), "Retirement");
  const whole = document.getElementById("c1");
  whole.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  assert.equal(whole.hasAttribute("title"), false, "a cell that is not cut is left alone");
});

// ── om-pager ─────────────────────────────────────────────────────────────────

const ROW = 40;
const REST = 100;

/** Give the page's boxes heights, as a browser would lay them out: each
 * shown row 40px, the pager 40px when shown, and 100px of the rest of the
 * page around them; the budget is the window's height. */
function layout(height) {
  window.happyDOM.setViewport({ width: 1440, height });
  const shown = (el) => !el.hidden && !el.closest("[hidden]");
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    let h = 0;
    if (this.localName === "tr") h = shown(this) ? ROW : 0;
    else if (this.matches("nav.pager")) h = shown(this) ? ROW : 0;
    else if (this.localName === "main") {
      const rows = [...this.querySelectorAll("tbody tr, .list-row")].filter(shown).length;
      const nav = [...this.querySelectorAll("om-pager > nav.pager")].filter(shown).length;
      h = REST + rows * ROW + nav * ROW;
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, width: 1000, height: h, bottom: h };
  };
  return () => (proto.getBoundingClientRect = original);
}

function rows(n, from = 1) {
  return Array.from({ length: n }, (_, i) => `<tr><td>Row ${from + i}</td></tr>`).join("");
}

const visible = (pager) => [...pager.querySelectorAll("tbody tr")].filter((r) => !r.hidden).map((r) => r.textContent);

test("om-pager shows as many rows as fit the budget, says which, and turns its pages in place", async () => {
  const undo = layout(400);
  try {
    put(`<main><om-pager id="p"><table class="one-line"><tbody>${rows(20)}</tbody></table></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    // 400 less the rest (100) and the pager (40), over 40 a row: 6.
    assert.deepEqual(pager.shown, { first: 1, last: 6, total: 20, size: 6 });
    assert.deepEqual(visible(pager), ["Row 1", "Row 2", "Row 3", "Row 4", "Row 5", "Row 6"]);
    const nav = pager.querySelector("nav.pager");
    assert.equal(nav.hidden, false);
    assert.equal(nav.querySelector(".pager-said").textContent, "Rows 1–6 of 20");
    const [prev, next] = nav.querySelectorAll("button");
    assert.equal(prev.disabled, true, "nothing before the first page");
    next.click();
    assert.deepEqual(visible(pager), ["Row 7", "Row 8", "Row 9", "Row 10", "Row 11", "Row 12"]);
    pager.turn(1);
    pager.turn(1);
    assert.deepEqual(visible(pager), ["Row 19", "Row 20"]);
    assert.equal(nav.querySelector(".pager-said").textContent, "Rows 19–20 of 20");
    assert.equal(nav.querySelectorAll("button")[1].disabled, true, "nothing after the last page");
  } finally {
    undo();
  }
});

test("om-pager on a taller screen shows more rows, keeping the first shown in view; all of them fitting, no pager", async () => {
  let undo = layout(400);
  try {
    put(`<main><om-pager id="p"><table><tbody>${rows(20)}</tbody></table></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    pager.turn(1);
    assert.equal(pager.shown.first, 7);
    undo();
    undo = layout(700);
    pager.refit();
    // 700 - 140 = 560: 14 rows, and the page holding row 7 starts at row 1.
    assert.deepEqual(pager.shown, { first: 1, last: 14, total: 20, size: 14 });
    undo();
    undo = layout(2000);
    pager.refit();
    assert.equal(visible(pager).length, 20);
    assert.equal(pager.querySelector("nav.om-pager-nav").hidden, true, "one page: no pager");
  } finally {
    undo();
  }
});

test("om-pager over a server's page: as many as fit, and links asking for the next that fit", async () => {
  const undo = layout(400);
  try {
    window.happyDOM.setURL("https://plugin.example/app/breaks?sort=age&offset=25&size=25");
    put(`<main><om-pager id="p" total="240" offset="25" size="25"><table><tbody>${rows(25, 26)}</tbody></table>
      <nav class="pager" id="own"><a href="?offset=0&amp;size=25" rel="prev">Previous</a><span>26–50 of 240</span><a href="?offset=50&amp;size=25" rel="next">Next</a></nav></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    assert.equal(document.getElementById("own").hidden, true, "the server's own pager is what a browser without the kit shows");
    assert.deepEqual(pager.shown, { first: 26, last: 31, total: 240, size: 6 });
    assert.deepEqual(visible(pager), ["Row 26", "Row 27", "Row 28", "Row 29", "Row 30", "Row 31"]);
    const nav = pager.querySelector("nav.om-pager-nav");
    const [prev, next] = nav.querySelectorAll("a");
    assert.equal(next.getAttribute("href"), "/app/breaks?sort=age&offset=31&size=6", "the next page starts after the last row shown, as long as fit");
    assert.equal(prev.getAttribute("href"), "/app/breaks?sort=age&offset=19&size=6");
    assert.equal(nav.querySelector(".pager-said").textContent, "Rows 26–31 of 240");
  } finally {
    undo();
    window.happyDOM.setURL("https://plugin.example/app/");
  }
});

test("om-pager: the first server page has no way back; named query parameters; a fixed number of rows", async () => {
  const undo = layout(400);
  try {
    put(`<main><om-pager id="p" total="90" offset="0" size="30" rows="5" offset-param="from" size-param="n"><table><tbody>${rows(30)}</tbody></table></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    assert.equal(visible(pager).length, 5, "rows= fixes it");
    const [prev, next] = pager.querySelectorAll("nav.om-pager-nav a");
    assert.equal(prev.getAttribute("aria-disabled"), "true");
    assert.equal(prev.hasAttribute("href"), false);
    assert.match(next.getAttribute("href"), /from=5&n=5$/);
  } finally {
    undo();
  }
});

test("om-pager leaves a row the page hid itself hidden and uncounted, and pages list rows", async () => {
  const undo = layout(300);
  try {
    put(`<main><om-pager id="p"><table><tbody>${rows(3)}<tr hidden id="mine"><td>Hidden by the page</td></tr>${rows(6, 4)}</tbody></table></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    // 300 - 140 = 160: 4 rows of the 9 the page shows.
    assert.deepEqual(pager.shown, { first: 1, last: 4, total: 9, size: 4 });
    pager.turn(1);
    pager.turn(1);
    assert.equal(document.getElementById("mine").hidden, true);
    put(`<main><om-pager id="l"><div class="panel">${Array.from({ length: 8 }, (_, i) => `<div class="list-row">Item ${i + 1}</div>`).join("")}</div></om-pager></main>`);
    await settle();
    const list = document.getElementById("l");
    list.refit();
    assert.equal(list.shown.total, 8);
  } finally {
    undo();
  }
});

test("om-pager pages an om-grid's rows, again when the grid redraws them", async () => {
  const undo = layout(300);
  try {
    put(`<main><om-pager id="p"><om-grid id="g" row-key="id" one-line></om-grid></om-pager></main>`);
    await settle();
    const grid = document.getElementById("g");
    grid.columns = [{ key: "id", label: "ID" }];
    grid.setRows(Array.from({ length: 12 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}` })));
    const pager = document.getElementById("p");
    pager.refit();
    assert.ok(grid.querySelector("table").classList.contains("one-line"), "one-line draws a table.one-line");
    assert.deepEqual(pager.shown, { first: 1, last: 4, total: 12, size: 4 });
    grid.sortBy("id", "descending");
    await settle();
    pager.refit();
    const shown = [...grid.querySelectorAll("tbody tr")].filter((r) => !r.hidden).map((r) => r.dataset.key);
    assert.deepEqual(shown, ["r11", "r10", "r09", "r08"], "sorted, the first page is the new first rows");
  } finally {
    undo();
  }
});

// ── The budget's arithmetic, and the check's words ───────────────────────────

test("how many rows fit: the budget less the rest of the page, over the tallest row; at least one", () => {
  const row = (h) => ({ getBoundingClientRect: () => ({ height: h }) });
  assert.equal(rowsThatFit([row(40), row(40)], { budget: 900, content: 380 }), 15, "(900 - 300) / 40: the rest of the page is 380 less the 80 of rows");
  assert.equal(rowsThatFit([row(40), row(60)], { budget: 500, content: 300 }), 5, "the tallest row is each row's height");
  assert.equal(rowsThatFit([row(40)], { budget: 100, content: 400 }), 1, "never none");
  assert.equal(rowsThatFit([], { budget: 900, content: 100 }), null, "nothing to measure");
});

test("the check's two screens, and its words naming what overflows", () => {
  assert.deepEqual(SIZES.map((s) => [s.name, s.width, s.height]), [["desktop", 1440, 900], ["phone", 390, 844]]);
  const words = fitProblems({
    width: 390, height: 844, docWidth: 410, docHeight: 1200,
    overflow: [
      { axis: "height", by: 356, element: "section#breaks > table", text: "Cause", reach: 1180, first: "section#notes", firstText: "Notes", firstAt: 900 },
      { axis: "width", by: 20, element: "select#state", text: "All states", reach: 410 },
    ],
    wrapped: [{ row: "table.one-line > tbody > tr:nth-of-type(3)", cell: "The venue answered 503", lines: 2 }],
  }, SIZES[1]);
  assert.deepEqual(words, [
    "at 390×844 the document is 356px too tall: section#breaks > table (“Cause”) reaches 1180px; first below the fold: section#notes (“Notes”) at 900px",
    "at 390×844 the document is 20px too wide: select#state (“All states”) reaches 410px",
    "at 390×844 a one-line row wraps to 2 lines: table.one-line > tbody > tr:nth-of-type(3), “The venue answered 503”",
  ]);
  assert.deepEqual(fitProblems({ width: 1440, height: 900, docWidth: 1440, docHeight: 900, overflow: [], wrapped: [] }), []);
});

test("make fit holds every gallery page", () => {
  const fit = read("tools/fit.mjs");
  for (const page of ["gallery.html", "gallery/sample.html", "gallery/patterns.html", "gallery/accounts.html", "gallery/accounts-many.html", "gallery/host.html"]) {
    assert.ok(fit.includes(`"${page}`), page);
  }
});

test("the stand-in host holds its frame to the screen under its chrome, and grows it to no page", () => {
  const host = read("src/gallery/host.html");
  assert.match(host, /main\.host \{ display: flex; flex-direction: column; height: var\(--om-page-height\); \}/);
  assert.match(host, /#plugin \{[^}]*flex: 1 1 0;/);
  const script = read("src/gallery/host.js");
  assert.doesNotMatch(script, /frame\.style\.height\s*=/, "a size message no longer sets the frame's height");
});
