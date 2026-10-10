// Search beside the pager (0.11.0; the product owner's preferences of
// 2026-10-10, meridian-design tasks/design/every-page-fits-one-screen.md):
// om-grid, om-pager and om-entry-grid given `search` draw a box above their
// rows; a row stays while its text holds every word typed; the pages are of
// what is left; a server's pages ask the server. What only a real browser's
// layout can say, tools/fit.mjs holds (make fit).

import "./dom.mjs";
import "../src/components/index.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { put, settle } from "./helpers.mjs";
import { UNMATCHED, fold, matchedSaid, matches, wordsOf } from "../src/lib/search.js";

afterEach(() => {
  document.body.replaceChildren();
  window.happyDOM.setURL("https://plugin.example/app/");
});

const frame = () => new Promise((r) => setTimeout(r, 40));

/** Type into a search box as a person does: the value, then input. */
async function search(host, text) {
  const input = host.querySelector(":scope > .om-search input[type=search]");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await frame();
  return input;
}

const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const said = (host) => {
  const s = host.querySelector(":scope > .om-search .om-search-said");
  return s.hidden ? "" : s.textContent;
};

// ── The words ────────────────────────────────────────────────────────────────

test("a search matches every word typed, anywhere, case, spacing and width aside", () => {
  assert.equal(fold("  Roth\tIRA  "), "roth ira");
  assert.equal(fold("ＡＢＣ"), "abc", "full-width letters are the same letters");
  assert.deepEqual(wordsOf("  Fidelity   roth "), ["fidelity", "roth"]);
  assert.deepEqual(wordsOf(""), []);
  assert.ok(matches("roth ira\nfidelity", ["fidelity", "roth"]), "in any order, across fields");
  assert.ok(!matches("roth ira\nfidelity", ["schwab"]));
  assert.equal(matchedSaid(3, 40), "3 of 40 rows");
  assert.equal(matchedSaid(1, 1), "1 of 1 row");
  assert.equal(matchedSaid(0, 40), "No rows match");
  assert.equal(matchedSaid(1200, 2400), "1,200 of 2,400 rows");
});

// ── om-grid ──────────────────────────────────────────────────────────────────

const ORDERS = [
  { id: "o1", account: "Roth IRA", symbol: "AAPL", qty: "1250.5", state: "Working", note: "Fidelity" },
  { id: "o2", account: "Main", symbol: "MSFT", qty: "310", state: "Filled", note: "Interactive Brokers" },
  { id: "o3", account: "Roth IRA", symbol: "MSFT", qty: "12", state: "Filled", note: "Fidelity" },
  { id: "o4", account: "Trust", symbol: "USD", qty: "18004.12", state: "Cancelled", note: "Schwab" },
  { id: "o5", account: "Main", symbol: "NVDA", qty: "4", state: "Working", note: "Interactive Brokers" },
];
const ORDER_COLUMNS = [
  { key: "account", label: "Account", hint: "note" },
  { key: "symbol", label: "Instrument", type: "code" },
  { key: "qty", label: "Quantity", type: "decimal", group: true },
  { key: "state", label: "State", type: "badge" },
];

async function orders(attrs = 'search="Search orders"') {
  put(`<om-grid id="g" row-key="id" ${attrs}></om-grid>`);
  await settle();
  const g = document.getElementById("g");
  g.columns = ORDER_COLUMNS;
  g.setRows(ORDERS);
  return g;
}

const shownKeys = (g) => [...g.querySelectorAll("tbody tr[data-key]")].filter((tr) => !tr.hasAttribute(UNMATCHED)).map((tr) => tr.dataset.key);

test("om-grid search: a box above the rows, named by the attribute's words, narrowing as typed", async () => {
  const g = await orders();
  const bar = g.firstElementChild;
  assert.ok(bar.matches(".om-search[role=search]"), "the box is above the table");
  const input = bar.querySelector("input");
  assert.equal(input.type, "search");
  assert.equal(input.getAttribute("aria-label"), "Search orders");
  assert.equal(input.placeholder, "Search orders");
  assert.equal(said(g), "", "nothing said before a search");
  await search(g, "roth msft");
  assert.deepEqual(shownKeys(g), ["o3"], "every word, across columns");
  assert.equal(said(g), "1 of 5 rows");
  await search(g, "fidelity");
  assert.deepEqual(shownKeys(g), ["o1", "o3"], "a column's hint is searched");
  await search(g, "1,250");
  assert.deepEqual(shownKeys(g), ["o1"], "a figure as shown, its digits grouped");
  await search(g, "1250.5");
  assert.deepEqual(shownKeys(g), ["o1"], "and as given");
  assert.equal(g.rows.length, 5, "every row is still the grid's");
});

test("om-grid search: none matching says so in the table; Escape empties it and every row returns", async () => {
  const g = await orders();
  const input = await search(g, "kraken");
  assert.deepEqual(shownKeys(g), []);
  assert.equal(said(g), "No rows match");
  assert.equal(g.querySelector("tr.om-grid-empty").textContent, "No rows match the search.");
  key(input, "Escape");
  assert.equal(input.value, "");
  assert.deepEqual(shownKeys(g), ["o1", "o2", "o3", "o4", "o5"]);
  assert.equal(g.querySelector("tr.om-grid-empty"), null);
  assert.equal(said(g), "");
});

test("om-grid search holds as rows change: a row arriving or changing is searched too", async () => {
  const g = await orders();
  await search(g, "working");
  assert.deepEqual(shownKeys(g), ["o1", "o5"]);
  g.upsert([{ ...ORDERS[1], state: "Working" }, { id: "o6", account: "Trust", symbol: "TSLA", qty: "1", state: "Filled", note: "Schwab" }]);
  g.flush();
  assert.deepEqual(shownKeys(g), ["o1", "o2", "o5"], "o2 now matches; o6 arrived and does not");
  assert.equal(said(g), "3 of 6 rows");
});

test("om-grid search: om-search is raised first, and cancelled the page searches itself", async () => {
  const g = await orders();
  const heard = [];
  g.addEventListener("om-search", (e) => {
    heard.push(e.detail.query);
    e.preventDefault();
  });
  await search(g, "roth");
  assert.deepEqual(heard, ["roth"]);
  assert.deepEqual(shownKeys(g), ["o1", "o2", "o3", "o4", "o5"], "nothing narrowed: the page sets the rows it finds");
});

test("om-grid search: the attribute removed takes the box away and every row back", async () => {
  const g = await orders();
  await search(g, "roth");
  g.setAttribute("search", "Find an order");
  assert.equal(g.querySelector(".om-search input").getAttribute("aria-label"), "Find an order");
  g.removeAttribute("search");
  assert.equal(g.querySelector(".om-search"), null);
  assert.deepEqual(shownKeys(g), ["o1", "o2", "o3", "o4", "o5"]);
  const plain = await orders("");
  assert.equal(plain.querySelector(".om-search"), null, "no search without the attribute");
});

test("om-grid search in high-rate mode: the window is drawn from what the search leaves", async () => {
  put(`<om-grid id="q" row-key="id" high-rate search></om-grid>`);
  await settle();
  const g = document.getElementById("q");
  g.columns = [{ key: "id", label: "ID", type: "code" }, { key: "px", label: "Price", type: "decimal" }];
  g.setRows(Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, px: `${100 + i}.25` })));
  assert.equal(g.querySelector(".om-search input").getAttribute("aria-label"), "Search", "the box's name when the attribute has no words");
  await search(g, "r19");
  const drawn = [...g.querySelectorAll("tbody tr[data-key]")].map((tr) => tr.dataset.key);
  assert.ok(drawn.length > 0 && drawn.every((k) => k.startsWith("r19")), drawn.slice(0, 5).join(","));
  // r19, r190–r199, r1900–r1999: 111 rows.
  assert.equal(g.querySelector("table").getAttribute("aria-rowcount"), "112");
  assert.equal(said(g), "111 of 2,000 rows");
  g.upsert({ id: "r1950", px: "1.00" });
  g.upsert({ id: "r19x", px: "2.00" });
  g.flush();
  assert.equal(g.querySelector("table").getAttribute("aria-rowcount"), "113", "a new row matching is in the window's count");
  // A row the search leaves out, asked for, ends the search.
  assert.equal(g.scrollToRow("r5"), true);
  assert.equal(g.querySelector(".om-search input").value, "");
  assert.equal(g.querySelector("table").getAttribute("aria-rowcount"), "2002");
});

// ── om-pager ─────────────────────────────────────────────────────────────────

const ROW = 40;
const REST = 100;
/** Each shown row 40px, the pager 40px, the search 40px, the rest 100px. */
function layout(height) {
  window.happyDOM.setViewport({ width: 1440, height });
  const shown = (el) => !el.hidden && !el.closest("[hidden]") && !el.hasAttribute(UNMATCHED);
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    let h = 0;
    if (this.localName === "tr") h = shown(this) ? ROW : 0;
    else if (this.matches("nav.pager, .om-search")) h = shown(this) ? ROW : 0;
    else if (this.localName === "main") {
      const rows = [...this.querySelectorAll("tbody tr")].filter(shown).length;
      const bars = [...this.querySelectorAll("om-pager > nav.pager, .om-search")].filter(shown).length;
      h = REST + (rows + bars) * ROW;
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, width: 1000, height: h, bottom: h };
  };
  return () => (proto.getBoundingClientRect = original);
}
const rows = (n, from = 1) => Array.from({ length: n }, (_, i) => `<tr><td>Row ${from + i}</td></tr>`).join("");
const visible = (pager) => [...pager.querySelectorAll("tbody tr")].filter((r) => !r.hidden && !r.hasAttribute(UNMATCHED)).map((r) => r.textContent);

test("om-pager search, rows all here: narrowed as typed, the pages of what is left, the box above and the pager below", async () => {
  const undo = layout(440);
  try {
    put(`<main><om-pager id="p" search="Search rows"><table class="one-line"><tbody>${rows(20)}</tbody></table></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    assert.ok(pager.firstElementChild.matches(".om-search"), "the box is above the rows");
    assert.ok(pager.lastElementChild.matches("nav.pager"), "the pager under them, beside it rather than instead of it");
    // 440 less the rest, the box and the pager (180), over 40: 6.
    assert.deepEqual(pager.shown, { first: 1, last: 6, total: 20, size: 6 });
    pager.turn(1);
    await search(pager, "row 1");
    pager.refit();
    // Row 1 and Rows 10 to 19.
    assert.equal(said(pager), "11 of 20 rows");
    assert.deepEqual(pager.shown, { first: 1, last: 6, total: 11, size: 6 }, "a new search starts at its first page");
    assert.deepEqual(visible(pager), ["Row 1", "Row 10", "Row 11", "Row 12", "Row 13", "Row 14"]);
    assert.equal(pager.querySelector("nav.om-pager-nav .pager-said").textContent, "Rows 1–6 of 11");
    pager.turn(1);
    assert.deepEqual(visible(pager), ["Row 15", "Row 16", "Row 17", "Row 18", "Row 19"]);
    await search(pager, "");
    pager.refit();
    assert.equal(pager.shown.total, 20, "emptied, every row is paged again");
    assert.equal(said(pager), "");
  } finally {
    undo();
  }
});

test("om-pager search over a server's pages: Enter asks the server for the first page of what it finds", async () => {
  const undo = layout(400);
  try {
    window.happyDOM.setURL("https://plugin.example/app/instruments?sort=name&q=apple&offset=25&size=25");
    put(`<main><om-pager id="p" search="Search instruments" total="240" offset="25" size="25"><table><tbody>${rows(25, 26)}</tbody></table></om-pager></main>`);
    await settle();
    const pager = document.getElementById("p");
    pager.refit();
    const input = pager.querySelector(".om-search input");
    assert.equal(input.value, "apple", "the box shows the query the address asked");
    const asked = [];
    pager.addEventListener("om-search", (e) => {
      asked.push(e.detail);
      e.preventDefault();
    });
    input.value = "microsoft corp";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
    assert.deepEqual(asked, [], "typing alone asks nothing of the server");
    // 400 less the rest, the box and the pager (180), over 40: 5.
    assert.equal(visible(pager).length, 5, "and narrows nothing here");
    key(input, "Enter");
    assert.deepEqual(asked, [{ query: "microsoft corp", href: "/app/instruments?sort=name&q=microsoft+corp&size=5" }], "the offset dropped, the size what fits");
    key(input, "Escape");
    assert.equal(asked[1].href, "/app/instruments?sort=name&size=5", "emptied, the query leaves the address");
  } finally {
    undo();
  }
});

test("om-pager search: search-param names the query", async () => {
  window.happyDOM.setURL("https://plugin.example/app/tickets?find=fee");
  put(`<main><om-pager id="p" search search-param="find" total="90" offset="0" size="30"><table><tbody>${rows(30)}</tbody></table></om-pager></main>`);
  await settle();
  const pager = document.getElementById("p");
  const input = pager.querySelector(".om-search input");
  assert.equal(input.value, "fee");
  let href = "";
  pager.addEventListener("om-search", (e) => {
    href = e.detail.href;
    e.preventDefault();
  });
  input.value = "late fee";
  key(input, "Enter");
  assert.match(href, /^\/app\/tickets\?find=late\+fee(&size=\d+)?$/);
});

test("om-pager pages only the rows an om-grid's own search leaves, from the first page", async () => {
  const undo = layout(300);
  try {
    put(`<main><om-pager id="p"><om-grid id="g" row-key="id" one-line search></om-grid></om-pager></main>`);
    await settle();
    const grid = document.getElementById("g");
    grid.columns = [{ key: "id", label: "ID" }];
    grid.setRows(Array.from({ length: 12 }, (_, i) => ({ id: `${i % 2 ? "odd" : "even"}-${String(i).padStart(2, "0")}` })));
    const pager = document.getElementById("p");
    pager.refit();
    // 300 less the rest, the grid's box and the pager (180), over 40: 3.
    assert.deepEqual(pager.shown, { first: 1, last: 3, total: 12, size: 3 });
    pager.turn(1);
    await search(grid, "odd");
    await settle();
    pager.refit();
    assert.deepEqual(pager.shown, { first: 1, last: 3, total: 6, size: 3 });
    const keys = [...grid.querySelectorAll("tbody tr[data-key]")].filter((r) => !r.hidden && !r.hasAttribute(UNMATCHED)).map((r) => r.dataset.key);
    assert.deepEqual(keys, ["odd-01", "odd-03", "odd-05"]);
  } finally {
    undo();
  }
});

// ── om-entry-grid ────────────────────────────────────────────────────────────

const LOT_COLUMNS = [
  { key: "instrument", label: "Instrument", type: "code" },
  { key: "quantity", label: "Quantity", type: "decimal" },
  { key: "method", label: "Method", type: "choice", options: [{ value: "fifo", label: "First in, first out" }, { value: "spec", label: "Specific lot" }] },
];
const LOTS = [
  { instrument: "AAPL", quantity: "10", method: "fifo" },
  { instrument: "MSFT", quantity: "4", method: "spec" },
  { instrument: "AAPL", quantity: "2", method: "spec" },
  { instrument: "USD", quantity: "100", method: "fifo" },
];

async function lots() {
  const data = JSON.stringify({ columns: LOT_COLUMNS, rows: LOTS });
  put(`<form method="post" action="/lots"><input type="hidden" name="csrf" value="t"><om-entry-grid name="lots" caption="Lots" search="Search lots"><script type="application/json">${data}</script></om-entry-grid></form>`);
  await settle();
  return document.querySelector("om-entry-grid");
}
const listedRows = (g) => [...g.querySelectorAll("tbody tr[data-row]")].filter((tr) => !tr.classList.contains("om-entry-paged")).map((tr) => tr.querySelector('[data-key="instrument"]').value);

test("om-entry-grid search: the rows whose values hold every word stay, and every row still posts", async () => {
  const g = await lots();
  assert.ok(g.firstElementChild.matches(".om-search"), "the box is above the table");
  await search(g, "aapl");
  assert.deepEqual(listedRows(g), ["AAPL", "AAPL"]);
  assert.equal(said(g), "2 of 4 rows");
  await search(g, "specific");
  assert.deepEqual(listedRows(g), ["MSFT", "AAPL"], "a choice's label is searched");
  const form = g.closest("form");
  const names = [...new FormData(form)].map(([k]) => k).filter((k) => k.endsWith(".instrument"));
  assert.deepEqual(names, ["lots[0].instrument", "lots[1].instrument", "lots[2].instrument", "lots[3].instrument"], "rows the search leaves out are in the form");
});

test("om-entry-grid search: a row typed in stays; a row added, or one sent the keyboard, ends the search", async () => {
  const g = await lots();
  await search(g, "msft");
  assert.deepEqual(listedRows(g), ["MSFT"]);
  const input = g.querySelector('tbody tr[data-row]:not(.om-entry-paged) [data-key="instrument"]');
  input.value = "GOOG";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  assert.deepEqual(listedRows(g), ["GOOG"], "found once, as typed: the row being typed in does not leave");
  g.querySelector(".om-entry-add").click();
  await settle();
  assert.equal(g.querySelector(".om-search input").value, "", "a row added ends the search");
  assert.equal(listedRows(g).length, 5);
  assert.equal(said(g), "");
});

test("om-entry-grid search: cancelled, the page searches itself", async () => {
  const g = await lots();
  g.addEventListener("om-search", (e) => e.preventDefault());
  await search(g, "aapl");
  assert.equal(listedRows(g).length, 4);
});
