// om-entry-grid's instrument column (0.12.0): typing in a cell asks the
// grid's src, on the page's own origin, for the few instruments that match;
// choosing one sets the cell to the instrument's ID, which is what posts, and
// shows its name. Nothing lists every record. The browser half (a real page,
// framed and on its own, at both screens) is in tools/fit.mjs.

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEntryValue, normaliseEntryColumn } from "../src/lib/entry.js";
import { describeColumn } from "../src/components/om-entry-grid.js";
import { put, settle } from "./helpers.mjs";

const AAPL = {
  instrument_id: "INS-3f1c9a02",
  description: "Apple Inc. common stock",
  asset_class: "equity",
  currency: "USD",
  exchange_mic: "XNAS",
  identifiers: [{ scheme: "ticker", value: "AAPL", source: "" }, { scheme: "isin", value: "US0378331005", source: "" }],
};
const APLE = { instrument_id: "INS-77aa01", description: "Apple Hospitality REIT", identifiers: [{ scheme: "ticker", value: "APLE", source: "" }] };
const MSFT = { instrument_id: "INS-8d20b7e4", description: "Microsoft Corporation common stock", identifiers: [{ scheme: "ticker", value: "MSFT", source: "" }] };
const HELD = [AAPL, APLE, MSFT];

const COLUMNS = [
  { key: "instrument", label: "Instrument", type: "instrument", required: true },
  { key: "note", label: "Note" },
];
const json = (data) => `<script type="application/json">${JSON.stringify(data)}</script>`;
const PAUSE = 260;

/** A server answering the search as core's route does: the few that match, by name, identifier or ID. */
function server({ status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url));
    if (status !== 200) return new Response("no", { status });
    const u = new URL(url);
    const q = (u.searchParams.get("q") || "").toLowerCase();
    const limit = Number(u.searchParams.get("limit"));
    const results = HELD.filter((i) => i.instrument_id.toLowerCase() === q || i.description.toLowerCase().includes(q) || i.identifiers.some((x) => x.value.toLowerCase().includes(q))).slice(0, limit);
    return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

async function grid({ rows = [], src = 'src="/admin/instruments/search"' } = {}) {
  put(`<form method="post" action="/watchlist"><input type="hidden" name="csrf" value="t0ken"><om-entry-grid name="watch" caption="Watchlist" ${src}>${json({ columns: COLUMNS, rows })}</om-entry-grid><button>Save</button></form>`);
  await settle();
  return document.querySelector("om-entry-grid");
}

const rowsOf = (g) => [...g.querySelectorAll("tbody tr[data-row]")];
const box = (g, r) => rowsOf(g)[r].querySelector('[data-key="instrument"]');
const hidden = (g, r) => rowsOf(g)[r].querySelector('td input[type="hidden"]');
const errorOf = (g, r) => box(g, r).closest("td").querySelector(".om-entry-error");
const list = () => document.querySelector("ul.om-picker-list");
const options = () => [...list().querySelectorAll('[role="option"]')];
const posted = (form) => [...new FormData(form)].map(([k, v]) => [k, String(v)]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function type(input, value) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function key(target, k) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}
function leave(input) {
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
}

test("an instrument column is a type the grid knows; its value is an ID, taken as given", () => {
  const col = normaliseEntryColumn({ key: "instrument", type: "instrument", required: true });
  assert.equal(col.type, "instrument");
  assert.deepEqual(checkEntryValue(col, " INS-3f1c9a02 "), { value: "INS-3f1c9a02", empty: false, message: null });
  assert.deepEqual(checkEntryValue(col, ""), { value: "", empty: true, message: null });
  assert.equal(describeColumn(col), "required; an instrument's ID, as the search in the table finds it");
});

test("typing searches the grid's src for a few, once typing pauses; choosing by keyboard posts the ID and shows the name", async () => {
  const calls = server();
  const g = await grid();
  assert.equal(calls.length, 0, "nothing is asked before anything is typed: no list of every record");
  const input = box(g, 0);
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(input.placeholder, "Ticker, ISIN, FIGI or name");
  assert.equal(input.hasAttribute("name"), false, "the box is the search; it does not post");
  type(input, "a");
  type(input, "ap");
  type(input, "appl");
  await wait(PAUSE);
  await settle();
  assert.equal(calls.length, 1, "one search, for what was typed when typing paused");
  assert.equal(calls[0].origin + calls[0].pathname, "https://plugin.example/admin/instruments/search");
  assert.equal(calls[0].searchParams.get("q"), "appl");
  assert.equal(calls[0].searchParams.get("limit"), "8", "a few, never every record");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(input.getAttribute("aria-controls"), list().id);
  const found = options();
  assert.equal(found.length, 2);
  assert.match(found[0].textContent, /Apple Inc\. common stock/);
  assert.match(found[0].textContent, /INS-3f1c9a02/);
  assert.match(found[0].textContent, /ticker:AAPL/);
  assert.equal(input.getAttribute("aria-activedescendant"), found[0].id);
  let changed = null;
  g.addEventListener("om-change", (e) => (changed = e.detail.rows));
  key(input, "ArrowDown");
  assert.equal(input.getAttribute("aria-activedescendant"), options()[1].id, "down goes between the matches, not to the next row");
  key(input, "ArrowUp");
  assert.equal(key(input, "Enter").defaultPrevented, true);
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(list().hidden, true);
  assert.equal(input.value, "Apple Inc. common stock (AAPL · XNAS)");
  assert.equal(input.title, "Apple Inc. common stock (AAPL · XNAS)");
  assert.equal(hidden(g, 0).value, "INS-3f1c9a02");
  assert.equal(hidden(g, 0).getAttribute("name"), "watch[0].instrument");
  assert.deepEqual(changed, [{ instrument: "INS-3f1c9a02", note: "" }]);
  assert.deepEqual(g.rows, [{ instrument: "INS-3f1c9a02", note: "" }]);
  assert.deepEqual(posted(g.closest("form")), [["csrf", "t0ken"], ["watch[0].instrument", "INS-3f1c9a02"], ["watch[0].note", ""]]);
  assert.equal(g.closest("form").checkValidity(), true);
});

test("a click on a match chooses it; a search the grid has moved on from is not drawn", async () => {
  server();
  const g = await grid();
  const input = box(g, 0);
  type(input, "micro");
  await wait(PAUSE);
  await settle();
  const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  options()[0].dispatchEvent(pressed);
  assert.equal(pressed.defaultPrevented, true, "a press keeps the keyboard in the cell");
  options()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(hidden(g, 0).value, "INS-8d20b7e4");
  assert.equal(input.value, "Microsoft Corporation common stock (MSFT)");
});

test("words typed and not chosen hold the submit, on the cell; Escape puts back what it held; emptied, it holds none", async () => {
  server();
  const g = await grid({ rows: [{ instrument: "INS-8d20b7e4", note: "core" }] });
  await settle();
  const input = box(g, 0);
  assert.equal(input.value, "Microsoft Corporation common stock (MSFT)", "a given ID is shown by its name once found");
  type(input, "nothing like it");
  await wait(PAUSE);
  await settle();
  assert.match(list().textContent, /No instrument matches/);
  leave(input);
  assert.equal(list().hidden, true, "leaving the cell closes its matches");
  assert.equal(errorOf(g, 0).hidden, false);
  assert.equal(errorOf(g, 0).textContent, "Choose one of the instruments found, or clear the cell");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(g.closest("form").checkValidity(), false, "the submit is held");
  assert.equal(hidden(g, 0).value, "INS-8d20b7e4", "what posts is still the ID it held");
  input.focus();
  key(input, "Escape");
  assert.equal(input.value, "Microsoft Corporation common stock (MSFT)");
  assert.equal(errorOf(g, 0).hidden, true);
  assert.equal(g.closest("form").checkValidity(), true);
  type(input, "");
  assert.equal(hidden(g, 0).value, "");
  assert.deepEqual(g.rows, [{ instrument: "", note: "core" }]);
  leave(input);
  assert.equal(errorOf(g, 0).textContent, "Required", "emptied in a row that is not blank, a required cell says so");
});

test("in a blank row, words not chosen still hold the submit, and nothing of the row posts", async () => {
  server();
  const g = await grid();
  const input = box(g, 0);
  type(input, "zzz");
  leave(input);
  assert.equal(errorOf(g, 0).textContent, "Choose one of the instruments found, or clear the cell");
  assert.equal(g.closest("form").checkValidity(), false);
  assert.deepEqual(posted(g.closest("form")), [["csrf", "t0ken"]]);
});

test("each ID given is looked up once, by the same search, and shown by its name; one not found stays the ID", async () => {
  const calls = server();
  const g = await grid({ rows: [{ instrument: "INS-3f1c9a02" }, { instrument: "INS-gone" }, { instrument: "INS-3f1c9a02", note: "again" }] });
  await settle(10);
  const asked = calls.map((u) => u.searchParams.get("q")).sort();
  assert.deepEqual(asked, ["INS-3f1c9a02", "INS-gone"], "each ID once");
  assert.equal(box(g, 0).value, "Apple Inc. common stock (AAPL · XNAS)");
  assert.equal(box(g, 2).value, "Apple Inc. common stock (AAPL · XNAS)");
  assert.equal(box(g, 1).value, "INS-gone");
  assert.equal(box(g, 1).title, "INS-gone");
  assert.deepEqual(posted(g.closest("form")).filter(([k]) => k.endsWith("instrument")).map(([, v]) => v), ["INS-3f1c9a02", "INS-gone", "INS-3f1c9a02"], "every ID posts as given");
});

test("IDs pasted from a spreadsheet post as they are, and are shown by name once found", async () => {
  server();
  const g = await grid();
  const data = new DataTransfer();
  data.setData("text/plain", "INS-8d20b7e4\tlong\nINS-77aa01\twatch\n");
  box(g, 0).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  await settle(10);
  assert.deepEqual(g.rows, [{ instrument: "INS-8d20b7e4", note: "long" }, { instrument: "INS-77aa01", note: "watch" }]);
  assert.equal(box(g, 1).value, "Apple Hospitality REIT (APLE)");
});

test("a search on another origin is refused before anything is fetched; a failed one says so; no src says so", async () => {
  let calls = server();
  let g = await grid({ src: 'src="https://elsewhere.example/search"' });
  let error = null;
  g.addEventListener("om-error", (e) => (error = e.detail.error));
  type(box(g, 0), "apple");
  await wait(PAUSE);
  await settle();
  assert.equal(calls.length, 0, "nothing fetched from another origin");
  assert.match(list().textContent, /not this page's origin/);
  assert.match(error, /not this page's origin/);

  calls = server({ status: 502 });
  g = await grid();
  type(box(g, 0), "apple");
  await wait(PAUSE);
  await settle();
  assert.match(list().querySelector(".om-picker-status.bad").textContent, /Search failed: the search answered 502/);

  calls = server();
  g = await grid({ src: "" });
  error = null;
  g.addEventListener("om-error", (e) => (error = e.detail.error));
  type(box(g, 0), "apple");
  await wait(PAUSE);
  await settle();
  assert.equal(calls.length, 0);
  assert.match(list().textContent, /No search: the grid has no src/);
  assert.match(error, /has none/);
});

test("the matches are drawn over the page, outside the table, and taken away with the grid", async () => {
  server();
  const g = await grid();
  type(box(g, 0), "apple");
  await wait(PAUSE);
  await settle();
  assert.equal(list().parentNode, document.body, "no table or frame cuts them off");
  assert.equal(g.contains(list()), false);
  assert.ok(list().style.top.endsWith("px"), "placed under the cell");
  g.closest("form").remove();
  assert.equal(document.querySelector("ul.om-picker-list"), null);
});

// ── Bringing an instrument in (0.15.0) ───────────────────────────────────────

const SPY = {
  instrument_id: "",
  candidate: true,
  description: "SPDR S&P 500 ETF Trust",
  asset_class: "fund",
  currency: "USD",
  exchange_mic: "",
  identifiers: [{ scheme: "ticker", value: "SPY", source: "VEN-01JUSCOMPOSITE" }, { scheme: "composite_figi", value: "BBG000BDTBL9", source: "US" }],
};

/** A server answering as core's route does with candidates=1: held records,
 * then the candidates; and the bring-in, held back until released. */
function bringingServer({ refuse = "" } = {}) {
  const calls = { searches: [], posts: [], release: null };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (init && init.method === "POST") {
      calls.posts.push({ url: u, body: JSON.parse(init.body), init });
      await new Promise((r) => (calls.release = r));
      if (refuse) return new Response(JSON.stringify({ error: refuse }), { status: 503 });
      return new Response(JSON.stringify({ instrument: { ...SPY, candidate: undefined, instrument_id: "LCL-01M5Y1XWZ2" } }), { status: 200 });
    }
    calls.searches.push(u);
    const q = (u.searchParams.get("q") || "").toLowerCase();
    const results = q === "lcl-01m5y1xwz2" ? [{ ...SPY, candidate: undefined, instrument_id: "LCL-01M5Y1XWZ2" }] : q.includes("spy") ? [SPY] : [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  };
  return calls;
}

test("with bring-in, a cell's search asks for candidates and lists them with no record ID", async () => {
  const calls = bringingServer();
  const g = await grid({ src: 'src="/admin/instruments/search?candidates=1" bring-in="/admin/instruments/bring-in"' });
  type(box(g, 0), "SPY");
  await wait(PAUSE);
  await settle();
  assert.equal(calls.searches[0].searchParams.get("candidates"), "1");
  assert.equal(calls.searches[0].searchParams.get("q"), "SPY");
  const found = options();
  assert.equal(found.length, 1, "the candidate is listed");
  assert.match(found[0].textContent, /SPDR S&P 500 ETF Trust/);
  assert.doesNotMatch(found[0].textContent, /LCL-|INS-/);
});

test("a candidate chosen in a cell is brought in, the submit held until it is; then the cell posts the held ID and shows its name and ticker", async () => {
  const calls = bringingServer();
  const g = await grid({ src: 'src="/admin/instruments/search?candidates=1" bring-in="/admin/instruments/bring-in"' });
  const input = box(g, 0);
  type(input, "SPY");
  await wait(PAUSE);
  await settle();
  key(input, "Enter");
  await settle();
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].url.pathname, "/admin/instruments/bring-in");
  assert.equal(calls.posts[0].init.credentials, "same-origin");
  assert.deepEqual(calls.posts[0].body, { candidate: SPY });
  assert.equal(g.bringing, true);
  assert.equal(input.getAttribute("aria-busy"), "true");
  assert.equal(input.value, "SPDR S&P 500 ETF Trust (SPY): bringing in…");
  assert.equal(hidden(g, 0).value, "", "nothing posts yet");
  assert.equal(g.closest("form").checkValidity(), false, "the submit is held while it is brought in");
  calls.release();
  await settle();
  assert.equal(g.bringing, false);
  assert.equal(input.hasAttribute("aria-busy"), false);
  assert.equal(hidden(g, 0).value, "LCL-01M5Y1XWZ2", "the held record's ID posts");
  assert.equal(input.value, "SPDR S&P 500 ETF Trust (SPY)", "its name and ticker, never the record's ID");
  assert.equal(input.title, "SPDR S&P 500 ETF Trust (SPY)");
  assert.doesNotMatch(input.value + input.title, /LCL-|BBG/);
  assert.equal(g.closest("form").checkValidity(), true);
  assert.deepEqual(g.rows, [{ instrument: "LCL-01M5Y1XWZ2", note: "" }]);
});

test("a refused bring-in is the cell's problem, saying why, until the cell is typed in again", async () => {
  const calls = bringingServer({ refuse: "the instrument store is not answering" });
  const g = await grid({ src: 'src="/admin/instruments/search?candidates=1"' });
  g.setAttribute("bring-in", "/admin/instruments/bring-in");
  let error = null;
  g.addEventListener("om-error", (e) => (error = e.detail.error));
  const input = box(g, 0);
  type(input, "SPY");
  await wait(PAUSE);
  await settle();
  options()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
  calls.release();
  await settle(5);
  assert.equal(g.bringing, false);
  assert.equal(hidden(g, 0).value, "");
  assert.equal(errorOf(g, 0).hidden, false);
  assert.match(errorOf(g, 0).textContent, /Could not bring in SPDR S&P 500 ETF Trust \(SPY\): the instrument store is not answering/);
  assert.match(error, /Could not bring in/);
  assert.equal(g.closest("form").checkValidity(), false);
  type(input, "");
  assert.equal(g.closest("form").checkValidity(), true, "cleared, the cell holds nothing and no problem");
});

test("the bringIn property is the hook; typing again abandons a bring-in under way", async () => {
  bringingServer();
  const g = await grid({ src: 'src="/admin/instruments/search?candidates=1"' });
  const asked = [];
  let aborted = false;
  let release;
  g.bringIn = (candidate, { signal }) => {
    asked.push(candidate);
    signal.addEventListener("abort", () => (aborted = true));
    return new Promise((resolve) => (release = () => resolve({ ...candidate, candidate: undefined, instrument_id: "LCL-LATE" })));
  };
  const input = box(g, 0);
  type(input, "SPY");
  await wait(PAUSE);
  await settle();
  key(input, "Enter");
  await settle();
  assert.deepEqual(asked, [SPY]);
  type(input, "SP");
  assert.equal(aborted, true);
  release();
  await settle();
  assert.equal(hidden(g, 0).value, "", "the late answer is not taken");
});

test("a held record without a name is named by its ticker, never its ID", async () => {
  const { instrumentLabel } = await import("../src/lib/instruments.js");
  assert.equal(instrumentLabel({ instrument_id: "LCL-01M5Y1", description: "", identifiers: [{ scheme: "composite_figi", value: "BBG000BDTBL9", source: "US" }, { scheme: "ticker", value: "SPY", source: "VEN-01J" }] }), "SPY");
  assert.equal(instrumentLabel({ instrument_id: "INS-1", description: "Apple Inc.", exchange_mic: "XNAS", identifiers: [{ scheme: "isin", value: "US0378331005" }, { scheme: "ticker", value: "AAPL" }] }), "Apple Inc. (AAPL · XNAS)");
  assert.equal(instrumentLabel({ instrument_id: "INS-2", description: "US Treasury 4.25% 2034", identifiers: [{ scheme: "cusip", value: "91282CKQ3" }] }), "US Treasury 4.25% 2034 (91282CKQ3)");
  assert.equal(instrumentLabel({ instrument_id: "INS-3", description: "", identifiers: [] }), "An instrument");
});
