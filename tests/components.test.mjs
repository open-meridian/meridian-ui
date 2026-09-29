// The components render and behave, in a headless DOM (happy-dom).

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDecimal, groupDigits } from "../src/lib/decimal.js";
import { niceTicks } from "../src/components/om-chart.js";
import { addDays } from "../src/components/om-asof.js";
import { settle } from "./helpers.mjs";

function mount(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

const texts = (grid, col) => [...grid.querySelectorAll("tbody tr[data-key]")].map((tr) => tr.cells[col].textContent);

// ── decimals ────────────────────────────────────────────────────────────────

test("decimals compare exactly, as strings, never as floats", () => {
  assert.equal(compareDecimal("10.5", "9.99"), 1);
  assert.equal(compareDecimal("-1", "0"), -1);
  assert.equal(compareDecimal("0.10", "0.1"), 0);
  assert.equal(compareDecimal("-0.00", "0"), 0);
  // Beyond a double's precision: a float would call these equal.
  assert.equal(compareDecimal("9007199254740993.01", "9007199254740993.02"), -1);
  assert.equal(compareDecimal("0.30000000000000000001", "0.3"), 1);
  assert.equal(groupDigits("-1234567.891"), "-1,234,567.891");
  assert.equal(groupDigits("999"), "999");
});

// ── om-grid ─────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: "symbol", label: "Symbol" },
  { key: "qty", label: "Quantity", type: "decimal", group: true },
  { key: "pnl", label: "P&L", type: "decimal", tone: "sign" },
  { key: "state", label: "State", type: "badge", tone: (v) => (v === "Current" ? "good" : "warn") },
];
const ROWS = [
  { id: "a", symbol: "AAPL", qty: "1200", pnl: "10.5", state: "Current" },
  { id: "b", symbol: "MSFT", qty: "450", pnl: "-1", state: "Stale" },
  { id: "c", symbol: "NVDA", qty: "20000", pnl: "9.99", state: "Current" },
  { id: "d", symbol: "IVV", qty: "0.001", pnl: "100", state: "Current" },
];

function grid(attrs = "") {
  const g = mount(`<om-grid ${attrs}></om-grid>`);
  g.columns = COLUMNS;
  g.setRows(ROWS);
  return g;
}

test("om-grid renders columns and keyed rows, numbers right-aligned", () => {
  const g = grid();
  const ths = [...g.querySelectorAll("thead th")];
  assert.deepEqual(ths.map((th) => th.textContent), ["Symbol", "Quantity", "P&L", "State"]);
  assert.ok(ths[1].classList.contains("num") && !ths[0].classList.contains("num"));
  const trs = g.querySelectorAll("tbody tr[data-key]");
  assert.deepEqual([...trs].map((tr) => tr.dataset.key), ["a", "b", "c", "d"]);
  assert.ok(trs[0].cells[1].classList.contains("num"));
  assert.equal(trs[0].cells[1].textContent, "1,200", "grouped, not reformatted");
  assert.equal(trs[3].cells[1].textContent, "0.001");
  assert.ok(trs[0].cells[2].classList.contains("up") && trs[1].cells[2].classList.contains("down"));
  assert.equal(trs[0].cells[3].querySelector(".badge.good").textContent, "Current");
  assert.equal(trs[1].cells[3].querySelector(".badge.warn").textContent, "Stale");
});

test("om-grid dense mode", () => {
  const g = grid("dense");
  assert.ok(g.querySelector("table").classList.contains("dense"));
  g.removeAttribute("dense");
  assert.ok(!g.querySelector("table").classList.contains("dense"));
});

test("om-grid sorts decimals exactly, both ways, from the header", () => {
  const g = grid('sort="pnl:desc"');
  assert.deepEqual(texts(g, 2), ["100", "10.5", "9.99", "-1"]);
  assert.equal(g.querySelectorAll("th")[2].getAttribute("aria-sort"), "descending");
  const sortEvents = [];
  g.addEventListener("om-sort", (e) => sortEvents.push(e.detail));
  g.querySelectorAll("th")[2].querySelector("button").click();
  assert.deepEqual(texts(g, 2), ["-1", "9.99", "10.5", "100"]);
  assert.deepEqual(sortEvents, [{ key: "pnl", direction: "ascending" }]);
  g.querySelectorAll("th")[0].querySelector("button").click();
  assert.deepEqual(texts(g, 0), ["AAPL", "IVV", "MSFT", "NVDA"]);
});

test("om-grid leaves sorting to the page that cancels om-sort", () => {
  const g = grid();
  g.addEventListener("om-sort", (e) => e.preventDefault());
  g.querySelectorAll("th")[2].querySelector("button").click();
  assert.deepEqual(texts(g, 0), ["AAPL", "MSFT", "NVDA", "IVV"], "arrival order kept");
  assert.equal(g.querySelectorAll("th")[2].getAttribute("aria-sort"), "ascending", "but the header says what was asked");
});

test("om-grid replaces a row in place, and conflates a burst into one update", () => {
  const g = grid();
  const tr = g.querySelector('tr[data-key="b"]');
  const symbolCell = tr.cells[0];
  g.upsert({ id: "b", symbol: "MSFT", qty: "451", pnl: "-2", state: "Stale" });
  g.upsert({ id: "b", symbol: "MSFT", qty: "452", pnl: "-3", state: "Stale" });
  g.upsert([{ id: "b", symbol: "MSFT", qty: "460", pnl: "5", state: "Current" }]);
  assert.equal(tr.cells[1].textContent, "450", "nothing drawn before the frame");
  g.flush();
  assert.equal(g.querySelector('tr[data-key="b"]'), tr, "the same <tr>");
  assert.equal(tr.cells[0], symbolCell, "an unchanged cell is the same cell");
  assert.equal(tr.cells[1].textContent, "460", "the last state won");
  assert.ok(tr.cells[2].classList.contains("up"));
  assert.equal(g.querySelectorAll("tbody tr[data-key]").length, 4, "replaced, not appended");
  assert.equal(g.getRow("b").qty, "460");
});

test("om-grid applies queued updates on the next frame by itself", async () => {
  const g = grid();
  g.upsert({ id: "a", symbol: "AAPL", qty: "1", pnl: "0", state: "Current" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(g.querySelector('tr[data-key="a"]').cells[1].textContent, "1");
});

test("om-grid inserts new keys in sorted place, removes, and shows empty", () => {
  const g = grid('sort="pnl:desc"');
  g.upsert({ id: "e", symbol: "AMZN", qty: "5", pnl: "50", state: "Current" });
  g.remove("d");
  g.flush();
  assert.deepEqual(texts(g, 0), ["AMZN", "AAPL", "NVDA", "MSFT"]);
  // A live change to the sorted column moves the row.
  g.upsert({ id: "b", symbol: "MSFT", qty: "450", pnl: "999", state: "Stale" });
  g.flush();
  assert.equal(texts(g, 0)[0], "MSFT");
  g.setRows([]);
  assert.match(g.querySelector("tr.om-grid-empty").textContent, /Nothing to show/);
  g.setAttribute("empty", "No positions.");
  assert.equal(g.querySelector("tr.om-grid-empty").textContent, "No positions.");
});

test("om-grid refuses a row with no key", () => {
  const g = grid();
  assert.throws(() => g.upsert({ symbol: "X" }), /no key/);
});

test("om-grid raises om-row for a clicked row", () => {
  const g = grid();
  let got = null;
  g.addEventListener("om-row", (e) => (got = e.detail));
  g.querySelector('tr[data-key="c"]').cells[0].click();
  assert.equal(got.key, "c");
  assert.equal(got.row.symbol, "NVDA");
});

// ── om-chart ────────────────────────────────────────────────────────────────

const SERIES = [
  { name: "NAV", color: "accent", points: [["2026-09-01", "100.5"], ["2026-09-02", "101.25"], ["2026-09-03", "99"]] },
  { name: "Benchmark", points: [{ t: "2026-09-01", v: 100 }, { t: "2026-09-02", v: 100.4 }, { t: "2026-09-03", v: 100.1 }] },
];

test("om-chart draws a line per series in scheme colours", () => {
  const c = mount('<om-chart type="line" height="200" label="NAV"></om-chart>');
  c.series = SERIES;
  const svg = c.querySelector("svg");
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "NAV");
  const paths = c.querySelectorAll("path.om-series");
  assert.equal(paths.length, 2);
  assert.ok(paths[0].classList.contains("c-accent"));
  assert.ok(paths[1].classList.contains("c-violet"), "the palette's second colour");
  assert.match(paths[0].getAttribute("d"), /^M[\d.]+,[\d.]+L[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
  assert.ok(c.querySelectorAll("text.om-tick").length > 3, "axis labels");
  assert.equal(c.querySelectorAll(".om-legend > span").length, 2);
});

test("om-chart draws bars from zero", () => {
  const c = mount('<om-chart type="bar"></om-chart>');
  c.series = [{ name: "Flows", color: "buy", points: [["2026-09-01", "5"], ["2026-09-02", "-3"], ["2026-09-03", "8"]] }];
  const bars = c.querySelectorAll("rect.om-bar");
  assert.equal(bars.length, 3);
  assert.ok(bars[0].classList.contains("c-buy"));
  const zero = Number(c.querySelector("line.om-axis").getAttribute("y1"));
  assert.ok(Math.abs(Number(bars[1].getAttribute("y")) - zero) < 0.01, "a negative bar hangs from zero");
});

test("om-chart says when there is nothing to draw; ticks are round", () => {
  const c = mount("<om-chart></om-chart>");
  c.series = [];
  assert.equal(c.querySelector("text").textContent, "No data");
  assert.deepEqual(niceTicks(0, 97), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(99, 101.25), [99, 99.5, 100, 100.5, 101, 101.5]);
});

// ── om-asof ─────────────────────────────────────────────────────────────────

test("om-asof steps by calendar day and announces the change", () => {
  const a = mount('<om-asof value="2026-02-28" max="2026-03-01"></om-asof>');
  assert.equal(a.value, "2026-02-28");
  assert.equal(a.querySelector("input").value, "2026-02-28");
  const seen = [];
  a.addEventListener("change", (e) => seen.push(e.detail.value));
  const [prev, next] = [a.querySelector('[aria-label="Previous day"]'), a.querySelector('[aria-label="Next day"]')];
  next.click();
  assert.equal(a.value, "2026-03-01");
  assert.ok(next.disabled, "not past max");
  prev.click();
  prev.click();
  assert.deepEqual(seen, ["2026-03-01", "2026-02-28", "2026-02-27"]);
  a.value = "2026-13-01";
  assert.equal(a.value, "", "an invalid date is the latest, not a guess");
  a.value = "2027-01-01";
  assert.equal(a.value, "2026-03-01", "clamped to max");
  a.querySelector(".om-asof-latest-button").click();
  assert.equal(a.value, "");
  assert.ok(a.hasAttribute("latest"));
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

// ── om-instrument-picker ────────────────────────────────────────────────────

const AAPL = {
  instrument_id: "INS-3f1c9a02",
  description: "Apple Inc. common stock",
  asset_class: "equity",
  currency: "USD",
  exchange_mic: "XNAS",
  identifiers: [{ scheme: "ticker", value: "AAPL", source: "" }],
};

function stubFetch(answer) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return typeof answer === "function" ? answer(url) : new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

test("om-instrument-picker asks the page's own server, dated, and chooses by keyboard", async () => {
  document.body.innerHTML = '<om-asof id="d" value="2026-09-01"></om-asof><om-instrument-picker src="api/search" asof="d" limit="5"></om-instrument-picker>';
  const p = document.querySelector("om-instrument-picker");
  const calls = stubFetch({ results: [AAPL, { ...AAPL, instrument_id: "INS-2", description: "Apple Hospitality REIT" }] });
  await p.search("aapl");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://plugin.example");
  assert.equal(url.pathname, "/app/api/search");
  assert.equal(url.searchParams.get("q"), "aapl");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("as_of"), "2026-09-01");
  assert.equal(calls[0].init.headers.Accept, "application/json");
  const options = p.querySelectorAll('[role="option"]');
  assert.equal(options.length, 2);
  assert.match(options[0].textContent, /Apple Inc\. common stock/);
  assert.match(options[0].textContent, /ticker:AAPL/);
  const input = p.querySelector('input[role="combobox"]');
  assert.equal(input.getAttribute("aria-expanded"), "true");
  let chosen = null;
  p.addEventListener("om-select", (e) => (chosen = e.detail.instrument));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  assert.equal(chosen.instrument_id, "INS-2");
  assert.equal(p.value, "INS-2");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.match(p.querySelector(".chip").textContent, /Apple Hospitality REIT/);
});

test("om-instrument-picker refuses another origin and reports a failed search", async () => {
  const p = mount('<om-instrument-picker src="https://elsewhere.example/search"></om-instrument-picker>');
  const calls = stubFetch({ results: [] });
  let error = null;
  p.addEventListener("om-error", (e) => (error = e.detail.error));
  await p.search("x");
  assert.equal(calls.length, 0, "nothing fetched");
  assert.match(error, /not this page's origin/);

  p.setAttribute("src", "search");
  stubFetch(() => new Response("no", { status: 502 }));
  await p.search("x");
  assert.match(p.querySelector(".om-picker-status.bad").textContent, /Search failed: the search answered 502/);

  stubFetch({ results: [] });
  await p.search("zzz");
  assert.match(p.querySelector(".om-picker-status").textContent, /No instrument matches/);
});

test("every component is defined", async () => {
  await settle();
  for (const name of ["om-grid", "om-chart", "om-asof", "om-instrument-picker", "om-live"]) {
    assert.ok(customElements.get(name), name);
  }
});
