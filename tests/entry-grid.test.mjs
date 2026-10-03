// om-entry-grid: rows a person types into a table of typed inputs, posted
// with the page's own form. Each column's type checked as it is typed, the
// message on the cell; rows added and removed; cells pasted from a
// spreadsheet; a CSV read in a dialog, mapped and previewed before it is
// applied; the server's messages placed by path; the inputs named by path, so
// the form posts with no script of the grid's, and the page's own table posts
// where the kit is not served. The browser half (a real paste, a real submit,
// a page with script turned off, a phone) is in tools/bench.mjs.

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { addDecimals } from "../src/lib/decimal.js";
import {
  checkEntryValue,
  columnForField,
  isPath,
  locatePath,
  matchHeaders,
  normaliseEntryColumn,
  parseDelimited,
  sniffDelimiter,
} from "../src/lib/entry.js";
import { describeColumn } from "../src/components/om-entry-grid.js";
import { put, read, settle } from "./helpers.mjs";

// The completion form's lots, as a page declares them.
const COLUMNS = [
  { key: "quantity", label: "Quantity", type: "decimal", required: true, places: 6, hint: "Signed as the position is" },
  { key: "cost", label: "Cost", type: "decimal", places: 2, min: "0", path: "terms.cost" },
  { key: "currency", label: "Currency", type: "code", length: 3, required: true, default: "USD" },
  { key: "acquired", label: "Acquired", type: "date", max: "2026-09-30" },
  { key: "method", label: "Method", type: "choice", options: [{ value: "fifo", label: "First in, first out" }, { value: "spec", label: "Specific lot" }] },
  { key: "source", label: "Source", type: "text", max_length: 20 },
  { key: "lot_id", label: "Lot", type: "readonly" },
];
const ROWS = [
  { quantity: "10", cost: "1500.00", currency: "USD", acquired: "2026-01-02", method: "fifo", source: "statement", lot_id: "L-1" },
  { quantity: "5", cost: "760.5", currency: "USD", acquired: "2026-03-04", method: "spec", source: "statement", lot_id: "L-2" },
];
const CSS = read("src/css/base.css") + read("src/css/components.css");
const SETTINGS = { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true };
const json = (data) => `<script type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

async function grid(data = { columns: COLUMNS, rows: ROWS }, attrs = 'name="lots" caption="Lots"', inner = "") {
  put(`<form method="post" action="/opening/lots"><input type="hidden" name="csrf" value="t0ken"><om-entry-grid ${attrs}>${json(data)}${inner}</om-entry-grid><button class="primary">Save</button></form>`);
  await settle();
  return document.querySelector("om-entry-grid");
}

const rowsOf = (g) => [...g.querySelectorAll("tbody tr[data-row]")];
const cell = (g, r, key) => rowsOf(g)[r].querySelector(`[data-key="${key}"]`);
const errorOf = (g, r, key) => cell(g, r, key).closest("td").querySelector(".om-entry-error");
const posted = (form) => [...new FormData(form)].map(([k, v]) => [k, String(v)]);
const messages = (g) => [...g.querySelectorAll(".om-entry-messages li")].map((li) => li.textContent);

function type(input, value) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function commit(input, value) {
  if (value !== undefined) type(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function key(target, k, extra = {}) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(e);
  return e;
}
function paste(target, text) {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const e = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

// ── The rules, apart from the element ───────────────────────────────────────

test("a decimal is checked as a string: its form, its places and its bounds, exactly", () => {
  const col = normaliseEntryColumn({ key: "cost", type: "decimal", places: 2, min: "0", max: "1000000000000000000.01" });
  assert.deepEqual(checkEntryValue(col, " 1500.50 "), { value: "1500.50", empty: false, message: null });
  assert.equal(checkEntryValue(col, "1500.500").message, null, "a trailing zero is not a place: the value is exact");
  assert.equal(checkEntryValue(col, "1.005").message, "At most 2 decimal places");
  assert.equal(checkEntryValue(col, "1,500.5").message, "Write it without grouping commas, like 1234.5");
  for (const bad of ["1e3", "12abc", ".5", "1.", "--1", "NaN", "0x10"]) assert.equal(checkEntryValue(col, bad).message, "Not a number: write it like 1234.5", bad);
  assert.equal(checkEntryValue(col, "-0.01").message, "At least 0");
  assert.equal(checkEntryValue(col, "1000000000000000000.01").message, null, "a bound past a float's precision, held exactly");
  assert.equal(checkEntryValue(col, "1000000000000000000.02").message, "At most 1000000000000000000.01");
  assert.deepEqual(checkEntryValue(col, "  "), { value: "", empty: true, message: null }, "empty is the row's question, not a message");
  const whole = normaliseEntryColumn({ key: "n", type: "decimal", places: 0 });
  assert.equal(checkEntryValue(whole, "3.5").message, "A whole number, with no decimal places");
});

test("a date is a day in the calendar, YYYY-MM-DD, within its bounds; a code is in capitals; a choice its option's value", () => {
  const date = normaliseEntryColumn({ key: "d", type: "date", min: "2026-01-01", max: "2026-09-30" });
  assert.equal(checkEntryValue(date, "2026-02-28").message, null);
  assert.equal(checkEntryValue(date, "2026-02-30").message, "Not a day in the calendar");
  assert.equal(checkEntryValue(date, "02/03/2026").message, "Not a date: write it as YYYY-MM-DD");
  assert.equal(checkEntryValue(date, "2025-12-31").message, "On or after 2026-01-01");
  assert.equal(checkEntryValue(date, "2026-10-01").message, "On or before 2026-09-30");
  const code = normaliseEntryColumn({ key: "c", type: "code", length: 3 });
  assert.deepEqual(checkEntryValue(code, " usd "), { value: "USD", empty: false, message: null });
  assert.equal(checkEntryValue(code, "US").message, "Exactly 3 characters");
  assert.equal(checkEntryValue(code, "U$D").message, "Letters and digits only, like USD");
  const choice = normaliseEntryColumn({ key: "m", type: "choice", options: [{ value: "fifo", label: "First in, first out" }, "spec"] });
  assert.equal(checkEntryValue(choice, "FIFO").value, "fifo");
  assert.equal(checkEntryValue(choice, "first in, first out").value, "fifo", "by its label too");
  assert.equal(checkEntryValue(choice, "lifo").message, "Not one of the choices");
  const text = normaliseEntryColumn({ key: "t", max_length: 3 });
  assert.equal(checkEntryValue(text, "abcd").message, "At most 3 characters");
  assert.equal(checkEntryValue(text, "ééé").message, null, "characters, not bytes");
});

test("a column the grid cannot use is refused, never guessed", () => {
  for (const bad of [{}, { key: "a b" }, { key: "a", type: "number" }, { key: "a", path: "x..y" }, { key: "a", type: "decimal", min: "1,0" },
    { key: "a", type: "decimal", places: -1 }, { key: "a", type: "date", max: "2026-13-01" }, { key: "a", type: "choice" }, { key: "a", type: "text", max_length: 0 }]) {
    assert.throws(() => normaliseEntryColumn(bad), TypeError, JSON.stringify(bad));
  }
  const col = normaliseEntryColumn({ key: "cost", type: "decimal", path: "terms.cost", required: true });
  assert.equal(col.label, "cost");
  assert.equal(col.path, "terms.cost");
  assert.equal(normaliseEntryColumn({ key: "id", type: "readonly", required: true }).required, false, "a read-only column is never required of a person");
  assert.equal(describeColumn(normaliseEntryColumn(COLUMNS[1])), "a number; at most 2 decimal places; at least 0");
  assert.equal(describeColumn(normaliseEntryColumn(COLUMNS[2])), "required; a code of 3 characters");
});

test("a path names the table, a row or a cell, in the data dictionary's grammar", () => {
  assert.ok(isPath("positions[0].lots[2].terms.cost"));
  for (const bad of ["", "lots[]", "lots[a]", "lots.", ".lots", "lots[0]x", "lots[0]..cost"]) assert.equal(isPath(bad), false, bad);
  assert.deepEqual(locatePath("lots", "lots"), { at: "table" });
  assert.deepEqual(locatePath("lots", "lots[2]"), { at: "row", index: 2 });
  assert.deepEqual(locatePath("lots", "lots[2].terms.cost"), { at: "cell", index: 2, field: "terms.cost" });
  assert.deepEqual(locatePath("positions[0].lots", "positions[0].lots[1].quantity"), { at: "cell", index: 1, field: "quantity" });
  assert.equal(locatePath("positions[0].lots", "positions[1].lots[1].quantity"), null, "another position's lots");
  assert.equal(locatePath("lots", "lots_extra[0].a"), null);
  assert.equal(locatePath("lots", "lotsx"), null);
  const cols = COLUMNS.map(normaliseEntryColumn);
  assert.equal(columnForField(cols, "terms.cost").key, "cost");
  assert.equal(columnForField(cols, "terms.cost.units").key, "cost", "a field under a column's path is that column's");
  assert.equal(columnForField(cols, "terms"), null);
});

test("cells are read as a spreadsheet writes them: quotes, line breaks inside, CRLF and a byte-order mark", () => {
  assert.deepEqual(parseDelimited("a,b\r\n1,\"2,5\"\r\n\"x \"\"y\"\"\",\"two\nlines\"\r\n"), [["a", "b"], ["1", "2,5"], ['x "y"', "two\nlines"]]);
  assert.deepEqual(parseDelimited("\uFEFFq\tc\n10\t5 \" in\n", "\t"), [["q", "c"], ["10", '5 " in']], "a quote inside a cell is the cell's");
  assert.deepEqual(parseDelimited("a,,c\n,\n"), [["a", "", "c"], ["", ""]]);
  assert.deepEqual(parseDelimited("only"), [["only"]]);
  assert.equal(sniffDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(sniffDelimiter("a\tb\n1,2,3,4"), "\t", "the header line decides");
  assert.equal(sniffDelimiter('"a,b";c;d'), ";", "not inside quotes");
  const cols = COLUMNS.map(normaliseEntryColumn);
  assert.deepEqual(matchHeaders(["Qty", "COST", "terms.cost", "Acquired On", "lot id", "Source"], cols), {
    quantity: -1, cost: 1, currency: -1, acquired: -1, method: -1, source: 5, lot_id: 4,
  });
});

test("decimals add up exactly, never through a float", () => {
  assert.equal(addDecimals(["0.1", "0.2"]), "0.3");
  assert.equal(addDecimals(["10", "-2.50", "", "x", "0.005"]), "7.505");
  assert.equal(addDecimals(["9007199254740993", "1"]), "9007199254740994");
  assert.equal(addDecimals(["-1.5", "1.5"]), "0");
  assert.equal(addDecimals([]), "0");
  assert.equal(addDecimals(["-0.25"]), "-0.25");
});

// ── The table ────────────────────────────────────────────────────────────────

test("a real table of typed inputs, each labelled, named by its path, in the page's form", async () => {
  const g = await grid(undefined, 'name="lots" caption="Lots"', '<div class="table-wrap"><table id="fallback"><tr><td>Without the kit</td></tr></table></div>');
  assert.equal(g.querySelector("#fallback"), null, "the page's own table is replaced, not joined");
  assert.equal(g.querySelector("caption").textContent, "Lots");
  const heads = [...g.querySelectorAll("thead th")].map((th) => th.textContent);
  assert.deepEqual(heads, ["Row", "Quantity * (required)Signed as the position is", "Cost", "Currency * (required)", "Acquired", "Method", "Source", "Lot", "Remove"]);
  assert.ok([...g.querySelectorAll("thead th")].every((th) => th.scope === "col"));
  assert.equal(rowsOf(g)[1].querySelector("th").scope, "row");
  assert.equal(rowsOf(g)[1].querySelector("th").textContent, "2");
  const q = cell(g, 0, "quantity");
  assert.equal(q.getAttribute("aria-label"), "Quantity, row 1");
  assert.equal(q.getAttribute("aria-required"), "true");
  assert.equal(q.getAttribute("inputmode"), "decimal");
  assert.equal(q.getAttribute("aria-describedby"), `${g.querySelector("thead th:nth-child(2) .hint").id}`, "its column's hint describes it");
  assert.equal(cell(g, 0, "method").localName, "select");
  assert.equal(cell(g, 0, "method").value, "fifo");
  assert.equal(cell(g, 0, "lot_id").type, "hidden", "a read-only value is shown as text and posted");
  assert.equal(rowsOf(g)[0].querySelector(".om-entry-ro").textContent, "L-1");
  assert.deepEqual(posted(g.closest("form")), [
    ["csrf", "t0ken"],
    ["lots[0].quantity", "10"], ["lots[0].terms.cost", "1500.00"], ["lots[0].currency", "USD"], ["lots[0].acquired", "2026-01-02"], ["lots[0].method", "fifo"], ["lots[0].source", "statement"], ["lots[0].lot_id", "L-1"],
    ["lots[1].quantity", "5"], ["lots[1].terms.cost", "760.5"], ["lots[1].currency", "USD"], ["lots[1].acquired", "2026-03-04"], ["lots[1].method", "spec"], ["lots[1].source", "statement"], ["lots[1].lot_id", "L-2"],
  ]);
  assert.deepEqual(g.rows[1], { quantity: "5", cost: "760.5", currency: "USD", acquired: "2026-03-04", method: "spec", source: "statement", lot_id: "L-2" });
});

test("a row with nothing typed in it is blank: not posted, not checked; the rows posted are numbered without it", async () => {
  const g = await grid({ columns: COLUMNS, rows: [ROWS[0], {}, ROWS[1]] });
  assert.equal(rowsOf(g).length, 3);
  assert.equal(cell(g, 1, "currency").value, "USD", "a new row holds its column's default");
  assert.equal(cell(g, 1, "quantity").hasAttribute("name"), false);
  assert.equal(cell(g, 2, "quantity").getAttribute("name"), "lots[1].quantity", "the third row shown is the second posted");
  assert.equal(cell(g, 1, "quantity").validity.valid, true, "a blank row's required cells hold nothing");
  assert.equal(g.closest("form").checkValidity(), true);
  type(cell(g, 1, "source"), "typed");
  assert.equal(cell(g, 1, "quantity").getAttribute("name"), "lots[1].quantity", "typed in: it is posted");
  assert.equal(cell(g, 2, "quantity").getAttribute("name"), "lots[2].quantity");
  assert.equal(cell(g, 1, "quantity").validity.valid, false, "and its required cells are now asked for");
  assert.equal(g.rows.length, 3);
});

test("a grid with no rows given starts with one blank row; min-rows pads to the minimum", async () => {
  const one = await grid({ columns: COLUMNS });
  assert.equal(rowsOf(one).length, 1);
  assert.equal(posted(one.closest("form")).length, 1, "only the token: nothing typed");
  const three = await grid({ columns: COLUMNS, rows: [ROWS[0]] }, 'name="lots" min-rows="3"');
  assert.equal(rowsOf(three).length, 3);
  assert.ok(rowsOf(three).every((tr) => tr.querySelector(".om-entry-remove").disabled), "at the minimum no row may be removed");
});

test("JSON a grid cannot use keeps the page's own table, which still posts", async () => {
  const errors = [];
  document.addEventListener("om-error", (e) => errors.push(e.detail.error), { once: true });
  const g = await grid({ columns: [{ key: "q", type: "number" }] }, 'name="lots"', '<table id="fallback"><tr><td><input name="lots[0].q" value="1"></td></tr></table>');
  assert.ok(g.querySelector("#fallback"));
  assert.match(errors[0], /a type the grid does not know: "number"/);
  assert.deepEqual(posted(g.closest("form")), [["csrf", "t0ken"], ["lots[0].q", "1"]]);
  const none = await grid({}, 'name="lots"', '<table id="fallback"></table>');
  assert.ok(none.querySelector("#fallback"), "no columns at all: the page's table stays");
});

test("what was typed into the page's table before the kit came is kept", async () => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  let g;
  try {
    const form = document.createElement("form");
    g = document.createElement("om-entry-grid");
    g.setAttribute("name", "lots");
    form.append(g);
    document.body.append(form);
    await settle();
    g.innerHTML = `${json({ columns: COLUMNS, rows: [ROWS[0]] })}<table><tr><td><input name="lots[0].quantity" value="10"></td><td><input name="lots[0].source" value="statement"></td></tr></table>`;
    g.querySelector('[name="lots[0].source"]').value = "typed early";
  } finally {
    delete document.readyState;
  }
  document.dispatchEvent(new Event("DOMContentLoaded"));
  assert.equal(cell(g, 0, "source").value, "typed early");
  assert.equal(cell(g, 0, "quantity").value, "10");
});

// ── Rows added and removed ───────────────────────────────────────────────────

test("Add a row, and Remove a row: between min-rows and max-rows, renumbered, the keyboard kept in the grid", async () => {
  const g = await grid(undefined, 'name="lots" min-rows="1" max-rows="3"');
  const changes = [];
  g.addEventListener("om-change", (e) => changes.push(e.detail.rows.length));
  const add = g.querySelector(".om-entry-add");
  add.click();
  assert.equal(rowsOf(g).length, 3);
  assert.equal(document.activeElement, cell(g, 2, "quantity"), "the new row's first cell");
  assert.equal(add.disabled, true, "at max-rows");
  assert.equal(g.addRow(), -1);
  assert.match(g.querySelector(".om-entry-live").textContent, /Row 3 added/);
  rowsOf(g)[0].querySelector(".om-entry-remove").click();
  assert.equal(rowsOf(g).length, 2);
  assert.equal(rowsOf(g)[0].querySelector("th").textContent, "1");
  assert.equal(cell(g, 0, "quantity").value, "5", "the second row is now the first");
  assert.equal(cell(g, 0, "quantity").getAttribute("name"), "lots[0].quantity");
  assert.equal(cell(g, 0, "quantity").getAttribute("aria-label"), "Quantity, row 1");
  assert.equal(rowsOf(g)[0].querySelector(".om-entry-remove").getAttribute("aria-label"), "Remove row 1");
  assert.equal(document.activeElement, rowsOf(g)[0].querySelector(".om-entry-remove"));
  assert.equal(add.disabled, false);
  rowsOf(g)[0].querySelector(".om-entry-remove").click();
  assert.equal(rowsOf(g).length, 1);
  assert.equal(rowsOf(g)[0].querySelector(".om-entry-remove").disabled, true, "at min-rows");
  assert.equal(g.removeRow(0), false);
  assert.deepEqual(changes, [2, 1, 0], "om-change after each, with the rows as posted");
});

test("removing every row shows the grid's empty words", async () => {
  const g = await grid({ columns: COLUMNS, rows: [ROWS[0]] }, 'name="lots" empty="No lots yet."');
  g.removeRow(0);
  assert.equal(g.querySelector("tr.om-entry-empty").textContent, "No lots yet.");
  g.addRow({ quantity: "1" });
  assert.equal(g.querySelector("tr.om-entry-empty"), null);
  assert.equal(cell(g, 0, "quantity").value, "1");
});

test("the keyboard: arrows between cells, Enter down a row and a row added on the last, never the form's submit", async () => {
  const g = await grid();
  const form = g.closest("form");
  let sent = 0;
  form.addEventListener("submit", (e) => (sent++, e.preventDefault()));
  const q0 = cell(g, 0, "quantity");
  q0.focus();
  assert.ok(key(q0, "ArrowDown").defaultPrevented);
  assert.equal(document.activeElement, cell(g, 1, "quantity"));
  key(cell(g, 1, "quantity"), "ArrowUp");
  assert.equal(document.activeElement, q0);
  q0.setSelectionRange(q0.value.length, q0.value.length);
  key(q0, "ArrowRight");
  assert.equal(document.activeElement, cell(g, 0, "cost"), "at the end of its text, right is the next cell");
  const cost = cell(g, 0, "cost");
  cost.setSelectionRange(1, 1);
  assert.equal(key(cost, "ArrowLeft").defaultPrevented, false, "inside the text, the caret moves");
  cost.setSelectionRange(0, 0);
  key(cost, "ArrowLeft");
  assert.equal(document.activeElement, q0);
  assert.equal(key(cell(g, 0, "method"), "ArrowDown").defaultPrevented, false, "a choice keeps its own arrows");
  assert.ok(key(q0, "Enter").defaultPrevented);
  assert.equal(document.activeElement, cell(g, 1, "quantity"), "Enter goes down a row");
  key(cell(g, 1, "quantity"), "Enter");
  assert.equal(rowsOf(g).length, 3, "on the last row, a row is added at the end");
  assert.equal(document.activeElement, cell(g, 2, "quantity"));
  key(cell(g, 2, "quantity"), "Enter");
  assert.equal(rowsOf(g).length, 3, "not another under a blank one");
  key(cell(g, 2, "quantity"), "Enter", { shiftKey: true });
  assert.equal(document.activeElement, cell(g, 1, "quantity"), "Shift+Enter goes up");
  assert.equal(sent, 0);
});

// ── Checked as it is typed ───────────────────────────────────────────────────

test("each cell is checked as it is typed, its message on the cell and said once", async () => {
  const g = await grid();
  const cost = cell(g, 0, "cost");
  type(cost, "1,500");
  const err = errorOf(g, 0, "cost");
  assert.equal(err.textContent, "Write it without grouping commas, like 1234.5");
  assert.equal(err.hidden, false);
  assert.equal(cost.getAttribute("aria-invalid"), "true");
  assert.match(cost.getAttribute("aria-describedby"), new RegExp(err.id));
  assert.equal(cost.validationMessage, "Write it without grouping commas, like 1234.5", "the form will not send it");
  assert.equal(g.querySelector(".om-entry-live").textContent, "Cost, row 1: Write it without grouping commas, like 1234.5");
  type(cost, "1500.123");
  assert.equal(err.textContent, "At most 2 decimal places");
  type(cost, "1500.12");
  assert.equal(err.hidden, true);
  assert.equal(cost.hasAttribute("aria-invalid"), false);
  assert.equal(cost.getAttribute("aria-describedby"), null);
  assert.equal(g.closest("form").checkValidity(), true);
  type(cell(g, 0, "acquired"), "2026-10-01");
  assert.equal(errorOf(g, 0, "acquired").textContent, "On or before 2026-09-30");
  type(cell(g, 0, "source"), "x".repeat(21));
  assert.equal(errorOf(g, 0, "source").textContent, "At most 20 characters");
});

test("a committed value is shown as it posts: trimmed, a code in capitals", async () => {
  const g = await grid();
  commit(cell(g, 0, "currency"), " eur ");
  assert.equal(cell(g, 0, "currency").value, "EUR");
  commit(cell(g, 0, "quantity"), " 12 ");
  assert.equal(cell(g, 0, "quantity").value, "12");
  commit(cell(g, 0, "cost"), " 1,2 ");
  assert.equal(cell(g, 0, "cost").value, " 1,2 ", "a bad value is left as typed, to be fixed");
});

test("a required cell says so once its row is left, or at once when it is emptied", async () => {
  const g = await grid({ columns: COLUMNS, rows: [ROWS[0], {}] });
  const source = cell(g, 1, "source");
  type(source, "typed");
  assert.equal(errorOf(g, 1, "quantity").hidden, true, "not while the row is being filled");
  assert.equal(cell(g, 1, "quantity").validity.valid, false, "but it holds the submit");
  source.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: cell(g, 1, "cost") }));
  assert.equal(errorOf(g, 1, "quantity").hidden, true, "still in the row");
  source.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: g.querySelector(".om-entry-add") }));
  assert.equal(errorOf(g, 1, "quantity").textContent, "Required");
  type(cell(g, 0, "quantity"), "");
  assert.equal(errorOf(g, 0, "quantity").textContent, "Required", "emptied: said at once");
});

test("a submit with a problem is held: every problem shown, the keyboard to the first; formnovalidate still sends", async () => {
  const g = await grid({ columns: COLUMNS, rows: [ROWS[0], { source: "half typed" }] });
  const form = g.closest("form");
  let sent = 0;
  form.addEventListener("submit", (e) => (sent++, e.preventDefault()));
  form.requestSubmit();
  assert.equal(sent, 0);
  assert.equal(errorOf(g, 1, "quantity").textContent, "Required");
  assert.equal(document.activeElement, cell(g, 1, "quantity"));
  assert.match(g.querySelector(".om-entry-live").textContent, /Not sent: 1 cell to fix/);
  const draft = document.createElement("button");
  draft.formNoValidate = true;
  form.append(draft);
  form.requestSubmit(draft);
  assert.equal(sent, 1, "a draft posts as it stands");
  commit(cell(g, 1, "quantity"), "5");
  form.requestSubmit();
  assert.equal(sent, 2);
  assert.equal(g.checkValidity(), true);
});

test("a choice given a value it does not offer keeps it, saying so, until a choice is made", async () => {
  const g = await grid({ columns: COLUMNS, rows: [{ ...ROWS[0], method: "lifo" }] });
  const method = cell(g, 0, "method");
  assert.equal(method.value, "lifo");
  assert.equal(method.querySelector("option[data-om-unknown]").textContent, "lifo (not a choice)");
  g.reportValidity();
  assert.equal(errorOf(g, 0, "method").textContent, "Not one of the choices");
  method.value = "spec";
  method.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(method.querySelector("option[data-om-unknown]"), null);
  assert.equal(errorOf(g, 0, "method").hidden, true);
});

// ── The server's word, by path ───────────────────────────────────────────────

test("the server's messages are placed by path: a cell, a row, the table; one past the rows over the table", async () => {
  const g = await grid({
    columns: COLUMNS,
    rows: ROWS,
    errors: [
      { path: "lots[1].terms.cost", message: "A cost is the lot's in all, not a price." },
      { path: "lots[0]", message: "This lot is already recorded." },
      { path: "lots", message: "Lots add up to 15; the position is 20." },
      { path: "lots[7].quantity", message: "Unknown lot." },
      { message: "Checked against the statement of 2026-09-30." },
      { path: "positions[0].pending", message: "Not this grid's, but the page put it here." },
    ],
  });
  assert.equal(errorOf(g, 1, "cost").textContent, "A cost is the lot's in all, not a price.");
  assert.equal(cell(g, 1, "cost").getAttribute("aria-invalid"), "true");
  assert.equal(cell(g, 1, "cost").validity.valid, true, "the server's word does not hold a resubmit");
  const rowMsg = g.querySelectorAll("tr.om-entry-row-message")[0];
  assert.equal(rowMsg.hidden, false);
  assert.equal(rowMsg.textContent, "This lot is already recorded.");
  assert.match(cell(g, 0, "quantity").getAttribute("aria-describedby"), new RegExp(rowMsg.firstChild.id), "the row's message describes each of its cells");
  assert.deepEqual(messages(g), ["Lots add up to 15; the position is 20.", "Row 8: Unknown lot.", "Checked against the statement of 2026-09-30.", "Not this grid's, but the page put it here."]);
  assert.equal(g.querySelector(".om-entry-messages").getAttribute("role"), "alert");
  // Changed: the cell's message goes, and the table's (the server will check again).
  type(cell(g, 1, "cost"), "760.50");
  assert.equal(errorOf(g, 1, "cost").hidden, true);
  assert.deepEqual(messages(g), []);
  assert.equal(rowMsg.hidden, false, "another row's message stays until that row changes");
  type(cell(g, 0, "source"), "corrected");
  assert.equal(rowMsg.hidden, true);
});

test("setErrors places what is inside the grid, by the row's index as posted, and hands back the rest", async () => {
  const g = await grid({ columns: COLUMNS, rows: [ROWS[0], {}, ROWS[1]] });
  const rest = g.setErrors([
    { path: "lots[1].quantity", message: "Signed as the position is." },
    { path: "lots[0].terms.cost.units", message: "Too precise." },
    { path: "positions[0].pending", message: "Elsewhere." },
    { path: "lots[1].lot_id", message: "Not yours." },
  ]);
  assert.deepEqual(rest, [{ path: "positions[0].pending", message: "Elsewhere." }]);
  assert.equal(errorOf(g, 2, "quantity").textContent, "Signed as the position is.", "posted second, shown third");
  assert.equal(errorOf(g, 0, "cost").textContent, "Too precise.", "a field under a column's path");
  assert.equal(g.querySelectorAll("tr.om-entry-row-message")[2].textContent, "Not yours.", "a read-only cell's message goes on its row");
  assert.match(g.querySelector(".om-entry-live").textContent, /3 problems to look at in Lots/);
  g.clearErrors();
  assert.equal(errorOf(g, 2, "quantity").hidden, true);
});

test("a grid under a path: its names and its messages are under that path", async () => {
  const g = await grid({ columns: COLUMNS.slice(0, 2), rows: [{ quantity: "1", cost: "2" }], errors: [{ path: "positions[3].lots[0].terms.cost", message: "No." }] }, 'name="positions[3].lots"');
  assert.equal(cell(g, 0, "cost").getAttribute("name"), "positions[3].lots[0].terms.cost");
  assert.equal(errorOf(g, 0, "cost").textContent, "No.");
});

// ── Rules over the rows ──────────────────────────────────────────────────────

test("a declared sum is checked exactly, its words over the table once a value is committed", async () => {
  const g = await grid({ columns: COLUMNS, rows: ROWS, rules: [{ sum: "quantity", equals: "15.5", message: "Lots add up to {sum}; the position is {equals}." }] });
  assert.deepEqual(messages(g), ["Lots add up to 15; the position is 15.5."]);
  type(cell(g, 1, "quantity"), "5.4");
  assert.deepEqual(messages(g), ["Lots add up to 15; the position is 15.5."], "not under every key");
  commit(cell(g, 1, "quantity"), "5.5");
  assert.deepEqual(messages(g), []);
  commit(cell(g, 1, "quantity"), "5.50000000000000000001");
  assert.deepEqual(messages(g), ["Lots add up to 15.50000000000000000001; the position is 15.5."], "exact past a float's precision");
});

test("a page's rule may name a cell or a row; its message holds the submit as a cell's own does", async () => {
  const g = await grid();
  const off = g.addRule((rows) => rows.map((r, i) => (r.method === "spec" && !r.source.startsWith("lot") ? { path: `[${i}].source`, message: "Name the lot specified." } : null)));
  assert.equal(errorOf(g, 1, "source").textContent, "Name the lot specified.");
  assert.equal(cell(g, 1, "source").validity.valid, false);
  commit(cell(g, 1, "source"), "lot 7");
  assert.equal(errorOf(g, 1, "source").hidden, true);
  g.addRule(() => [{ path: "lots[0]", message: "Acquired before the account opened." }, "And something about them all."]);
  assert.equal(g.querySelectorAll("tr.om-entry-row-message")[0].textContent, "Acquired before the account opened.");
  assert.deepEqual(messages(g), ["And something about them all."]);
  off();
  commit(cell(g, 1, "source"), "statement");
  assert.equal(errorOf(g, 1, "source").hidden, true, "the rule removed");
  const errors = [];
  g.addEventListener("om-error", (e) => errors.push(e.detail.error));
  g.addRule(() => {
    throw new Error("boom");
  });
  assert.match(errors[0], /a rule threw: boom/);
});

test("a declared rule the grid cannot use is reported, not guessed", async () => {
  const errors = [];
  document.addEventListener("om-error", (e) => errors.push(e.detail.error));
  await grid({ columns: COLUMNS, rows: ROWS, rules: [{ sum: "source", equals: "1" }, { sum: "quantity", equals: "a lot" }] });
  assert.equal(errors.length, 2);
});

// ── Paste from a spreadsheet ─────────────────────────────────────────────────

test("cells pasted from a spreadsheet fill across and down from the cell pasted into, adding rows, each checked", async () => {
  const g = await grid({ columns: COLUMNS, rows: [ROWS[0]] });
  const e = paste(cell(g, 0, "cost"), "100.00\teur\t2026-02-01\r\n200.555\tUSD\t2026-02-30\r\n300\tgbp\t2026-02-03\r\n");
  assert.ok(e.defaultPrevented);
  assert.equal(rowsOf(g).length, 3);
  assert.deepEqual([0, 1, 2].map((r) => [cell(g, r, "cost").value, cell(g, r, "currency").value, cell(g, r, "acquired").value]), [
    ["100.00", "EUR", "2026-02-01"],
    ["200.555", "USD", "2026-02-30"],
    ["300", "GBP", "2026-02-03"],
  ]);
  assert.equal(cell(g, 0, "quantity").value, "10", "the cells before it are as they were");
  assert.equal(errorOf(g, 1, "cost").textContent, "At most 2 decimal places");
  assert.equal(errorOf(g, 1, "acquired").textContent, "Not a day in the calendar");
  assert.equal(errorOf(g, 1, "quantity").textContent, "Required", "a pasted row asks for its required cells");
  assert.equal(g.querySelector(".om-entry-note").textContent, "Pasted 3 rows. 4 cells to fix.");
  assert.equal(cell(g, 2, "cost").getAttribute("name"), "lots[2].terms.cost");
});

test("a paste skips read-only columns, leaves out what is past the last column and past max-rows, and says so", async () => {
  const cols = [{ key: "a", label: "A" }, { key: "id", label: "ID", type: "readonly" }, { key: "b", label: "B" }];
  const g = await grid({ columns: cols, rows: [{ a: "1", id: "X", b: "2" }] }, 'name="r" max-rows="2"');
  paste(cell(g, 0, "a"), "p\tq\tr\ts\nt\tu\nv\tw\n");
  assert.equal(cell(g, 0, "a").value, "p");
  assert.equal(cell(g, 0, "b").value, "q", "the read-only column between is not typed into");
  assert.equal(rowsOf(g)[0].querySelector(".om-entry-ro").textContent, "X");
  assert.equal(rowsOf(g).length, 2);
  assert.equal(g.querySelector(".om-entry-note").textContent, "Pasted 2 rows. 1 row past the 2 this table holds left out. 2 columns past B left out.");
});

test("one value pasted is the browser's own paste; a quoted cell may hold a line break", async () => {
  const g = await grid();
  assert.equal(paste(cell(g, 0, "source"), "just this").defaultPrevented, false);
  assert.equal(paste(cell(g, 0, "source"), "just this\n").defaultPrevented, false, "a copied cell's line end is still one value");
  paste(cell(g, 0, "source"), '"two\nlines"\tx\nnext\n');
  assert.equal(cell(g, 0, "source").value, "two lines", "a cell is one line");
  assert.equal(cell(g, 1, "source").value, "next");
});

// ── CSV, in a dialog ─────────────────────────────────────────────────────────

const dialogOf = (g) => g.querySelector("dialog.om-entry-dialog");
async function readCsv(g, text) {
  g.querySelector(".om-entry-csv").click();
  const d = dialogOf(g);
  d.querySelector(".om-entry-paste").value = text;
  d.querySelector(".om-entry-go").click();
  await settle();
  return d;
}

test("a CSV is a link opening a dialog, offered only where the page asks for it, saying what the table takes", async () => {
  const plain = await grid();
  assert.equal(plain.querySelector(".om-entry-csv").hidden, true);
  const g = await grid(undefined, 'name="lots" csv');
  const link = g.querySelector(".om-entry-csv");
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute("aria-haspopup"), "dialog");
  link.click();
  const d = dialogOf(g);
  assert.equal(d.open, true);
  assert.equal(d.getAttribute("aria-labelledby"), d.querySelector("h2").id);
  assert.match(d.querySelector(".om-entry-takes").textContent, /Cost: a number; at most 2 decimal places; at least 0/);
  assert.doesNotMatch(d.querySelector(".om-entry-takes").textContent, /Lot:/, "a read-only column is not imported");
  assert.equal([...d.querySelectorAll("input, select, textarea")].filter((c) => c.name).length, 0, "nothing of the dialog's is posted with the page's form");
  d.querySelector(".om-entry-go").click();
  await settle();
  assert.equal(d.querySelector(".om-entry-problem").textContent, "Choose a file, or paste a CSV with a header row.");
  d.querySelector(".om-entry-cancel").click();
  assert.equal(d.open, false);
});

test("headers that differ are mapped by hand; every row previewed with its problems; nothing applied until Apply", async () => {
  const g = await grid(undefined, 'name="lots" csv');
  const before = posted(g.closest("form"));
  const d = await readCsv(g, "Qty;Cost;Ccy;Acquired;Notes\n7;700.00;usd;2026-04-01;broker\n8;80.123;usd;2026-04-31;\n;;;;\n9;;;2026-04-03;x\n");
  assert.equal(d.querySelector(".om-entry-map").open, true, "a header did not match: the mapping is open");
  assert.match(d.querySelector(".om-entry-map summary").textContent, /2 of 6 matched by header/);
  const select = (k) => d.querySelector(`.om-entry-map-fields select[data-key="${k}"]`);
  assert.equal(select("cost").value, "1");
  assert.equal(select("quantity").value, "-1");
  select("quantity").value = "0";
  select("quantity").dispatchEvent(new Event("change", { bubbles: true }));
  select("currency").value = "2";
  select("currency").dispatchEvent(new Event("change", { bubbles: true }));
  select("source").value = "4";
  select("source").dispatchEvent(new Event("change", { bubbles: true }));
  const preview = d.querySelector(".om-entry-preview table");
  assert.equal(preview.querySelectorAll("tbody tr").length, 3, "the blank line is no row");
  const bad = [...preview.querySelectorAll("td[data-invalid] .om-entry-error")].map((s) => s.textContent);
  assert.deepEqual(bad, ["At most 2 decimal places", "Not a day in the calendar", "Required"]);
  assert.equal(d.querySelector(".om-entry-preview-said").textContent, "3 rows to apply. 3 cells to fix, in rows 2 and 3: they can be fixed in the table once applied.");
  assert.equal(d.querySelector(".om-entry-go").textContent, "Apply 3 rows");
  assert.deepEqual(posted(g.closest("form")), before, "nothing applied yet");
  assert.equal(d.querySelector(".om-entry-mode").hidden, false, "the table has rows: replace them or add to them");
  d.querySelector(".om-entry-mode select").value = "replace";
  d.querySelector(".om-entry-go").click();
  assert.equal(d.open, false);
  assert.equal(rowsOf(g).length, 3);
  assert.deepEqual(g.rows.map((r) => [r.quantity, r.cost, r.currency, r.method, r.source]), [["7", "700.00", "USD", "", "broker"], ["8", "80.123", "USD", "", ""], ["9", "", "", "", "x"]]);
  assert.equal(errorOf(g, 1, "cost").textContent, "At most 2 decimal places", "each problem on its cell, to fix there");
  assert.equal(errorOf(g, 2, "currency").textContent, "Required", "an empty cell in a column the CSV has is empty, not the default");
});

test("a CSV whose headers all match goes straight to its preview; Add puts its rows after the table's", async () => {
  const g = await grid({ columns: COLUMNS.slice(0, 3), rows: [{ quantity: "1", cost: "1", currency: "USD" }, {}] }, 'name="lots" csv');
  const d = await readCsv(g, "quantity,terms.cost,Currency\n2,20,EUR\n");
  assert.equal(d.querySelector(".om-entry-map").open, false);
  assert.equal(d.querySelector(".om-entry-map summary").textContent, "Columns: each matched by its header");
  assert.equal(d.querySelector(".om-entry-mode select").value, "add", "a table with rows: added to, by default");
  d.querySelector(".om-entry-go").click();
  assert.deepEqual(g.rows.map((r) => r.quantity), ["1", "2"], "the blank row at the end made way");
  assert.equal(document.activeElement, cell(g, 1, "quantity"));
  assert.match(g.querySelector(".om-entry-note").textContent, /Imported 1 row/);
});

test("a CSV with a header and nothing under it says so", async () => {
  const g = await grid(undefined, 'name="lots" csv');
  const d = await readCsv(g, "quantity,cost\n\n");
  assert.equal(d.querySelector(".om-entry-problem").textContent, "It has a header row and no rows under it.");
  assert.equal(d.querySelector(".om-entry-step-map").hidden, true);
});

// ── Where the kit is not served ──────────────────────────────────────────────

test("without the kit's script, the page's own table of inputs is a form that posts the same names", async () => {
  const block = read("src/gallery/patterns.html").match(/<!-- pattern: entry-grid -->\n([\s\S]*?)\n<!-- \/pattern -->/)[1];
  // A window with no custom elements of the kit's: what a browser does without its script.
  const win = new Window({ url: "https://plugin.example/opening/complete", settings: SETTINGS });
  win.document.body.innerHTML = block;
  const form = win.document.querySelector("form");
  const without = [...new win.FormData(form)].map(([k, v]) => [k, String(v)]);
  assert.deepEqual(without.map(([k]) => k), [
    "csrf",
    "lots[0].quantity", "lots[0].terms.cost", "lots[0].acquired",
    "lots[1].quantity", "lots[1].terms.cost", "lots[1].acquired",
    "lots[2].quantity", "lots[2].terms.cost", "lots[2].acquired",
  ]);
  for (const input of win.document.querySelectorAll("om-entry-grid table input")) assert.ok(input.getAttribute("aria-label"), `${input.name} is labelled`);
  // With it, the kit's table posts the same names and values for the rows
  // typed, and leaves out the blank row the page offered for one more.
  put(block);
  await settle();
  const g = document.querySelector("om-entry-grid");
  assert.deepEqual(posted(g.closest("form")), without.filter(([k]) => !k.startsWith("lots[2]")));
  assert.equal(errorOf(g, 1, "acquired").textContent, "Acquired after the opening day, 2026-09-30.", "the server's word, from the JSON");
  assert.deepEqual(messages(g), ["Lots add up to 14; the position is 15."]);
});

// ── At a phone's width ───────────────────────────────────────────────────────


async function at(width, attrs = "") {
  const g = await grid(undefined, `name="lots" ${attrs}`);
  const win = new Window({ url: "https://plugin.example/opening", width, height: 900, settings: SETTINGS });
  const doc = win.document;
  const style = doc.createElement("style");
  style.textContent = CSS.replace(/@container\s+[a-z-]+\s*\(/g, "@media (");
  doc.head.append(style);
  doc.body.innerHTML = `<om-entry-grid ${attrs}>${g.innerHTML}</om-entry-grid>`;
  return (sel) => win.getComputedStyle(doc.querySelector(sel));
}

test("at a phone's width each row is a card, each input under its column's name; touch targets are 44px", async () => {
  const phone = await at(390);
  assert.equal(phone("table.om-entry").display, "block");
  assert.equal(phone("tbody tr[data-row]").display, "block");
  assert.equal(phone("tbody tr[data-row] td").display, "block");
  assert.equal(phone("thead").position, "absolute", "the head kept for a screen reader, out of sight");
  assert.equal(phone("tbody tr[data-row] td.om-entry-act").position, "absolute", "Remove at the card's corner");
  for (const sel of ["tbody input[type=text]", "tbody select", ".om-entry-remove", ".om-entry-add"]) assert.equal(phone(sel).minHeight, "44px", sel);
  const desk = await at(1200);
  assert.notEqual(desk("table.om-entry").display, "block");
  assert.equal(desk("tbody input[type=text]").minHeight, "44px", "a touch target at any width");
  const none = await at(390, 'narrow="none"');
  assert.notEqual(none("table.om-entry").display, "block", "narrow=none keeps the table, scrolling sideways");
});

test("the grid's CSS names only the scheme's properties, and its error ink is the danger colour", () => {
  const block = CSS.slice(CSS.indexOf("/* ── om-entry-grid"), CSS.indexOf("/* ── om-account-map"));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(block, /\.om-entry-error \{[^}]*color: var\(--danger\)/);
  for (const m of block.matchAll(/color: var\(--([a-z-]+)\)/g)) assert.ok(["danger", "ink", "ink-soft", "ink-faint", "accent"].includes(m[1]), m[1]);
});

test("om-entry-grid is defined, and form-associated", () => {
  const G = customElements.get("om-entry-grid");
  assert.ok(G);
  assert.equal(G.formAssociated, true);
});
