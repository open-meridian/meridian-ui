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
  assert.equal(input.value, "Apple Inc. common stock (AAPL)");
  assert.equal(input.title, "Apple Inc. common stock (AAPL), INS-3f1c9a02");
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
  assert.equal(box(g, 0).value, "Apple Inc. common stock (AAPL)");
  assert.equal(box(g, 2).value, "Apple Inc. common stock (AAPL)");
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
