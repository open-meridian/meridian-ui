// <om-entry-grid>: rows a person types, a table of typed inputs, posted as
// part of the page's own form.
//
//   <form method="post" action="/opening/lots">
//     <input type="hidden" name="csrf" value="…">
//     <om-entry-grid name="lots" caption="Lots" min-rows="1" csv>
//       <script type="application/json">
//         { "columns": [{ "key": "quantity", "label": "Quantity", "type": "decimal", "required": true },
//                       { "key": "cost", "label": "Cost", "type": "decimal", "places": 2, "path": "terms.cost" },
//                       { "key": "currency", "label": "Currency", "type": "code", "length": 3 },
//                       { "key": "acquired", "label": "Acquired", "type": "date" }],
//           "rows": [{ "quantity": "10", "cost": "1500.00", "currency": "USD", "acquired": "2026-01-02" }],
//           "errors": [{ "path": "lots[0].terms.cost", "message": "…" }],
//           "rules": [{ "sum": "quantity", "equals": "15" }] }
//       </script>
//       …the same rows as a plain table of inputs, for a browser without the kit…
//     </om-entry-grid>
//     <button class="primary">Save</button>
//   </form>
//
// The product owner, 2026-10-03: data is entered in a table with typed
// column inputs, rows added as needed; a CSV is a secondary way in, because
// a CSV says no schema and cannot point at the one bad cell. So:
//
// - Each column is typed (lib/entry.js): text, decimal (exact, a string),
//   date (YYYY-MM-DD), code (a currency or an asset's code), choice, and
//   read-only. Each cell is checked as it is typed, its message on the cell
//   (aria-invalid, aria-describedby); a required cell, when the row is left.
// - Rows are added ("Add a row", or Enter on the last row) and removed, between
//   `min-rows` and `max-rows`.
// - Cells pasted from a spreadsheet fill across and down from the cell pasted
//   into, adding rows, each cell checked.
// - A CSV, uploaded or pasted, is read in a dialog: its headers matched to the
//   columns (and matched by hand where they differ), every row previewed with
//   each cell's problem, and nothing applied until Apply.
// - The server's word is mapped back to cells by path, in the data
//   dictionary's grammar (meridian-design spec/every-store-publishes-a-
//   versioned-data-dictionary.md): `lots[2].terms.cost` is a cell,
//   `lots[2]` a row, `lots` the table.
//
// Every input is a real input in the page's form, named by that same path
// (`lots[0].quantity`), so the form posts with its own token and no script of
// the grid's; a row with nothing typed in it is blank, and is neither checked
// nor posted. Without the kit, what the page puts inside the element (a plain
// table of the same inputs) is what posts.

import { declaredJson, whenParsed } from "../lib/declared.js";
import { addDecimals, compareDecimal, parseDecimal } from "../lib/decimal.js";
import {
  checkEntryValue,
  columnForField,
  isPath,
  locatePath,
  matchHeaders,
  matchOption,
  normaliseEntryColumn,
  parseDelimited,
  sniffDelimiter,
} from "../lib/entry.js";

let instances = 0;

/** The most rows a grid holds unless `max-rows` says otherwise. */
const MOST_ROWS = 1000;
/** The largest CSV the dialog reads. */
const MOST_CSV = 2 * 1024 * 1024;
/** Rows the CSV preview draws; every row is checked. */
const PREVIEWED = 200;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isBlankText = (v) => v === undefined || v === null || String(v).trim() === "";

function option(text, value) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What a column takes, in words: for the CSV dialog's list, so its schema is said. */
export function describeColumn(col) {
  const parts = [];
  switch (col.type) {
    case "decimal":
      parts.push(col.places === 0 ? "a whole number" : "a number");
      if (col.places) parts.push(`at most ${plural(col.places, "decimal place")}`);
      if (col.min !== undefined) parts.push(`at least ${col.min}`);
      if (col.max !== undefined) parts.push(`at most ${col.max}`);
      break;
    case "date":
      parts.push("a date, YYYY-MM-DD");
      if (col.min !== undefined) parts.push(`on or after ${col.min}`);
      if (col.max !== undefined) parts.push(`on or before ${col.max}`);
      break;
    case "code":
      parts.push(col.length ? `a code of ${plural(col.length, "character")}` : "a code, letters and digits");
      break;
    case "choice":
      parts.push(`one of ${col.options.map((o) => o.label).join(", ")}`);
      break;
    case "readonly":
      parts.push("not entered here");
      break;
    default:
      parts.push(col.max_length ? `text, at most ${plural(col.max_length, "character")}` : "text");
  }
  if (col.required) parts.unshift("required");
  return parts.join("; ");
}

export class OmEntryGrid extends HTMLElement {
  static formAssociated = true;

  static get observedAttributes() {
    return ["name", "caption", "min-rows", "max-rows", "csv", "add-label", "csv-label", "empty"];
  }

  #uid = `om-entry-${++instances}`;
  #internals = null;
  #columns = [];
  #rows = []; // the rows shown, in order (see #makeRow)
  #seed = []; // the rows given, for a form's reset
  #serial = 0;
  #declaredRules = [];
  #rules = new Set(); // page functions
  #serverTable = []; // the server's messages for the table
  #ruleTable = []; // the rules' messages for the table, now
  #shownRules = []; // what of them is shown: as of the last committed change
  #ruleCells = new Set(); // cells and rows a rule's message is on
  #reveal = false; // every problem shown (after a submit was held, or reportValidity)
  #columnsSet = false;
  #rowsSet = false;
  #built = false;
  #waiting = false;
  #holding = false; // within one submit's burst of invalid events
  #validity = { message: "", anchor: null }; // what the element's own validity says now
  // The drawn parts.
  #messages = null;
  #table = null;
  #thead = null;
  #tbody = null;
  #caption = null;
  #empty = null;
  #add = null;
  #csv = null;
  #note = null;
  #live = null;
  #dialog = null;
  #import = null;

  constructor() {
    super();
    try {
      this.#internals = this.attachInternals ? this.attachInternals() : null;
    } catch {
      this.#internals = null;
    }
  }

  connectedCallback() {
    if (this.#built || this.#waiting) return;
    // Upgraded before the document is parsed: wait for the declared JSON and
    // the table the page shows without the kit.
    this.#waiting = true;
    whenParsed(() => {
      this.#waiting = false;
      if (!this.#built && this.isConnected) this.#build();
    });
  }

  attributeChangedCallback(name) {
    if (!this.#built) return;
    if (name === "caption") this.#caption.textContent = this.getAttribute("caption") || "";
    if (name === "add-label") this.#add.textContent = this.getAttribute("add-label") || "Add a row";
    if (name === "csv-label" && this.#csv) this.#csv.textContent = this.getAttribute("csv-label") || "Import a CSV";
    if (name === "csv") this.#csv.hidden = !this.hasAttribute("csv");
    if (name === "empty") this.#empty.firstChild.textContent = this.#emptyText();
    if (name === "min-rows") this.#pad();
    if (name === "name" || name === "min-rows" || name === "max-rows") {
      this.#renumber();
      this.#evaluate(true);
    }
  }

  formResetCallback() {
    // The form's reset: the rows as given, and nothing said.
    if (!this.#built) return;
    this.#serverTable = [];
    this.#reveal = false;
    this.#load(this.#seed, []);
  }

  // ── The API ──────────────────────────────────────────────────────────────

  /** Where the rows sit, a path (the `name` attribute, default "rows"): each input is named under it. */
  get name() {
    const n = (this.getAttribute("name") || "").trim();
    return isPath(n) ? n : "rows";
  }

  set name(value) {
    this.setAttribute("name", String(value));
  }

  get minRows() {
    const n = Number(this.getAttribute("min-rows"));
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  get maxRows() {
    const n = Number(this.getAttribute("max-rows"));
    return Math.max(this.minRows, Number.isInteger(n) && n > 0 ? n : MOST_ROWS);
  }

  get columns() {
    return this.#columns.map((c) => ({ ...c }));
  }

  set columns(value) {
    this.#columnsSet = true;
    const kept = this.#rows.map((r) => r.values);
    this.#columns = (value || []).map(normaliseEntryColumn);
    if (this.#built) this.#load(kept, []);
  }

  /** The rows as they would post: each row not blank, its values as posted (a
   * code in capitals, a choice's value), keyed by column. Setting it replaces
   * every row, and is what a form's reset returns to. */
  get rows() {
    return this.#posted().map((row) => ({ ...this.#valuesOf(row) }));
  }

  set rows(value) {
    this.#rowsSet = true;
    this.#seed = (value || []).map((r) => ({ ...r }));
    if (this.#built) this.#load(this.#seed, []);
  }

  /** How many rows are shown, blank ones included. */
  get size() {
    return this.#rows.length;
  }

  /** Add a row at the end, with these values; its index, or -1 at `max-rows`. */
  addRow(values = {}) {
    if (!this.#built || this.#rows.length >= this.maxRows) return -1;
    const row = this.#makeRow(values);
    this.#insert(row);
    this.#renumber();
    this.#evaluate(true);
    this.#paintRow(row);
    return row.n;
  }

  /** Remove the row at `index`; false at `min-rows` or for no such row. */
  removeRow(index) {
    const row = this.#rows[index];
    if (!row || this.#rows.length <= this.minRows) return false;
    row.tr.remove();
    row.msgTr.remove();
    this.#rows.splice(index, 1);
    this.#ruleCells.delete(row);
    for (const cell of row.cells.values()) this.#ruleCells.delete(cell);
    this.#renumber();
    this.#evaluate(true);
    return true;
  }

  /**
   * The server's word on what was posted: `[{ path, message }]`, each path in
   * the data dictionary's grammar. `name[n].field` is shown on the cell (the
   * column whose `path` it is, or the one it goes on beneath), `name[n]` on
   * the row and `name` (or no path) over the table; `n` is the row's index as
   * posted. Each is shown until its cell (its row, for a row's; any cell, for
   * the table's) is changed. Returns those whose path is not inside this
   * grid, for the page to show elsewhere.
   */
  setErrors(errors) {
    this.#clearServer();
    const rest = this.#placeErrors(errors, false);
    this.#paintAll();
    this.#renderMessages();
    const cells = this.#rows.reduce((n, r) => n + [...r.cells.values()].filter((c) => c.server).length + (r.server ? 1 : 0), 0);
    const said = cells + this.#serverTable.length;
    if (said) this.#say(`${plural(said, "problem")} to look at in ${this.getAttribute("caption") || "the table"}.`);
    return rest;
  }

  clearErrors() {
    this.#clearServer();
    this.#paintAll();
    this.#renderMessages();
  }

  /**
   * A rule over the rows, as a page's script says it: `rule(rows)` with the
   * rows as `rows` gives them, returning nothing, a message, `{ path,
   * message }` or a list of them. A path is the grid's own (`lots[1].cost`)
   * or under it (`[1].cost`); none is the table's. Run on every change; a
   * message holds the form's submit as a cell's does. Returns a function that
   * removes the rule.
   */
  addRule(rule) {
    if (typeof rule !== "function") throw new TypeError("om-entry-grid: a rule is a function of the rows");
    this.#rules.add(rule);
    if (this.#built) this.#evaluate(true);
    return () => {
      this.#rules.delete(rule);
      if (this.#built) this.#evaluate(true);
    };
  }

  /** Whether every row is as its columns and rules want it, saying nothing. */
  checkValidity() {
    return !this.#firstProblem();
  }

  /** Every problem shown, the keyboard to the first; whether there are none. */
  reportValidity() {
    this.#revealAll();
    const first = this.#firstProblem();
    if (first) first.focus();
    return !first;
  }

  /** Open the CSV dialog (as the `csv` link does). */
  openImport() {
    if (!this.#built) return;
    this.#openImport();
  }

  // ── Building ─────────────────────────────────────────────────────────────

  #build() {
    const data = declaredJson(this) || {};
    if (!this.#columnsSet && Array.isArray(data.columns)) {
      try {
        this.#columns = data.columns.map(normaliseEntryColumn);
      } catch (e) {
        this.#error(e.message);
        return;
      }
    }
    // No columns: the page's own table stays, and posts as it is.
    if (!this.#columns.length) return;
    if (!this.#rowsSet && Array.isArray(data.rows)) this.#seed = data.rows.map((r) => (r && typeof r === "object" ? { ...r } : {}));
    this.#declaredRules = this.#readRules(data.rules);
    // What the person typed into the page's own table before the kit came.
    const typed = new Map();
    for (const c of this.querySelectorAll("input[name], select[name], textarea[name]")) {
      const changed = c.localName === "select" ? [...c.options].some((o) => o.selected !== o.defaultSelected) : c.value !== c.defaultValue;
      if (changed) typed.set(c.getAttribute("name"), c.value);
    }

    this.#built = true;
    this.textContent = "";
    this.#messages = el("div", "notice bad om-entry-messages");
    this.#messages.setAttribute("role", "alert");
    this.#messages.hidden = true;
    const wrap = el("div", "table-wrap");
    this.#table = el("table", "om-entry");
    this.#caption = el("caption", "visually-hidden", this.getAttribute("caption") || "");
    this.#thead = el("thead");
    this.#tbody = el("tbody");
    this.#table.append(this.#caption, this.#thead, this.#tbody);
    wrap.append(this.#table);
    const foot = el("div", "om-entry-foot");
    this.#add = el("button", "om-entry-add", this.getAttribute("add-label") || "Add a row");
    this.#add.type = "button";
    this.#csv = el("button", "link om-entry-csv", this.getAttribute("csv-label") || "Import a CSV");
    this.#csv.type = "button";
    this.#csv.setAttribute("aria-haspopup", "dialog");
    this.#csv.hidden = !this.hasAttribute("csv");
    this.#note = el("span", "hint om-entry-note");
    foot.append(this.#add, this.#csv, this.#note);
    this.#live = el("div", "visually-hidden om-entry-live");
    this.#live.setAttribute("aria-live", "polite");
    this.append(this.#messages, wrap, foot, this.#live);
    this.#empty = el("tr", "om-entry-empty");
    this.#empty.append(el("td", "", this.#emptyText()));

    this.#add.addEventListener("click", () => {
      const at = this.addRow();
      if (at < 0) return;
      this.#focusCell(at, 0);
      this.#say(`Row ${at + 1} added.`);
      this.#changed();
    });
    this.#csv.addEventListener("click", () => this.#openImport());
    this.#tbody.addEventListener("input", (e) => this.#onInput(e, "input"));
    this.#tbody.addEventListener("change", (e) => this.#onInput(e, "change"));
    this.#tbody.addEventListener("keydown", (e) => this.#onKey(e));
    this.#tbody.addEventListener("paste", (e) => this.#onPaste(e));
    this.#tbody.addEventListener("focusout", (e) => this.#onLeave(e));
    this.#tbody.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("button.om-entry-remove");
      if (b) this.#onRemove(b);
    });
    // A submit held for this grid's problems: show every one, the keyboard to
    // the first, and no browser bubble over a message already on the cell.
    this.addEventListener("invalid", (e) => this.#onInvalid(e), true);

    this.#load(this.#seed, Array.isArray(data.errors) ? data.errors : [], typed);
  }

  #emptyText() {
    return this.getAttribute("empty") || "No rows yet.";
  }

  #error(message) {
    this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: message } }));
  }

  #readRules(rules) {
    const out = [];
    for (const r of Array.isArray(rules) ? rules : []) {
      const col = r && this.#columns.find((c) => c.key === r.sum && c.type === "decimal");
      if (!col || !parseDecimal(String(r.equals ?? ""))) {
        this.#error(`om-entry-grid: a rule is { "sum": <a decimal column's key>, "equals": "<a decimal>" }, not ${JSON.stringify(r)}`);
        continue;
      }
      out.push({ col, equals: String(r.equals), message: typeof r.message === "string" && r.message ? r.message : "" });
    }
    return out;
  }

  // Draw the head, and every row from `rows`, with `errors` placed.
  #load(rows, errors, typed = null) {
    for (const row of this.#rows) row.tr.remove(), row.msgTr.remove();
    this.#rows = [];
    this.#ruleCells.clear();
    this.#renderHead();
    for (const values of rows) {
      if (this.#rows.length >= this.maxRows) break;
      this.#insert(this.#makeRow(values));
    }
    this.#pad();
    if (typed && typed.size) {
      // Names as the page wrote them: by the row's place.
      this.#rows.forEach((row, i) => {
        for (const cell of row.cells.values()) {
          const name = `${this.name}[${i}].${cell.col.path}`;
          if (!typed.has(name) || cell.col.type === "readonly") continue;
          row.values[cell.col.key] = typed.get(name);
          row.checked = null;
          this.#setControl(cell, typed.get(name));
          cell.touched = true;
        }
        row.blank = this.#isBlank(row);
      });
    }
    this.#renumber();
    this.#placeErrors(errors, true);
    this.#evaluate(true);
    this.#paintAll();
    this.#renderMessages();
  }

  // Blank rows to the minimum; a grid with no rows given starts with one.
  #pad() {
    const want = Math.max(this.minRows, this.#rows.length ? 0 : 1);
    while (this.#rows.length < Math.min(want, this.maxRows)) this.#insert(this.#makeRow({}));
  }

  #renderHead() {
    const tr = el("tr");
    const n = el("th", "om-entry-n");
    n.scope = "col";
    n.append(el("span", "visually-hidden", "Row"));
    tr.append(n);
    for (const col of this.#columns) {
      const th = el("th");
      th.scope = "col";
      th.id = `${this.#uid}-c-${col.key}`;
      if (col.type === "decimal") th.className = "num";
      if (col.width) th.style.width = col.width;
      th.append(document.createTextNode(col.label));
      if (col.required) {
        const req = el("span", "om-entry-req", " *");
        req.setAttribute("aria-hidden", "true");
        th.append(req, el("span", "visually-hidden", " (required)"));
      }
      if (col.hint) {
        const hint = el("span", "hint", col.hint);
        hint.id = `${this.#uid}-h-${col.key}`;
        th.append(hint);
      }
      tr.append(th);
    }
    const act = el("th", "om-entry-act");
    act.scope = "col";
    act.append(el("span", "visually-hidden", "Remove"));
    tr.append(act);
    this.#thead.replaceChildren(tr);
    this.#empty.firstChild.colSpan = this.#columns.length + 2;
  }

  // A row's model and its drawing: { id, n, posted, values, blank, left,
  // server, rule, tr, num, remove, msgTr, msg, cells: key -> cell }; a cell is
  // { col, td, control, shown, err, own, block, rule, server, touched }.
  #makeRow(given) {
    const row = {
      id: `r${++this.#serial}`,
      n: -1,
      posted: -1,
      values: {},
      blank: true,
      left: false,
      server: "",
      rule: "",
      cells: new Map(),
    };
    const tr = el("tr");
    tr.dataset.row = row.id;
    const num = el("th", "om-entry-n");
    num.scope = "row";
    tr.append(num);
    for (const col of this.#columns) {
      const v = given && Object.hasOwn(given, col.key) && !isBlankText(given[col.key]) ? String(given[col.key]) : col.type === "readonly" ? "" : col.default;
      row.values[col.key] = v;
      const td = el("td");
      td.dataset.label = col.label;
      if (col.required) td.dataset.required = "";
      if (col.hint) td.dataset.hint = col.hint;
      if (col.type === "decimal") td.className = "num";
      const cell = { row, col, td, control: null, text: null, err: null, shownMessage: "", block: "", rule: "", server: "", touched: false };
      if (col.type === "readonly") {
        cell.text = el("span", "om-entry-ro");
        cell.control = el("input");
        cell.control.type = "hidden";
        cell.control.dataset.key = col.key;
        td.append(cell.text, cell.control);
      } else {
        cell.control = this.#control(row, col);
        cell.err = el("span", "om-entry-error");
        cell.err.id = `${this.#uid}-${row.id}-${col.key}-error`;
        cell.err.hidden = true;
        td.append(cell.control, cell.err);
      }
      this.#setControl(cell, v);
      row.cells.set(col.key, cell);
      tr.append(td);
    }
    const act = el("td", "om-entry-act");
    const remove = el("button", "om-entry-remove", "Remove");
    remove.type = "button";
    act.append(remove);
    tr.append(act);
    const msgTr = el("tr", "om-entry-row-message");
    msgTr.hidden = true;
    const msg = el("td");
    msg.id = `${this.#uid}-${row.id}-message`;
    msg.colSpan = this.#columns.length + 2;
    msgTr.append(msg);
    Object.assign(row, { tr, num, remove, msgTr, msg });
    row.blank = this.#isBlank(row);
    return row;
  }

  #control(row, col) {
    const id = `${this.#uid}-${row.id}-${col.key}`;
    let c;
    if (col.type === "choice") {
      c = el("select");
      c.append(option(col.placeholder || "Choose…", ""));
      for (const o of col.options) c.append(option(o.label, o.value));
    } else {
      c = el("input");
      c.type = "text";
      c.autocomplete = "off";
      c.spellcheck = false;
      if (col.type === "decimal") c.inputMode = "decimal";
      if (col.type === "code") c.setAttribute("autocapitalize", "characters");
      const placeholder = col.placeholder || (col.type === "date" ? "YYYY-MM-DD" : "");
      if (placeholder) c.placeholder = placeholder;
    }
    c.id = id;
    c.dataset.key = col.key;
    if (col.required) c.setAttribute("aria-required", "true");
    return c;
  }

  // Show a value in its cell's control. A choice given a value it does not
  // offer keeps it, as an option saying so, so the cell can say what is wrong.
  #setControl(cell, value) {
    const { col, control } = cell;
    if (col.type === "readonly") {
      cell.text.textContent = value;
      control.value = value;
      return;
    }
    if (col.type !== "choice") {
      if (control.value !== value) control.value = value;
      return;
    }
    const known = value === "" ? { value: "" } : matchOption(col, value);
    control.querySelector("option[data-om-unknown]")?.remove();
    if (known) {
      control.value = known.value;
      return;
    }
    const o = option(`${value} (not a choice)`, value);
    o.dataset.omUnknown = "";
    control.append(o);
    control.value = value;
  }

  #insert(row) {
    this.#tbody.append(row.tr, row.msgTr);
    this.#rows.push(row);
  }

  // ── Numbering and names ──────────────────────────────────────────────────

  #isBlank(row) {
    for (const col of this.#columns) {
      const v = row.values[col.key] ?? "";
      if (col.type === "readonly" ? !isBlankText(v) : String(v).trim() !== col.default.trim()) return false;
    }
    return true;
  }

  #posted() {
    return this.#rows.filter((r) => !r.blank);
  }

  // Each row's number, each control's name (the path a server's message
  // names it by: `name[n].path`, n counting the rows posted), and the
  // buttons' state.
  #renumber() {
    const prefix = this.name;
    let posted = 0;
    this.#rows.forEach((row, i) => {
      const n = i;
      if (row.n !== n) {
        row.n = n;
        row.num.textContent = String(n + 1);
        row.remove.setAttribute("aria-label", `Remove row ${n + 1}`);
        for (const cell of row.cells.values()) {
          if (cell.col.type !== "readonly") cell.control.setAttribute("aria-label", `${cell.col.label}, row ${n + 1}`);
        }
      }
      row.posted = row.blank ? -1 : posted++;
      for (const cell of row.cells.values()) {
        const name = row.blank ? null : `${prefix}[${row.posted}].${cell.col.path}`;
        if (name === null) {
          if (cell.control.hasAttribute("name")) cell.control.removeAttribute("name");
        } else if (cell.control.getAttribute("name") !== name) cell.control.setAttribute("name", name);
      }
      row.remove.disabled = this.#rows.length <= this.minRows;
    });
    this.#add.disabled = this.#rows.length >= this.maxRows;
    if (this.#rows.length) this.#empty.remove();
    else if (!this.#empty.isConnected) this.#tbody.append(this.#empty);
  }

  // A row's values as posted, checked once per change to the row: a rule
  // runs over every row on every key.
  #valuesOf(row) {
    if (!row.checked) {
      row.checked = {};
      for (const col of this.#columns) row.checked[col.key] = checkEntryValue(col, row.values[col.key]).value;
    }
    return row.checked;
  }

  // ── Checking ─────────────────────────────────────────────────────────────

  // A cell's own problem: its type and bounds, and required in a row that is
  // not blank. A blank row has none.
  #own(row, cell) {
    if (row.blank || cell.col.type === "readonly") return { type: null, required: null };
    const check = checkEntryValue(cell.col, row.values[cell.col.key]);
    return { type: check.message, required: cell.col.required && check.empty ? "Required" : null };
  }

  // What a cell says and what it holds the submit with. Its type's problem
  // shows once it is typed in; required, once its row is left (or it was
  // emptied); a rule's and the server's, at once. All of them, once a submit
  // was held.
  #paintCell(row, cell, announce = false) {
    if (cell.col.type === "readonly") return;
    const own = this.#own(row, cell);
    const block = own.type || own.required || cell.rule || "";
    if (cell.block !== block) {
      cell.control.setCustomValidity(block);
      cell.block = block;
    }
    let shown = "";
    if (own.type && (cell.touched || this.#reveal)) shown = own.type;
    else if (own.required && (cell.touched || row.left || this.#reveal)) shown = own.required;
    else shown = cell.rule || cell.server || "";
    if (shown !== cell.shownMessage) {
      cell.shownMessage = shown;
      cell.err.textContent = shown;
      cell.err.hidden = !shown;
      if (shown) cell.control.setAttribute("aria-invalid", "true");
      else cell.control.removeAttribute("aria-invalid");
      if (shown && announce) this.#say(`${cell.col.label}, row ${row.n + 1}: ${shown}`);
    }
    this.#describe(row, cell);
  }

  #describe(row, cell) {
    const ids = [];
    if (cell.col.hint) ids.push(`${this.#uid}-h-${cell.col.key}`);
    if (cell.shownMessage) ids.push(cell.err.id);
    if (!row.msgTr.hidden) ids.push(row.msg.id);
    const value = ids.join(" ");
    if ((cell.control.getAttribute("aria-describedby") || "") !== value) {
      if (value) cell.control.setAttribute("aria-describedby", value);
      else cell.control.removeAttribute("aria-describedby");
    }
  }

  #paintRow(row, announce = false) {
    const message = row.rule || row.server || "";
    if (row.msg.textContent !== message) row.msg.textContent = message;
    row.msgTr.hidden = !message;
    row.tr.classList.toggle("om-entry-invalid", Boolean(message));
    for (const cell of row.cells.values()) this.#paintCell(row, cell, announce);
  }

  #paintAll() {
    for (const row of this.#rows) this.#paintRow(row);
  }

  // The rules: the declared sums and the page's functions, over the rows as
  // posted. Their messages are placed (cells and rows painted at once; the
  // table's shown when `commit`, so the table's words do not change under
  // every key), and the element's own validity set.
  #evaluate(commit) {
    const before = new Set(this.#ruleCells);
    for (const t of before) t.rule = "";
    this.#ruleCells.clear();
    this.#ruleTable = [];
    const posted = this.#posted();
    const rows = this.#declaredRules.length || this.#rules.size ? posted.map((r) => this.#valuesOf(r)) : [];
    // A page's rule is handed copies: what it does to them is its own.
    const copies = this.#rules.size ? rows.map((r) => ({ ...r })) : [];
    const said = [];
    for (const rule of this.#declaredRules) {
      const values = rows.map((r) => r[rule.col.key]);
      if (!values.length || values.some((v) => v !== "" && !/^[+-]?\d+(?:\.\d+)?$/.test(v))) continue;
      const sum = addDecimals(values);
      if (compareDecimal(sum, rule.equals) === 0) continue;
      const words = rule.message || `${rule.col.label} adds up to {sum}; it should be {equals}.`;
      said.push({ message: words.replaceAll("{sum}", sum).replaceAll("{equals}", rule.equals) });
    }
    for (const rule of this.#rules) {
      let out;
      try {
        out = rule(copies);
      } catch (e) {
        this.#error(`om-entry-grid: a rule threw: ${e.message}`);
        continue;
      }
      for (const o of Array.isArray(out) ? out : [out]) {
        if (!o) continue;
        said.push(typeof o === "string" ? { message: o } : { path: o.path, message: String(o.message ?? "") });
      }
    }
    for (const { path, message } of said) {
      if (!message) continue;
      const full = typeof path === "string" && path.startsWith("[") ? `${this.name}${path}` : path;
      const at = full ? locatePath(this.name, full) : { at: "table" };
      const row = at && at.at !== "table" ? posted[at.index] : null;
      if (row && at.at === "cell") {
        const col = columnForField(this.#columns, at.field);
        const cell = col && row.cells.get(col.key);
        if (cell && col.type !== "readonly") {
          cell.rule = cell.rule ? `${cell.rule} ${message}` : message;
          this.#ruleCells.add(cell);
          continue;
        }
      }
      if (row) {
        row.rule = row.rule ? `${row.rule} ${message}` : message;
        this.#ruleCells.add(row);
        continue;
      }
      this.#ruleTable.push(message);
    }
    // Repaint where a rule's message came or went.
    const touched = new Set();
    for (const t of [...before, ...this.#ruleCells]) touched.add(t.cells ? t : t.row);
    for (const row of touched) if (row.tr.isConnected) this.#paintRow(row);
    if (commit) {
      this.#shownRules = this.#ruleTable.slice();
      this.#renderMessages();
    }
    this.#syncValidity();
  }

  // The table's own problems, which hold a submit through the element itself
  // (ElementInternals, where the browser has it); a cell's hold it through
  // its input.
  #tableProblems() {
    const out = [...this.#ruleTable];
    for (const row of this.#rows) if (row.rule) out.push(`Row ${row.n + 1}: ${row.rule}`);
    const posted = this.#posted().length;
    if (posted < this.minRows) out.push(`Give at least ${plural(this.minRows, "row")}.`);
    return out;
  }

  // Set only when what it says changes: a form's validity restyles the form.
  #syncValidity() {
    if (!this.#internals || !this.#internals.setValidity) return;
    const problems = this.#tableProblems();
    const message = problems.join(" ");
    const anchor = message ? this.#firstControl(this.#rows.find((r) => r.rule)) || this.#firstControl() || this.#add : null;
    if (message === this.#validity.message && anchor === this.#validity.anchor) return;
    this.#validity = { message, anchor };
    if (!message) {
      this.#internals.setValidity({});
      return;
    }
    try {
      this.#internals.setValidity({ customError: true }, message, anchor);
    } catch {
      this.#internals.setValidity({ customError: true }, message);
    }
  }

  /** The first control a person types in: of `row`, or of the grid. */
  #firstControl(row) {
    for (const r of row ? [row] : this.#rows) for (const cell of r.cells.values()) if (cell.col.type !== "readonly") return cell.control;
    return null;
  }

  // The first control holding the submit, or the table's anchor.
  #firstProblem() {
    for (const row of this.#rows) for (const cell of row.cells.values()) if (cell.block) return cell.control;
    return this.#tableProblems().length ? this.#firstControl(this.#rows.find((r) => r.rule)) || this.#firstControl() || this.#add : null;
  }

  #revealAll() {
    this.#reveal = true;
    this.#shownRules = this.#ruleTable.slice();
    this.#paintAll();
    this.#renderMessages();
  }

  #onInvalid(e) {
    e.preventDefault();
    if (this.#holding) return;
    this.#holding = true;
    setTimeout(() => {
      this.#holding = false;
    }, 0);
    this.#revealAll();
    const first = this.#firstProblem();
    const cells = this.#rows.reduce((n, r) => n + [...r.cells.values()].filter((c) => c.block).length, 0);
    const table = this.#tableProblems().length;
    this.#say(`Not sent: ${[cells ? `${plural(cells, "cell")} to fix` : "", table ? plural(table, "problem") + " with the rows" : ""].filter(Boolean).join(" and ")}.`);
    first?.focus();
  }

  // The table's messages: the server's, the rules' (as of the last committed
  // change) and too few rows (once a submit was held).
  #renderMessages() {
    const items = [...this.#serverTable, ...this.#shownRules];
    if (this.#reveal) {
      for (const row of this.#rows) if (row.rule) items.push(`Row ${row.n + 1}: ${row.rule}`);
      if (this.#posted().length < this.minRows) items.push(`Give at least ${plural(this.minRows, "row")}.`);
    }
    const said = [...new Set(items)];
    const now = [...this.#messages.querySelectorAll("li")].map((li) => li.textContent);
    if (now.length === said.length && now.every((t, i) => t === said[i])) return;
    if (!said.length) {
      this.#messages.replaceChildren();
      this.#messages.hidden = true;
      return;
    }
    const ul = el("ul", "plain");
    for (const t of said) ul.append(el("li", "", t));
    this.#messages.replaceChildren(ul);
    this.#messages.hidden = false;
  }

  // ── The server's messages ────────────────────────────────────────────────

  #clearServer() {
    this.#serverTable = [];
    for (const row of this.#rows) {
      row.server = "";
      for (const cell of row.cells.values()) cell.server = "";
    }
  }

  // Place each message by its path; declared ones that are not inside the
  // grid are shown over the table, since the page put them here.
  #placeErrors(errors, declared) {
    const rest = [];
    const posted = this.#posted();
    for (const e of Array.isArray(errors) ? errors : []) {
      const item = typeof e === "string" ? { message: e } : e && typeof e === "object" ? e : null;
      if (!item || isBlankText(item.message)) continue;
      const message = String(item.message);
      const path = typeof item.path === "string" && item.path ? item.path : null;
      const at = path ? locatePath(this.name, path) : { at: "table" };
      if (!at) {
        if (declared) this.#serverTable.push(message);
        else rest.push(item);
        continue;
      }
      if (at.at === "table") {
        this.#serverTable.push(message);
        continue;
      }
      const row = posted[at.index];
      if (!row) {
        this.#serverTable.push(`Row ${at.index + 1}: ${message}`);
        continue;
      }
      if (at.at === "cell") {
        const col = columnForField(this.#columns, at.field);
        const cell = col && col.type !== "readonly" && row.cells.get(col.key);
        if (cell) {
          cell.server = cell.server ? `${cell.server} ${message}` : message;
          continue;
        }
      }
      row.server = row.server ? `${row.server} ${message}` : message;
    }
    return rest;
  }

  // ── A person's edits ─────────────────────────────────────────────────────

  #cellOf(target) {
    const tr = target.closest && target.closest("tr[data-row]");
    const row = tr && this.#rows.find((r) => r.tr === tr);
    const key = target.dataset && target.dataset.key;
    return row && key ? { row, cell: row.cells.get(key) } : null;
  }

  #onInput(e, how) {
    const at = this.#cellOf(e.target);
    if (!at || at.cell.col.type === "readonly") return;
    const { row, cell } = at;
    let value = cell.control.value;
    if (how === "change") {
      // Committed: shown as it is posted (trimmed; a code in capitals).
      const check = checkEntryValue(cell.col, value);
      if (cell.col.type !== "choice" && !check.message && check.value !== value) cell.control.value = value = check.value;
      // A choice made: the value it did not offer goes.
      const unknown = cell.col.type === "choice" && cell.control.querySelector("option[data-om-unknown]");
      if (unknown && cell.control.value !== unknown.value) unknown.remove();
    }
    if (how === "input" && row.values[cell.col.key] === value && cell.touched) return;
    this.#edited(row, cell, value, how === "change");
  }

  #edited(row, cell, value, commit) {
    row.values[cell.col.key] = value;
    row.checked = null;
    cell.touched = true;
    cell.server = "";
    row.server = "";
    const hadTable = this.#serverTable.length > 0;
    this.#serverTable = [];
    const wasBlank = row.blank;
    row.blank = this.#isBlank(row);
    if (wasBlank !== row.blank) this.#renumber();
    // The cell first, so its own message is said; then the rules, over every row.
    this.#paintCell(row, cell, true);
    this.#evaluate(commit);
    if (hadTable && !commit) this.#renderMessages();
    this.#paintRow(row);
    this.#changed();
  }

  // The row is left: its required cells say so.
  #onLeave(e) {
    const tr = e.target.closest && e.target.closest("tr[data-row]");
    if (!tr) return;
    if (e.relatedTarget && tr.contains(e.relatedTarget)) return;
    const row = this.#rows.find((r) => r.tr === tr);
    if (!row || row.left || row.blank) return;
    row.left = true;
    this.#paintRow(row);
  }

  #onRemove(button) {
    const row = this.#rows.find((r) => r.remove === button);
    if (!row) return;
    const at = row.n;
    if (!this.removeRow(at)) return;
    this.#say(`Row ${at + 1} removed.`);
    const next = this.#rows[Math.min(at, this.#rows.length - 1)];
    (next ? next.remove : this.#add).focus();
    if (next && next.remove.disabled) this.#focusCell(next.n, 0);
    this.#changed();
  }

  #changed() {
    // The rows are read only by a listener that asks for them.
    const grid = this;
    this.dispatchEvent(new CustomEvent("om-change", { bubbles: true, detail: { get rows() { return grid.rows; } } }));
  }

  #editable() {
    return this.#columns.filter((c) => c.type !== "readonly");
  }

  #focusCell(rowIndex, columnIndex) {
    const row = this.#rows[rowIndex];
    const col = this.#editable()[columnIndex];
    if (!row || !col) return false;
    row.cells.get(col.key).control.focus();
    return true;
  }

  // Arrows between cells (up and down from a text input; left and right at
  // the edge of its text), Enter down a row and, on the last, a row added.
  #onKey(e) {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const at = this.#cellOf(e.target);
    if (!at) return;
    const { row, cell } = at;
    const editable = this.#editable();
    const c = editable.indexOf(cell.col);
    const text = cell.control.localName === "input";
    const r = row.n;
    let to = null;
    switch (e.key) {
      case "ArrowUp":
        if (text) to = [r - 1, c];
        break;
      case "ArrowDown":
        if (text) to = [r + 1, c];
        break;
      case "ArrowLeft":
        if (text && cell.control.selectionStart === 0 && cell.control.selectionEnd === 0) to = [r, c - 1];
        break;
      case "ArrowRight": {
        const end = cell.control.value.length;
        if (text && cell.control.selectionStart === end && cell.control.selectionEnd === end) to = [r, c + 1];
        break;
      }
      case "Enter": {
        // Never the form's implicit submit from inside the grid.
        e.preventDefault();
        if (e.shiftKey) {
          this.#focusCell(r - 1, c);
          return;
        }
        if (r < this.#rows.length - 1) {
          this.#focusCell(r + 1, c);
          return;
        }
        if (row.blank) return;
        const added = this.addRow();
        if (added >= 0) {
          this.#focusCell(added, 0);
          this.#say(`Row ${added + 1} added.`);
          this.#changed();
        }
        return;
      }
      default:
        return;
    }
    if (to && this.#focusCell(to[0], to[1])) e.preventDefault();
  }

  // ── Paste from a spreadsheet ─────────────────────────────────────────────

  #onPaste(e) {
    const at = this.#cellOf(e.target);
    if (!at || !e.clipboardData) return;
    const text = e.clipboardData.getData("text/plain");
    // One value: the browser's own paste, into the one cell.
    if (!text || !/[\t\r\n]/.test(text.replace(/[\r\n]+$/, ""))) return;
    e.preventDefault();
    const grid = parseDelimited(text, "\t").filter((line, i, all) => i < all.length - 1 || line.some((v) => v.trim() !== ""));
    this.#fill(at.row.n, this.#editable().indexOf(at.cell.col), grid, "paste");
  }

  /** Fill cells from `grid` (rows of cells) from row `r`, editable column `c`, adding rows as needed. */
  #fill(r, c, grid, how) {
    const editable = this.#editable();
    let dropped = 0;
    let overflow = 0;
    const filled = [];
    for (let i = 0; i < grid.length; i++) {
      let row = this.#rows[r + i];
      if (!row) {
        if (this.#rows.length >= this.maxRows) {
          dropped++;
          continue;
        }
        row = this.#makeRow({});
        this.#insert(row);
      }
      grid[i].forEach((raw, j) => {
        const cell = editable[c + j] && row.cells.get(editable[c + j].key);
        if (!cell) {
          if (raw.trim() !== "") overflow = Math.max(overflow, j - (editable.length - c) + 1);
          return;
        }
        this.#put(row, cell, raw);
      });
      row.left = true;
      row.server = "";
      row.blank = this.#isBlank(row);
      filled.push(row);
    }
    this.#serverTable = [];
    this.#renumber();
    this.#evaluate(true);
    for (const row of filled) this.#paintRow(row);
    const bad = filled.reduce((n, row) => n + [...row.cells.values()].filter((cell) => cell.block).length, 0);
    const words = [
      `${how === "paste" ? "Pasted" : "Imported"} ${plural(filled.length, "row")}.`,
      bad ? `${plural(bad, "cell")} to fix.` : "",
      dropped ? `${plural(dropped, "row")} past the ${this.maxRows} this table holds left out.` : "",
      overflow ? `${plural(overflow, "column")} past ${editable[editable.length - 1].label} left out.` : "",
    ].filter(Boolean).join(" ");
    this.#note.textContent = words;
    this.#say(words);
    this.#changed();
    return filled;
  }

  // One value into one cell, as typed: trimmed, and as posted where it is good.
  // A cell is one line: a spreadsheet cell's line breaks become spaces.
  #put(row, cell, raw) {
    raw = String(raw).replace(/\s*[\r\n]+\s*/g, " ");
    const check = checkEntryValue(cell.col, raw);
    const value = check.message ? String(raw).trim() : check.value;
    row.values[cell.col.key] = value;
    row.checked = null;
    this.#setControl(cell, value);
    cell.touched = true;
    cell.server = "";
  }

  // ── CSV, in a dialog ─────────────────────────────────────────────────────

  #openImport() {
    if (!this.#dialog) this.#buildDialog();
    this.#import = { step: "read", headers: [], rows: [], map: {} };
    const d = this.#dialog;
    d.querySelector(".om-entry-file").value = "";
    d.querySelector(".om-entry-paste").value = "";
    this.#renderImport();
    // Placed where it was asked for, not the middle of the viewport: in a
    // frame grown to its page, the viewport is the whole page.
    const top = this.#csv.getBoundingClientRect().top + (globalThis.scrollY || 0);
    d.style.top = `${Math.max(16, Math.round(top - 160))}px`;
    if (d.showModal) d.showModal();
    else d.setAttribute("open", "");
    d.querySelector(".om-entry-file").focus();
  }

  #buildDialog() {
    const d = el("dialog", "om-entry-dialog");
    const title = `${this.#uid}-import-title`;
    d.setAttribute("aria-labelledby", title);
    const head = el("div", "dialog-head");
    const h = el("h2", "", "Import a CSV");
    h.id = title;
    head.append(h, el("p", "", "A file with a header row, or text pasted from one. Nothing in the table changes until you apply it."));
    const body = el("div", "dialog-body");

    // Reading: a file, or text.
    const read = el("div", "om-entry-step-read");
    const takes = el("details", "om-entry-takes");
    takes.append(el("summary", "", "The columns this table takes"));
    const list = el("ul", "plain");
    for (const col of this.#editable()) {
      const li = el("li");
      li.append(el("strong", "", col.label), document.createTextNode(`: ${describeColumn(col)}`));
      list.append(li);
    }
    takes.append(list);
    const file = el("label", "field");
    const fileInput = el("input", "om-entry-file");
    fileInput.type = "file";
    fileInput.accept = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";
    file.append(el("span", "", "A file"), fileInput);
    const paste = el("label", "field");
    const area = el("textarea", "om-entry-paste");
    area.rows = 6;
    area.spellcheck = false;
    paste.append(el("span", "", "Or paste it"), area);
    const problem = el("p", "bad-ink om-entry-problem");
    problem.setAttribute("role", "alert");
    read.append(takes, file, paste, problem);

    // Mapping and the preview.
    const map = el("div", "om-entry-step-map");
    const columns = el("details", "om-entry-map");
    columns.append(el("summary"));
    const selects = el("div", "grid-2 om-entry-map-fields");
    columns.append(selects);
    // No control of the dialog's has a name: it is inside the page's form, and never posted.
    const mode = el("label", "field om-entry-mode");
    const modes = el("select");
    modes.append(option("Replace the table's rows", "replace"), option("Add them after the table's rows", "add"));
    mode.append(el("span", "", "Its rows"), modes);
    const said = el("p", "om-entry-preview-said");
    said.setAttribute("role", "status");
    const wrap = el("div", "table-wrap om-entry-preview");
    map.append(columns, mode, said, wrap);
    body.append(read, map);

    const foot = el("div", "dialog-foot");
    const back = el("button", "link om-entry-back", "Choose another");
    const cancel = el("button", "om-entry-cancel", "Cancel");
    const go = el("button", "primary om-entry-go", "Read it");
    for (const b of [back, cancel, go]) b.type = "button";
    foot.append(back, cancel, go);
    d.append(head, body, foot);
    this.append(d);
    this.#dialog = d;

    cancel.addEventListener("click", () => this.#closeImport());
    back.addEventListener("click", () => {
      this.#import.step = "read";
      this.#renderImport();
    });
    go.addEventListener("click", () => (this.#import.step === "read" ? this.#readImport() : this.#applyImport()));
    modes.addEventListener("change", () => this.#renderPreview());
    selects.addEventListener("change", (e) => {
      const key = e.target.dataset.key;
      if (!key) return;
      this.#import.map[key] = Number(e.target.value);
      this.#renderPreview();
    });
    // Back to the link, unless Apply took the keyboard to the rows.
    d.addEventListener("close", () => {
      if (this.#import?.applied) return;
      this.#csv.focus();
    });
  }

  #closeImport() {
    if (this.#dialog.close) this.#dialog.close();
    else {
      this.#dialog.removeAttribute("open");
      if (!this.#import?.applied) this.#csv.focus();
    }
  }

  async #readImport() {
    const d = this.#dialog;
    const problem = d.querySelector(".om-entry-problem");
    const file = d.querySelector(".om-entry-file").files?.[0];
    let text = d.querySelector(".om-entry-paste").value;
    if (file) {
      if (file.size > MOST_CSV) {
        problem.textContent = `That file is ${Math.ceil(file.size / 1024 / 1024)} MB; the most read here is 2 MB. Split it, or apply it in parts.`;
        return;
      }
      try {
        text = await file.text();
      } catch (e) {
        problem.textContent = `That file could not be read: ${e.message}`;
        return;
      }
    }
    if (text.length > MOST_CSV) {
      problem.textContent = "That is more than 2 MB of text; split it, or apply it in parts.";
      return;
    }
    const lines = parseDelimited(text, sniffDelimiter(text)).filter((l) => l.some((v) => v.trim() !== ""));
    if (!lines.length) {
      problem.textContent = file ? "That file has nothing in it to read." : "Choose a file, or paste a CSV with a header row.";
      return;
    }
    if (lines.length < 2) {
      problem.textContent = "It has a header row and no rows under it.";
      return;
    }
    problem.textContent = "";
    const headers = lines[0].map((h) => h.trim());
    this.#import = { step: "map", headers, rows: lines.slice(1), map: matchHeaders(headers, this.#editable()) };
    d.querySelector(".om-entry-mode select").value = this.#posted().length ? "add" : "replace";
    this.#renderImport();
  }

  #renderImport() {
    const d = this.#dialog;
    const reading = this.#import.step === "read";
    d.querySelector(".om-entry-step-read").hidden = !reading;
    d.querySelector(".om-entry-step-map").hidden = reading;
    d.querySelector(".om-entry-back").hidden = reading;
    if (reading) {
      d.querySelector(".om-entry-go").textContent = "Read it";
      d.querySelector(".om-entry-go").disabled = false;
      d.querySelector(".om-entry-problem").textContent = "";
      return;
    }
    // The mapping: open where a header does not match a column.
    const { headers, map } = this.#import;
    const fields = d.querySelector(".om-entry-map-fields");
    fields.replaceChildren();
    for (const col of this.#editable()) {
      const label = el("label", "field");
      const s = el("select");
      s.dataset.key = col.key;
      s.append(option("Not in the CSV", "-1"));
      headers.forEach((h, i) => s.append(option(h || `Column ${i + 1}`, String(i))));
      s.value = String(map[col.key]);
      label.append(el("span", "", `${col.label}${col.required ? " (required)" : ""}`), s);
      fields.append(label);
    }
    const matched = this.#editable().filter((c) => map[c.key] >= 0).length;
    const all = matched === this.#editable().length && headers.length === matched;
    const details = d.querySelector(".om-entry-map");
    details.open = !all;
    details.querySelector("summary").textContent = all
      ? "Columns: each matched by its header"
      : `Columns: ${matched} of ${this.#editable().length} matched by header; choose the rest`;
    d.querySelector(".om-entry-mode").hidden = !this.#posted().length;
    this.#renderPreview();
  }

  // The rows the CSV gives, as the mapping reads them, each value checked.
  #importRows() {
    const { rows, map } = this.#import;
    const editable = this.#editable();
    const out = [];
    for (const line of rows) {
      const values = {};
      let any = false;
      for (const col of editable) {
        // A column not in the CSV takes its default; an empty cell is empty.
        const i = map[col.key];
        const v = i < 0 ? col.default : i < line.length ? line[i].trim() : "";
        values[col.key] = v;
        if (i >= 0 && v !== "") any = true;
      }
      if (!any) continue;
      const problems = {};
      for (const col of editable) {
        const check = checkEntryValue(col, values[col.key]);
        const message = check.message || (col.required && check.empty ? "Required" : null);
        if (message) problems[col.key] = message;
      }
      out.push({ values, problems });
    }
    return out;
  }

  #importMode() {
    return this.#dialog.querySelector(".om-entry-mode select").value === "add" && this.#posted().length ? "add" : "replace";
  }

  #renderPreview() {
    const d = this.#dialog;
    const editable = this.#editable();
    const rows = this.#importRows();
    const room = this.maxRows - (this.#importMode() === "add" ? this.#posted().length : 0);
    const kept = rows.slice(0, Math.max(0, room));
    const bad = kept.reduce((n, r) => n + Object.keys(r.problems).length, 0);
    const badRows = kept.map((r, i) => (Object.keys(r.problems).length ? i + 1 : 0)).filter(Boolean);
    const table = el("table", "dense");
    const head = el("tr");
    const n = el("th", "num", "Row");
    n.scope = "col";
    head.append(n);
    for (const col of editable) {
      const th = el("th", col.type === "decimal" ? "num" : "", col.label);
      th.scope = "col";
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    kept.slice(0, PREVIEWED).forEach((r, i) => {
      const tr = el("tr");
      tr.append(el("td", "num", String(i + 1)));
      for (const col of editable) {
        const td = el("td", col.type === "decimal" ? "num" : "");
        td.append(el("span", "", r.values[col.key]));
        if (r.problems[col.key]) {
          td.dataset.invalid = "";
          td.append(el("span", "om-entry-error", r.problems[col.key]));
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
    table.append(thead, tbody);
    d.querySelector(".om-entry-preview").replaceChildren(table);
    const listed = badRows.length > 6 ? `${badRows.slice(0, 6).join(", ")} and ${plural(badRows.length - 6, "more")}` : badRows.join(", ").replace(/, (\d+)$/, " and $1");
    d.querySelector(".om-entry-preview-said").textContent = [
      `${plural(kept.length, "row")} to apply.`,
      bad ? `${plural(bad, "cell")} to fix, in row${badRows.length === 1 ? "" : "s"} ${listed}: they can be fixed in the table once applied.` : "Every cell is as its column takes it.",
      rows.length > kept.length ? `${plural(rows.length - kept.length, "row")} past the ${this.maxRows} this table holds will be left out.` : "",
      kept.length > PREVIEWED ? `The first ${PREVIEWED} are shown.` : "",
    ].filter(Boolean).join(" ");
    const go = d.querySelector(".om-entry-go");
    go.textContent = `Apply ${plural(kept.length, "row")}`;
    go.disabled = !kept.length;
  }

  #applyImport() {
    const rows = this.#importRows();
    if (!rows.length) return;
    const editable = this.#editable();
    if (this.#importMode() === "replace") {
      for (const row of this.#rows) row.tr.remove(), row.msgTr.remove();
      this.#rows = [];
      this.#ruleCells.clear();
    } else {
      // After the rows typed: the blank ones at the end make way.
      while (this.#rows.length && this.#rows[this.#rows.length - 1].blank) {
        const row = this.#rows.pop();
        row.tr.remove();
        row.msgTr.remove();
      }
    }
    const start = this.#rows.length;
    const grid = rows.map((r) => editable.map((col) => r.values[col.key]));
    this.#import.applied = true;
    this.#closeImport();
    const filled = this.#fill(start, 0, grid, "import");
    this.#pad();
    this.#renumber();
    const first = filled.flatMap((row) => [...row.cells.values()]).find((c) => c.block);
    (first ? first.control : filled[0]?.cells.get(editable[0].key).control)?.focus();
  }

  // ── Saying ───────────────────────────────────────────────────────────────

  #say(text) {
    // The same words again are still said: a live region hears a change.
    this.#live.textContent = this.#live.textContent === text ? `${text} ` : text;
  }
}

if (!customElements.get("om-entry-grid")) customElements.define("om-entry-grid", OmEntryGrid);
