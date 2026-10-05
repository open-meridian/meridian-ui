// <om-grid>: a data grid for records that change.
//
//   <om-grid row-key="account_id" dense sort="market_value:desc"></om-grid>
//   grid.columns = [{ key: "symbol", label: "Symbol" },
//                   { key: "quantity", label: "Quantity", type: "decimal", group: true },
//                   { key: "pnl", label: "P&L", type: "decimal", tone: "sign" }];
//   grid.setRows(snapshot.rows);   // replace everything
//   grid.upsert(change.rows);      // live: replaces rows by key, in place
//   grid.remove(["ACC-2"]);
//
// Rows are keyed (row-key, default "id"), so a delivery carrying a record's
// whole new state replaces that record's row in place rather than appending.
// Updates are conflated: upserts queue and apply once per animation frame,
// the last state per key winning, so a burst of deliveries is one paint.
// Numbers are shown as the strings the plugin sent and sorted exactly
// (lib/decimal.js), never through floating point.
//
// High-rate mode (the `high-rate` attribute) is for streams: thousands of
// rows taking hundreds of updates a second. Only the rows in view, and a few
// either side, are in the document (virtual scrolling, at a fixed row
// height); an update touches only the cells whose value changed, and flashes
// them in the direction colours (up or down, so it follows the person's
// green-up or red-up convention), unless the person asks for reduced motion.
// `freeze-sort` holds the order while streaming, so rows do not jump under
// the pointer. The display order is kept incrementally, not re-sorted per
// frame: a changed row is taken out and put back by binary search.
//
// A page that writes no script declares its columns and rows as JSON in a
// child <script type="application/json">{ "columns": […], "rows": […] }</script>
// (lib/declared.js); every column option but `format` and `compare` is plain
// JSON: `hint`, `tone` from a row's field, `blank`, `strong`, `priority`.
//
// At narrow width (`narrow="cards"` or `narrow="priority"`), each row is a
// card, or the least wanted columns hide first; the CSS does it, by the
// grid's own width, so a grid in a narrow panel is narrow too.
//
// `one-line` (0.10.0) draws the table as the kit's table.one-line: every row
// one line of one height, a long value cut with an ellipsis and whole on
// hover. With narrow="priority" it is the phone's way: fewer columns, each
// row still one line. Inside an om-pager, a page of rows at a time.

import { compareDecimal, compareParsed, groupDigits, parseDecimal, signOf } from "../lib/decimal.js";
import { declaredJson, whenParsed } from "../lib/declared.js";

const NUMERIC = new Set(["number", "decimal"]);
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
// Rows drawn beyond each edge of the view in high-rate mode, so a small
// scroll shows rows already there.
const OVERSCAN = 6;
// Rows drawn before the view has a height to measure (hidden, or no layout).
const FIRST_SCREEN = 40;
const BLANK = Object.freeze({ blank: true });
// The tones a row's field may name: the badge's, and for any other column
// the text colour of the same name. Anything else is no tone, never a class.
const TONES = new Set(["good", "warn", "bad", "accent", "info", "violet", "buy", "sell"]);
const INKS = { good: "good-ink", warn: "warn-ink", bad: "bad-ink", buy: "buy-ink", sell: "sell-ink" };
// A column's fields besides its own that its cell shows: a high-rate grid
// redraws the cell when any of them changes.
const WATCHED = new WeakMap();

function normaliseColumn(c) {
  if (!c || typeof c.key !== "string") throw new TypeError("om-grid: every column needs a string key");
  const type = c.type || "text";
  const col = {
    ...c,
    type,
    label: c.label ?? c.key,
    align: c.align || (NUMERIC.has(type) ? "right" : "left"),
    sortable: c.sortable !== false,
  };
  const watched = [...(Array.isArray(c.watch) ? c.watch : []), toneField(col), typeof c.hint === "string" ? c.hint : ""];
  WATCHED.set(col, watched.filter(Boolean));
  return col;
}

/** The row field a column's tone is read from (`tone: { field: "…" }`), or "". */
function toneField(col) {
  const t = col.tone;
  return t && typeof t === "object" && typeof t.field === "string" ? t.field : "";
}

/** Whether a column draws more than its value: a hint, a blank's text, a tone
 * from a field, or strong text. */
function rich(col) {
  return Boolean((typeof col.hint === "string" && col.hint) || col.blank || col.strong || toneField(col));
}

function span(className, text) {
  const s = document.createElement("span");
  if (className) s.className = className;
  s.textContent = text;
  return s;
}

function isBlank(v) {
  return v === undefined || v === null || v === "";
}

function reducedMotion() {
  try {
    return Boolean(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

export class OmGrid extends HTMLElement {
  static get observedAttributes() {
    return ["dense", "sort", "empty", "caption", "high-rate", "freeze-sort", "row-height", "no-flash", "one-line"];
  }

  #columns = [];
  #rows = new Map(); // key -> row
  #seq = new Map(); // key -> arrival number, for a stable sort
  #arrivals = 0;
  #order = []; // keys, in the order shown
  #orderSorted = true; // whether #order is in #sort's order (a frozen sort lets it lapse)
  #orderVersion = 0;
  #sortVals = new Map(); // key -> the sort column's value, parsed once
  #trs = new Map(); // key -> <tr>, for the rows in the document
  #pending = new Map();
  #pendingRemove = new Set();
  #frame = null;
  #sort = { key: null, direction: null };
  #keyFn = null;
  #table = null;
  #thead = null;
  #tbody = null;
  #caption = null;
  #wrap = null;
  // High-rate mode.
  #fast = false;
  #topSpacer = null;
  #bottomSpacer = null;
  #rowH = 36;
  #rowMeasured = false;
  #viewH = 0;
  #headH = 0;
  #windowDirty = false;
  #drawn = { first: -1, last: -1, version: -1 };
  #active = null; // the key of the row the keyboard is on
  #resize = null;
  // Whether script set the columns or the rows, which the declared JSON then
  // leaves as they are.
  #columnsSet = false;
  #rowsSet = false;
  #waiting = false;

  connectedCallback() {
    if (this.#table || this.#waiting) return;
    // Upgraded before the document is parsed: wait for the children (the
    // declared JSON, and the table a page shows without the kit).
    this.#waiting = true;
    whenParsed(() => {
      this.#waiting = false;
      if (!this.#table && this.isConnected) this.#build();
    });
  }

  disconnectedCallback() {
    this.#resize?.disconnect();
    this.#resize = null;
  }

  attributeChangedCallback(name, before, after) {
    if (!this.#table) return;
    if (name === "one-line") this.#table.classList.toggle("one-line", this.hasAttribute("one-line"));
    if (name === "dense") {
      this.#table.classList.toggle("dense", this.hasAttribute("dense"));
      if (this.#fast) this.#setRowHeight();
    }
    if (name === "sort") {
      this.#sort = this.#parseSort();
      this.#resort();
      this.#renderHead();
      this.#redraw();
    }
    if (name === "empty") this.#renderEmpty();
    if (name === "caption") this.#renderCaption();
    if (name === "high-rate" && (before === null) !== (after === null)) this.#build();
    if (name === "row-height" && this.#fast) {
      this.#setRowHeight();
      this.#redraw();
    }
    if (name === "freeze-sort" && after === null && !this.#orderSorted) {
      // Unfrozen: the order the rows have been held in gives way to the sort.
      this.#resort();
      this.#redraw();
    }
  }

  #parseSort() {
    const [key, dir] = (this.getAttribute("sort") || "").split(":");
    return { key: key || null, direction: key ? (dir === "desc" ? "descending" : "ascending") : null };
  }

  #build() {
    if (!this.#table) this.#declared();
    this.#resize?.disconnect();
    this.#resize = null;
    this.textContent = "";
    this.#fast = this.hasAttribute("high-rate");
    this.#trs.clear();
    this.#drawn = { first: -1, last: -1, version: -1 };
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    this.#wrap = wrap;
    this.#table = document.createElement("table");
    this.#table.className = "om-grid";
    this.#table.classList.toggle("dense", this.hasAttribute("dense"));
    this.#table.classList.toggle("one-line", this.hasAttribute("one-line"));
    this.#caption = document.createElement("caption");
    this.#caption.className = "visually-hidden";
    this.#thead = document.createElement("thead");
    this.#tbody = document.createElement("tbody");
    this.#table.append(this.#caption, this.#thead, this.#tbody);
    wrap.append(this.#table);
    this.append(wrap);
    if (!this.#sort.key) this.#sort = this.#parseSort();
    this.#tbody.addEventListener("click", (e) => {
      const tr = e.target.closest && e.target.closest("tr[data-key]");
      if (!tr) return;
      const key = tr.dataset.key;
      if (this.#fast) this.#active = key;
      this.#emitRow(key);
    });
    if (this.#fast) this.#buildFast();
    this.#resort();
    this.#renderCaption();
    this.#renderHead();
    this.#renderAll();
  }

  // The columns and rows declared in the page's JSON, where script has not set them.
  #declared() {
    const data = declaredJson(this);
    if (!data) return;
    if (Array.isArray(data.columns) && !this.#columnsSet) this.#columns = data.columns.map(normaliseColumn);
    if (Array.isArray(data.rows) && !this.#rowsSet) this.#replaceRows(data.rows);
  }

  #buildFast() {
    this.#wrap.classList.add("om-grid-viewport");
    // One tab stop for the grid: the view scrolls from the keyboard, and the
    // arrow keys move from row to row.
    this.#wrap.tabIndex = 0;
    this.#wrap.setAttribute("role", "region");
    this.#wrap.setAttribute("aria-label", this.getAttribute("caption") || "Table");
    this.#setRowHeight();
    this.#wrap.addEventListener("scroll", () => this.#scrolled(), { passive: true });
    this.#wrap.addEventListener("keydown", (e) => this.#key(e));
    if (globalThis.ResizeObserver) {
      this.#resize = new ResizeObserver(() => {
        this.#viewH = 0;
        this.#headH = 0;
        this.#scrolled();
      });
      this.#resize.observe(this.#wrap);
    }
  }

  #setRowHeight() {
    const given = Number(this.getAttribute("row-height"));
    this.#rowH = Number.isFinite(given) && given >= 12 ? given : this.hasAttribute("dense") ? 28 : 36;
    this.#rowMeasured = false;
    this.style.setProperty("--om-grid-row-height", `${this.#rowH}px`);
  }

  // ── The API ──────────────────────────────────────────────────────────────

  get columns() {
    return this.#columns.slice();
  }

  set columns(value) {
    this.#columnsSet = true;
    this.#columns = (value || []).map(normaliseColumn);
    this.#resort();
    if (!this.#table) return;
    this.#renderHead();
    this.#renderAll();
  }

  /** The field naming each row, or a function of the row returning its key. */
  get rowKey() {
    return this.#keyFn || this.getAttribute("row-key") || "id";
  }

  set rowKey(value) {
    if (typeof value === "function") this.#keyFn = value;
    else {
      this.#keyFn = null;
      this.setAttribute("row-key", String(value));
    }
  }

  /** Whether high-rate mode is on (the `high-rate` attribute). */
  get highRate() {
    return this.hasAttribute("high-rate");
  }

  set highRate(on) {
    this.toggleAttribute("high-rate", Boolean(on));
  }

  /** Whether the order is held while rows change (the `freeze-sort` attribute). */
  get freezeSort() {
    return this.hasAttribute("freeze-sort");
  }

  set freezeSort(on) {
    this.toggleAttribute("freeze-sort", Boolean(on));
  }

  #keyOf(row) {
    const k = this.#keyFn ? this.#keyFn(row) : row?.[this.getAttribute("row-key") || "id"];
    if (isBlank(k)) throw new TypeError(`om-grid: a row has no key (${this.#keyFn ? "rowKey()" : `"${this.getAttribute("row-key") || "id"}"`})`);
    return String(k);
  }

  /** The rows in the order shown. */
  get rows() {
    return this.#order.map((k) => this.#rows.get(k));
  }

  set rows(value) {
    this.setRows(value);
  }

  /** How many rows the grid holds (in high-rate mode, most are not in the document). */
  get size() {
    return this.#rows.size;
  }

  getRow(key) {
    return this.#rows.get(String(key));
  }

  /** Replace every row (a snapshot). Pending updates are dropped: the snapshot is newer. */
  setRows(rows) {
    this.#rowsSet = true;
    this.#replaceRows(rows);
    if (this.#table) this.#renderAll();
  }

  #replaceRows(rows) {
    this.#pending.clear();
    this.#pendingRemove.clear();
    this.#rows.clear();
    this.#seq.clear();
    for (const row of rows || []) {
      const key = this.#keyOf(row);
      if (!this.#seq.has(key)) this.#seq.set(key, this.#arrivals++);
      this.#rows.set(key, row);
    }
    this.#resort();
  }

  /** Insert or replace rows by key, applied on the next frame, last state per key winning. */
  upsert(rows) {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      const key = this.#keyOf(row);
      this.#pendingRemove.delete(key);
      this.#pending.set(key, row);
    }
    this.#schedule();
  }

  /** Remove rows by key, on the next frame. */
  remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.#pending.delete(String(key));
      this.#pendingRemove.add(String(key));
    }
    this.#schedule();
  }

  /** Apply queued updates (and, in high-rate mode, a scroll) now rather than on the next frame. */
  flush() {
    if (this.#frame !== null) {
      (globalThis.cancelAnimationFrame || clearTimeout)(this.#frame);
      this.#frame = null;
    }
    if (!this.#pending.size && !this.#pendingRemove.size) {
      if (this.#fast && this.#windowDirty && this.#table) this.#renderWindow();
      return;
    }
    const updates = [...this.#pending];
    const removals = [...this.#pendingRemove];
    this.#pending.clear();
    this.#pendingRemove.clear();
    const { changed, added, moved } = this.#apply(updates, removals);
    if (!this.#table) return;

    if (this.#fast) {
      const shown = new Set(this.#trs.keys());
      this.#renderWindow();
      const flash = !this.hasAttribute("no-flash") && !reducedMotion();
      for (const [key, before] of changed) {
        const tr = shown.has(key) && this.#trs.get(key);
        if (tr) this.#patchRow(tr, before, this.#rows.get(key), flash);
      }
      this.#renderEmpty();
      return;
    }

    for (const key of removals) {
      this.#trs.get(key)?.remove();
      this.#trs.delete(key);
    }
    for (const key of changed.keys()) {
      const tr = this.#trs.get(key);
      if (tr) this.#fillRow(tr, this.#rows.get(key));
    }
    for (const key of added) {
      const tr = this.#makeRow(key, this.#rows.get(key));
      this.#trs.set(key, tr);
      this.#tbody.append(tr);
    }
    if (moved || added.size) this.#syncOrder();
    this.#renderEmpty();
  }

  /** Sort by a column: "ascending", "descending", or null for arrival order. */
  sortBy(key, direction = "ascending") {
    this.#sort = { key: key || null, direction: key ? direction : null };
    this.#resort();
    if (!this.#table) return;
    this.#renderHead();
    this.#redraw();
  }

  get sort() {
    return { ...this.#sort };
  }

  /** In high-rate mode, bring a row into view (and the keyboard to it, with focus: true). */
  scrollToRow(key, { focus = false } = {}) {
    key = String(key);
    const index = this.#locate(key);
    if (index < 0) return false;
    if (!this.#fast || !this.#table) {
      this.#trs.get(key)?.scrollIntoView?.({ block: "nearest" });
      return true;
    }
    this.#active = key;
    const view = this.#viewHeight();
    const head = this.#headHeight();
    const top = index * this.#rowH;
    const scroll = this.#wrap.scrollTop;
    if (top < scroll) this.#wrap.scrollTop = top;
    else if (top + this.#rowH > scroll + view - head) this.#wrap.scrollTop = top + this.#rowH - (view - head);
    this.#renderWindow(index);
    if (focus) this.#trs.get(key)?.focus({ preventScroll: true });
    return true;
  }

  // ── The data, and its order ──────────────────────────────────────────────

  #sortColumn() {
    const { key, direction } = this.#sort;
    if (!key || !direction) return null;
    return this.#columns.find((c) => c.key === key) || { key, type: "text" };
  }

  #sortValue(col, row) {
    const v = row?.[col.key];
    if (isBlank(v)) return BLANK;
    if (col.compare) return { raw: v };
    if (NUMERIC.has(col.type)) return { d: parseDecimal(v) };
    return { s: String(v) };
  }

  #compareValues(col, a, b) {
    if (col.compare) return col.compare(a.raw, b.raw);
    if (NUMERIC.has(col.type)) return compareParsed(a.d, b.d);
    return COLLATOR.compare(a.s, b.s);
  }

  // The display order's comparator: the sort column's value, exactly, then
  // arrival, so it is a total order and a key is found by binary search.
  // Blanks last, whichever the direction.
  #compareKeys(ka, kb) {
    const col = this.#sortColumn();
    if (!col) return this.#seq.get(ka) - this.#seq.get(kb);
    const a = this.#sortVals.get(ka);
    const b = this.#sortVals.get(kb);
    if (a === BLANK || b === BLANK) {
      if (a === BLANK && b === BLANK) return this.#seq.get(ka) - this.#seq.get(kb);
      return a === BLANK ? 1 : -1;
    }
    const flip = this.#sort.direction === "descending" ? -1 : 1;
    return this.#compareValues(col, a, b) * flip || this.#seq.get(ka) - this.#seq.get(kb);
  }

  #resort() {
    const col = this.#sortColumn();
    this.#sortVals.clear();
    if (col) for (const [k, row] of this.#rows) this.#sortVals.set(k, this.#sortValue(col, row));
    this.#order = [...this.#rows.keys()].sort((a, b) => this.#compareKeys(a, b));
    this.#orderSorted = true;
    this.#orderVersion++;
  }

  /** The first index whose key does not sort before `key`. */
  #lowerBound(key) {
    let lo = 0;
    let hi = this.#order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#compareKeys(this.#order[mid], key) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Where a key is in the order shown, or -1. */
  #locate(key) {
    if (!this.#rows.has(key)) return -1;
    if (this.#orderSorted) {
      const i = this.#lowerBound(key);
      if (this.#order[i] === key) return i;
    }
    return this.#order.indexOf(key);
  }

  // Applies queued changes to the rows and their order, touching no DOM.
  #apply(updates, removals) {
    const changed = new Map(); // key -> the row before
    const added = new Set();
    let moved = false;
    const col = this.#sortColumn();
    const frozen = this.hasAttribute("freeze-sort");
    for (const key of removals) {
      const i = this.#locate(key);
      if (i < 0) continue;
      this.#order.splice(i, 1);
      this.#rows.delete(key);
      this.#sortVals.delete(key);
      this.#orderVersion++;
    }
    for (const [key, row] of updates) {
      const before = this.#rows.get(key);
      if (before === undefined) {
        this.#seq.set(key, this.#arrivals++);
        this.#rows.set(key, row);
        if (col) this.#sortVals.set(key, this.#sortValue(col, row));
        if (col && this.#orderSorted && !frozen) this.#order.splice(this.#lowerBound(key), 0, key);
        else {
          // Arrival order, or a held order: a new row goes last.
          this.#order.push(key);
          if (col) this.#orderSorted = false;
        }
        added.add(key);
        this.#orderVersion++;
        continue;
      }
      this.#rows.set(key, row);
      if (before !== row) changed.set(key, before);
      if (!col) continue;
      const was = this.#sortVals.get(key);
      const now = this.#sortValue(col, row);
      const same = was === BLANK || now === BLANK ? was === now : this.#compareValues(col, was, now) === 0;
      if (same) continue;
      if (frozen || !this.#orderSorted) {
        this.#sortVals.set(key, now);
        this.#orderSorted = false;
        continue;
      }
      const i = this.#locate(key);
      this.#order.splice(i, 1);
      this.#sortVals.set(key, now);
      const j = this.#lowerBound(key);
      this.#order.splice(j, 0, key);
      if (i !== j) {
        moved = true;
        this.#orderVersion++;
      }
    }
    return { changed, added, moved };
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  #schedule() {
    if (this.#frame !== null) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    this.#frame = raf(() => {
      this.#frame = null;
      this.flush();
    });
  }

  #redraw() {
    if (!this.#table) return;
    if (this.#fast) this.#renderWindow();
    else this.#syncOrder();
  }

  #renderCaption() {
    const text = this.getAttribute("caption");
    this.#caption.textContent = text || "";
    this.#caption.hidden = !text;
    if (this.#fast) this.#wrap.setAttribute("aria-label", text || "Table");
  }

  #renderHead() {
    const tr = document.createElement("tr");
    if (this.#fast) tr.setAttribute("aria-rowindex", "1");
    for (const col of this.#columns) {
      const th = document.createElement("th");
      th.scope = "col";
      if (col.align === "right") th.className = "num";
      if (col.width) th.style.width = col.width;
      if (col.priority) th.dataset.priority = String(col.priority);
      if (col.sortable) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "om-sort";
        b.textContent = col.label;
        b.addEventListener("click", () => this.#clickSort(col.key));
        th.append(b);
        if (this.#sort.key === col.key && this.#sort.direction) th.setAttribute("aria-sort", this.#sort.direction);
      } else {
        th.textContent = col.label;
      }
      tr.append(th);
    }
    this.#thead.replaceChildren(tr);
    this.#headH = 0;
  }

  #clickSort(key) {
    const direction = this.#sort.key === key && this.#sort.direction === "ascending" ? "descending" : "ascending";
    const go = this.dispatchEvent(
      new CustomEvent("om-sort", { bubbles: true, cancelable: true, detail: { key, direction } }),
    );
    this.#sort = { key, direction };
    this.#renderHead();
    if (go) {
      // Asked for by the person, so it sorts even when the order is frozen.
      this.#resort();
      this.#redraw();
    } else {
      // A page sorting on its server calls preventDefault and sets the rows
      // itself; until then the rows keep the order they have.
      const col = this.#sortColumn();
      this.#sortVals.clear();
      for (const [k, row] of this.#rows) this.#sortVals.set(k, this.#sortValue(col, row));
      this.#orderSorted = false;
    }
  }

  #renderAll() {
    this.#trs.clear();
    if (this.#fast) {
      this.#topSpacer = this.#spacer();
      this.#bottomSpacer = this.#spacer();
      this.#tbody.replaceChildren(this.#topSpacer, this.#bottomSpacer);
      this.#drawn = { first: -1, last: -1, version: -1 };
      this.#renderWindow();
      this.#renderEmpty();
      return;
    }
    const frag = document.createDocumentFragment();
    for (const key of this.#order) {
      const tr = this.#makeRow(key, this.#rows.get(key));
      this.#trs.set(key, tr);
      frag.append(tr);
    }
    this.#tbody.replaceChildren(frag);
    this.#renderEmpty();
  }

  #renderEmpty() {
    const existing = this.#tbody.querySelector(":scope > tr.om-grid-empty");
    if (this.#rows.size) {
      existing?.remove();
      return;
    }
    const tr = existing || document.createElement("tr");
    tr.className = "om-grid-empty";
    const td = document.createElement("td");
    td.colSpan = Math.max(1, this.#columns.length);
    td.textContent = this.getAttribute("empty") || "Nothing to show.";
    tr.replaceChildren(td);
    if (!existing) this.#tbody.append(tr);
  }

  // Every row in the document, in the order shown (all rows: not high-rate).
  #syncOrder() {
    const current = [...this.#tbody.querySelectorAll(":scope > tr[data-key]")].map((tr) => tr.dataset.key);
    if (current.length === this.#order.length && current.every((k, i) => k === this.#order[i])) return;
    // Moving rows keeps each <tr> (and focus, selection) rather than redrawing.
    for (const key of this.#order) {
      const tr = this.#trs.get(key);
      if (tr) this.#tbody.append(tr);
    }
  }

  #makeRow(key, row) {
    const tr = document.createElement("tr");
    tr.dataset.key = key;
    if (this.#fast) tr.tabIndex = -1;
    this.#fillRow(tr, row);
    return tr;
  }

  #fillRow(tr, row) {
    // Cells are updated in place: an unchanged cell is not touched.
    const cols = this.#columns;
    while (tr.cells.length > cols.length) tr.lastElementChild.remove();
    cols.forEach((col, i) => {
      let td = tr.cells[i];
      if (!td) {
        td = document.createElement("td");
        // For the narrow layouts: a card names each value by its column, and
        // a column's priority says when it hides.
        if (!this.#fast) td.dataset.label = col.label;
        if (col.priority) td.dataset.priority = String(col.priority);
        tr.append(td);
      }
      this.#fillCell(td, col, row);
    });
  }

  // High-rate: only the cells whose value (or a field their column watches)
  // changed are touched, and those flash.
  #patchRow(tr, before, row, flash) {
    this.#columns.forEach((col, i) => {
      const was = before?.[col.key];
      const now = row?.[col.key];
      const moved = was !== now || (WATCHED.get(col) || []).some((k) => before?.[k] !== row?.[k]);
      if (!moved) return;
      const td = tr.cells[i];
      if (!td) return;
      this.#fillCell(td, col, row);
      if (!flash || was === now) return;
      let dir = "same";
      if (NUMERIC.has(col.type)) {
        const c = compareDecimal(now, was);
        if (parseDecimal(now) && parseDecimal(was)) dir = c > 0 ? "up" : c < 0 ? "down" : "same";
      }
      // Two names per direction, alternated, so a repeat restarts the
      // animation without forcing a layout.
      td.dataset.flash = td.dataset.flash === `${dir}-1` ? `${dir}-2` : `${dir}-1`;
    });
  }

  #fillCell(td, col, row) {
    const value = row?.[col.key];
    let content = col.format ? col.format(value, row) : value;
    const classes = [];
    if (col.align === "right") classes.push("num");
    if (NUMERIC.has(col.type)) {
      if (!col.format && col.group && !isBlank(value)) content = groupDigits(value);
      if (col.tone === "sign") {
        const s = signOf(value);
        if (s === 1) classes.push("up");
        if (s === -1) classes.push("down");
      }
    }
    if (col.type === "code") classes.push("mono");
    const className = classes.join(" ");
    if (td.className !== className) td.className = className;

    if (rich(col)) {
      this.#fillRich(td, col, row, value, content);
      return;
    }
    if (col.type === "badge" && !isBlank(value)) {
      const tone = typeof col.tone === "function" ? col.tone(value, row) : "";
      const cls = `badge${tone ? ` ${tone}` : ""}`;
      // A format may give the badge's text, or a node to put inside it.
      if (content && typeof content === "object" && "nodeType" in content) {
        const b = span(cls, "");
        b.append(content);
        td.replaceChildren(b);
        return;
      }
      const shown = td.firstElementChild;
      const text = String(content);
      if (shown && shown.className === cls && shown.textContent === text && td.childNodes.length === 1) return;
      td.replaceChildren(span(cls, text));
      return;
    }
    if (content && typeof content === "object" && "nodeType" in content) {
      td.replaceChildren(content);
      return;
    }
    const text = isBlank(content) ? "" : String(content);
    if (td.childElementCount || td.textContent !== text) td.textContent = text;
  }

  // A cell drawing more than its value, from plain JSON: the value (a badge,
  // strong, or in its tone's colour), or the column's `blank` text for an
  // empty one, then the row's `hint` field under it.
  #fillRich(td, col, row, value, content) {
    const parts = [];
    if (isBlank(value)) {
      if (col.blank) parts.push(span("faint", String(col.blank)));
    } else {
      const field = toneField(col);
      const fromField = field ? String(row?.[field] ?? "") : "";
      const tone = typeof col.tone === "function" ? col.tone(value, row) || "" : TONES.has(fromField) ? fromField : "";
      const node = content && typeof content === "object" && "nodeType" in content;
      if (col.type === "badge") {
        const b = span(`badge${tone ? ` ${tone}` : ""}`, node ? "" : String(content ?? ""));
        if (node) b.append(content);
        parts.push(b);
      } else if (node) {
        parts.push(content);
      } else {
        const text = isBlank(content) ? "" : String(content);
        const ink = field ? INKS[tone] || "" : "";
        if (col.strong) {
          const s = document.createElement("strong");
          if (ink) s.className = ink;
          s.textContent = text;
          parts.push(s);
        } else parts.push(ink ? span(ink, text) : document.createTextNode(text));
      }
    }
    const hint = typeof col.hint === "string" && col.hint ? row?.[col.hint] : "";
    if (!isBlank(hint)) parts.push(span("hint", String(hint)));
    td.replaceChildren(...parts);
  }

  // ── High-rate: the window of rows in the document ────────────────────────

  #spacer() {
    const tr = document.createElement("tr");
    tr.className = "om-grid-spacer";
    tr.setAttribute("aria-hidden", "true");
    const td = document.createElement("td");
    td.colSpan = Math.max(1, this.#columns.length);
    tr.append(td);
    return tr;
  }

  #scrolled() {
    this.#windowDirty = true;
    this.#schedule();
  }

  #viewHeight() {
    if (!this.#viewH) this.#viewH = this.#wrap.clientHeight || 0;
    return this.#viewH || this.#rowH * FIRST_SCREEN;
  }

  #headHeight() {
    if (!this.#headH) this.#headH = this.#thead.offsetHeight || 0;
    return this.#headH;
  }

  #renderWindow(mustInclude = -1) {
    this.#windowDirty = false;
    const n = this.#order.length;
    const rowH = this.#rowH;
    // Read before writing: one layout a frame.
    const scrollTop = this.#wrap.scrollTop || 0;
    const view = this.#viewHeight();
    const top = Math.max(0, scrollTop - this.#headHeight());
    let first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
    let last = Math.min(n, Math.ceil((top + view) / rowH) + OVERSCAN);
    if (mustInclude >= 0 && (mustInclude < first || mustInclude >= last)) {
      first = Math.max(0, mustInclude - OVERSCAN);
      last = Math.min(n, first + Math.ceil(view / rowH) + 2 * OVERSCAN);
    }
    this.#table.setAttribute("aria-rowcount", String(n + 1));
    const d = this.#drawn;
    if (d.first === first && d.last === last && d.version === this.#orderVersion) return;
    this.#drawn = { first, last, version: this.#orderVersion };

    const keys = this.#order.slice(first, last);
    const want = new Set(keys);
    const focused = document.activeElement;
    for (const [k, tr] of this.#trs) {
      if (want.has(k)) continue;
      // The keyboard's row is leaving the document: keep focus in the grid.
      if (tr === focused) this.#wrap.focus({ preventScroll: true });
      tr.remove();
      this.#trs.delete(k);
    }
    let prev = this.#topSpacer;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      let tr = this.#trs.get(k);
      if (!tr) {
        tr = this.#makeRow(k, this.#rows.get(k));
        this.#trs.set(k, tr);
      }
      if (prev.nextSibling !== tr) prev.after(tr);
      const index = String(first + i + 2); // the head is row 1
      if (tr.getAttribute("aria-rowindex") !== index) tr.setAttribute("aria-rowindex", index);
      prev = tr;
    }
    this.#topSpacer.firstChild.style.height = `${first * rowH}px`;
    this.#bottomSpacer.firstChild.style.height = `${(n - last) * rowH}px`;
    for (const s of [this.#topSpacer, this.#bottomSpacer]) s.firstChild.colSpan = Math.max(1, this.#columns.length);

    // The row height is fixed, but a scheme's type decides the pixels: the
    // first drawn row is measured once, so the spacers add up exactly.
    if (!this.#rowMeasured && keys.length) {
      const h = this.#trs.get(keys[0]).getBoundingClientRect?.().height || 0;
      if (h > 0) {
        this.#rowMeasured = true;
        if (Math.abs(h - this.#rowH) > 0.01) {
          this.#rowH = h;
          this.#drawn.version = -1;
          this.#renderWindow(mustInclude);
        }
      }
    }
  }

  #emitRow(key) {
    this.dispatchEvent(new CustomEvent("om-row", { bubbles: true, detail: { key, row: this.#rows.get(key) } }));
  }

  #key(e) {
    if (e.target.closest && e.target.closest("thead")) return;
    const n = this.#order.length;
    if (!n) return;
    const pageRows = Math.max(1, Math.floor((this.#viewHeight() - this.#headHeight()) / this.#rowH) - 1);
    let at = this.#active !== null ? this.#locate(this.#active) : -1;
    // No row yet (or it was removed): the arrows start at the first row in view.
    const fresh = at < 0;
    if (fresh) at = Math.min(n - 1, Math.floor((this.#wrap.scrollTop || 0) / this.#rowH));
    let to;
    switch (e.key) {
      case "ArrowDown": to = fresh ? at : at + 1; break;
      case "ArrowUp": to = fresh ? at : at - 1; break;
      case "PageDown": to = at + pageRows; break;
      case "PageUp": to = at - pageRows; break;
      case "Home": to = 0; break;
      case "End": to = n - 1; break;
      case "Enter":
      case " ":
        if (this.#active !== null && this.#rows.has(this.#active)) {
          e.preventDefault();
          this.#emitRow(this.#active);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    to = Math.max(0, Math.min(n - 1, to));
    this.scrollToRow(this.#order[to], { focus: true });
  }
}

if (!customElements.get("om-grid")) customElements.define("om-grid", OmGrid);
