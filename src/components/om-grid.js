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

import { compareDecimal, groupDigits, signOf } from "../lib/decimal.js";

const NUMERIC = new Set(["number", "decimal"]);

function normaliseColumn(c) {
  if (!c || typeof c.key !== "string") throw new TypeError("om-grid: every column needs a string key");
  const type = c.type || "text";
  return {
    ...c,
    type,
    label: c.label ?? c.key,
    align: c.align || (NUMERIC.has(type) ? "right" : "left"),
    sortable: c.sortable !== false,
  };
}

function isBlank(v) {
  return v === undefined || v === null || v === "";
}

export class OmGrid extends HTMLElement {
  static get observedAttributes() {
    return ["dense", "sort", "empty", "caption"];
  }

  #columns = [];
  #rows = new Map(); // key -> row, in arrival order
  #seq = new Map(); // key -> arrival number, for a stable sort
  #arrivals = 0;
  #trs = new Map(); // key -> <tr>
  #pending = new Map();
  #pendingRemove = new Set();
  #frame = null;
  #sort = { key: null, direction: null };
  #keyFn = null;
  #table = null;
  #thead = null;
  #tbody = null;
  #caption = null;

  connectedCallback() {
    if (!this.#table) this.#build();
  }

  attributeChangedCallback(name) {
    if (!this.#table) return;
    if (name === "dense") this.#table.classList.toggle("dense", this.hasAttribute("dense"));
    if (name === "sort") {
      const [key, dir] = (this.getAttribute("sort") || "").split(":");
      this.#sort = { key: key || null, direction: key ? (dir === "desc" ? "descending" : "ascending") : null };
      this.#renderHead();
      this.#reorder();
    }
    if (name === "empty") this.#renderEmpty();
    if (name === "caption") this.#renderCaption();
  }

  #build() {
    this.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    this.#table = document.createElement("table");
    this.#table.className = "om-grid";
    this.#table.classList.toggle("dense", this.hasAttribute("dense"));
    this.#caption = document.createElement("caption");
    this.#caption.className = "visually-hidden";
    this.#thead = document.createElement("thead");
    this.#tbody = document.createElement("tbody");
    this.#table.append(this.#caption, this.#thead, this.#tbody);
    wrap.append(this.#table);
    this.append(wrap);
    const [key, dir] = (this.getAttribute("sort") || "").split(":");
    if (key) this.#sort = { key, direction: dir === "desc" ? "descending" : "ascending" };
    this.#tbody.addEventListener("click", (e) => {
      const tr = e.target.closest && e.target.closest("tr[data-key]");
      if (!tr) return;
      const key = tr.dataset.key;
      this.dispatchEvent(new CustomEvent("om-row", { bubbles: true, detail: { key, row: this.#rows.get(key) } }));
    });
    this.#renderCaption();
    this.#renderHead();
    this.#renderAll();
  }

  // ── The API ──────────────────────────────────────────────────────────────

  get columns() {
    return this.#columns.slice();
  }

  set columns(value) {
    this.#columns = (value || []).map(normaliseColumn);
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

  #keyOf(row) {
    const k = this.#keyFn ? this.#keyFn(row) : row?.[this.getAttribute("row-key") || "id"];
    if (isBlank(k)) throw new TypeError(`om-grid: a row has no key (${this.#keyFn ? "rowKey()" : `"${this.getAttribute("row-key") || "id"}"`})`);
    return String(k);
  }

  /** The rows in the order shown. */
  get rows() {
    return this.#orderedKeys().map((k) => this.#rows.get(k));
  }

  set rows(value) {
    this.setRows(value);
  }

  getRow(key) {
    return this.#rows.get(String(key));
  }

  /** Replace every row (a snapshot). Pending updates are dropped: the snapshot is newer. */
  setRows(rows) {
    this.#pending.clear();
    this.#pendingRemove.clear();
    this.#rows.clear();
    this.#seq.clear();
    for (const row of rows || []) {
      const key = this.#keyOf(row);
      this.#rows.set(key, row);
      this.#seq.set(key, this.#arrivals++);
    }
    if (this.#table) this.#renderAll();
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

  /** Apply queued updates now rather than on the next frame. */
  flush() {
    if (this.#frame !== null) {
      (globalThis.cancelAnimationFrame || clearTimeout)(this.#frame);
      this.#frame = null;
    }
    if (!this.#pending.size && !this.#pendingRemove.size) return;
    const updates = [...this.#pending];
    const removals = [...this.#pendingRemove];
    this.#pending.clear();
    this.#pendingRemove.clear();
    if (!this.#table) {
      for (const [key, row] of updates) {
        if (!this.#seq.has(key)) this.#seq.set(key, this.#arrivals++);
        this.#rows.set(key, row);
      }
      for (const key of removals) this.#rows.delete(key);
      return;
    }
    let orderMayChange = false;
    for (const key of removals) {
      if (!this.#rows.delete(key)) continue;
      this.#trs.get(key)?.remove();
      this.#trs.delete(key);
    }
    for (const [key, row] of updates) {
      const before = this.#rows.get(key);
      this.#rows.set(key, row);
      const tr = this.#trs.get(key);
      if (tr) {
        this.#fillRow(tr, row);
        if (this.#sort.key && before?.[this.#sort.key] !== row[this.#sort.key]) orderMayChange = true;
      } else {
        this.#seq.set(key, this.#arrivals++);
        const fresh = this.#makeRow(key, row);
        this.#trs.set(key, fresh);
        this.#tbody.append(fresh);
        orderMayChange = true;
      }
    }
    if (orderMayChange) this.#reorder();
    this.#renderEmpty();
  }

  /** Sort by a column: "ascending", "descending", or null for arrival order. */
  sortBy(key, direction = "ascending") {
    this.#sort = { key: key || null, direction: key ? direction : null };
    this.#renderHead();
    this.#reorder();
  }

  get sort() {
    return { ...this.#sort };
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

  #renderCaption() {
    const text = this.getAttribute("caption");
    this.#caption.textContent = text || "";
    this.#caption.hidden = !text;
  }

  #renderHead() {
    const tr = document.createElement("tr");
    for (const col of this.#columns) {
      const th = document.createElement("th");
      th.scope = "col";
      if (col.align === "right") th.className = "num";
      if (col.width) th.style.width = col.width;
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
  }

  #clickSort(key) {
    const direction = this.#sort.key === key && this.#sort.direction === "ascending" ? "descending" : "ascending";
    const go = this.dispatchEvent(
      new CustomEvent("om-sort", { bubbles: true, cancelable: true, detail: { key, direction } }),
    );
    // A page sorting on its server calls preventDefault and sets the rows itself.
    this.#sort = { key, direction };
    this.#renderHead();
    if (go) this.#reorder();
  }

  #renderAll() {
    this.#trs.clear();
    const frag = document.createDocumentFragment();
    for (const key of this.#orderedKeys()) {
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

  #makeRow(key, row) {
    const tr = document.createElement("tr");
    tr.dataset.key = key;
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
        tr.append(td);
      }
      this.#fillCell(td, col, row);
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

    if (col.type === "badge" && !isBlank(value)) {
      const tone = typeof col.tone === "function" ? col.tone(value, row) : "";
      const span = td.firstElementChild;
      const cls = `badge${tone ? ` ${tone}` : ""}`;
      const text = String(content);
      if (span && span.className === cls && span.textContent === text && td.childNodes.length === 1) return;
      const b = document.createElement("span");
      b.className = cls;
      b.textContent = text;
      td.replaceChildren(b);
      return;
    }
    if (content && typeof content === "object" && "nodeType" in content) {
      td.replaceChildren(content);
      return;
    }
    const text = isBlank(content) ? "" : String(content);
    if (td.childElementCount || td.textContent !== text) td.textContent = text;
  }

  #orderedKeys() {
    const keys = [...this.#rows.keys()];
    const { key, direction } = this.#sort;
    if (!key || !direction) return keys.sort((a, b) => this.#seq.get(a) - this.#seq.get(b));
    const col = this.#columns.find((c) => c.key === key) || { type: "text" };
    const flip = direction === "descending" ? -1 : 1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return keys.sort((ka, kb) => {
      const a = this.#rows.get(ka)?.[key];
      const b = this.#rows.get(kb)?.[key];
      // Blanks last, whichever the direction.
      if (isBlank(a) || isBlank(b)) {
        if (isBlank(a) && isBlank(b)) return this.#seq.get(ka) - this.#seq.get(kb);
        return isBlank(a) ? 1 : -1;
      }
      let c;
      if (col.compare) c = col.compare(a, b);
      else if (NUMERIC.has(col.type)) c = compareDecimal(a, b);
      else c = collator.compare(String(a), String(b));
      return c * flip || this.#seq.get(ka) - this.#seq.get(kb);
    });
  }

  #reorder() {
    if (!this.#tbody) return;
    const keys = this.#orderedKeys();
    const current = [...this.#tbody.querySelectorAll(":scope > tr[data-key]")].map((tr) => tr.dataset.key);
    if (current.length === keys.length && current.every((k, i) => k === keys[i])) return;
    // Moving rows keeps each <tr> (and focus, selection) rather than redrawing.
    for (const key of keys) {
      const tr = this.#trs.get(key);
      if (tr) this.#tbody.append(tr);
    }
  }
}

if (!customElements.get("om-grid")) customElements.define("om-grid", OmGrid);
