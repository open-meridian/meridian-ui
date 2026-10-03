// The entry grid's rules, apart from the element (components/om-entry-grid.js):
// what each column type accepts and what it says when it does not, how a
// path names a cell, and how pasted cells and a CSV are read. Pure functions,
// so a page, a test or a server-side check can use the same words.
//
// A value is always a string, as typed: a decimal is checked as a string and
// never becomes a float (lib/decimal.js), a date is ISO 8601's YYYY-MM-DD.

import { compareDecimal, parseDecimal } from "./decimal.js";

/** The column types an entry grid knows. */
export const ENTRY_TYPES = Object.freeze(["text", "decimal", "date", "code", "choice", "readonly"]);

// A field's name in a path (meridian-design's data dictionary, "Paths"), and a path.
const FIELD = "[A-Za-z_][A-Za-z0-9_]*";
const STEP = `${FIELD}(?:\\[\\d+\\])?`;
const PATH = new RegExp(`^${STEP}(?:\\.${STEP})*$`);
const KEY = new RegExp(`^${FIELD}$`);
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CODE = /^[A-Z0-9][A-Z0-9._-]*$/;
/** A code's longest, when its column says none. */
export const CODE_LONGEST = 32;

/** Whether `text` is a path: `field`, `field[n]`, joined by `.`. */
export function isPath(text) {
  return typeof text === "string" && PATH.test(text);
}

function wholeNumber(v) {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function realDay(text) {
  const m = DAY.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * A column as the grid uses it, from a page's plain JSON: `key` (a field's
 * name), `label`, `type`, `required`, `hint`, `path` (where the column sits
 * under a row, in the data dictionary's grammar; default the key), and by
 * type `places`, `min`, `max`, `max_length`, `length`, `options`, with
 * `default` and `placeholder`. A column the grid cannot use is refused
 * (TypeError) rather than guessed.
 */
export function normaliseEntryColumn(c) {
  if (!c || typeof c.key !== "string" || !KEY.test(c.key)) {
    throw new TypeError(`om-entry-grid: every column needs a key that is a field's name (letters, digits and _), not ${JSON.stringify(c && c.key)}`);
  }
  const type = c.type === undefined || c.type === null || c.type === "" ? "text" : c.type;
  if (!ENTRY_TYPES.includes(type)) throw new TypeError(`om-entry-grid: column "${c.key}" has a type the grid does not know: ${JSON.stringify(type)}`);
  const path = c.path === undefined || c.path === null || c.path === "" ? c.key : c.path;
  if (!isPath(path)) throw new TypeError(`om-entry-grid: column "${c.key}" has a path that is not one: ${JSON.stringify(path)}`);
  const col = {
    key: c.key,
    label: typeof c.label === "string" && c.label ? c.label : c.key,
    type,
    path,
    required: type !== "readonly" && c.required === true,
    hint: typeof c.hint === "string" ? c.hint : "",
    placeholder: typeof c.placeholder === "string" ? c.placeholder : "",
    default: c.default === undefined || c.default === null ? "" : String(c.default),
    width: typeof c.width === "string" ? c.width : "",
  };
  if (type === "decimal") {
    if (c.places !== undefined) {
      col.places = wholeNumber(c.places);
      if (col.places === null) throw new TypeError(`om-entry-grid: column "${c.key}": places is a whole number`);
    }
    for (const bound of ["min", "max"]) {
      if (c[bound] === undefined || c[bound] === null) continue;
      const text = String(c[bound]);
      if (!DECIMAL.test(text)) throw new TypeError(`om-entry-grid: column "${c.key}": ${bound} is a decimal string, not ${JSON.stringify(c[bound])}`);
      col[bound] = text;
    }
  }
  if (type === "date") {
    for (const bound of ["min", "max"]) {
      if (c[bound] === undefined || c[bound] === null) continue;
      if (!realDay(String(c[bound]))) throw new TypeError(`om-entry-grid: column "${c.key}": ${bound} is a date, YYYY-MM-DD`);
      col[bound] = String(c[bound]);
    }
  }
  if (type === "text" || type === "code") {
    if (c.max_length !== undefined) {
      col.max_length = wholeNumber(c.max_length);
      if (!col.max_length) throw new TypeError(`om-entry-grid: column "${c.key}": max_length is a whole number above 0`);
    }
    if (type === "code") {
      if (c.length !== undefined) {
        col.length = wholeNumber(c.length);
        if (!col.length) throw new TypeError(`om-entry-grid: column "${c.key}": length is a whole number above 0`);
      }
      col.max_length = col.max_length || CODE_LONGEST;
    }
  }
  if (type === "choice") {
    const options = Array.isArray(c.options) ? c.options : [];
    col.options = options.map((o) => {
      if (typeof o === "string") return { value: o, label: o };
      if (o && typeof o.value === "string") return { value: o.value, label: typeof o.label === "string" && o.label ? o.label : o.value };
      throw new TypeError(`om-entry-grid: column "${c.key}": each option is a string or { value, label }`);
    });
    if (!col.options.length) throw new TypeError(`om-entry-grid: column "${c.key}" is a choice with no options`);
  }
  return col;
}

const fold = (s) => s.normalize("NFKC").trim().toLowerCase();
const characters = (s) => [...s].length;

/** The option a choice's text names: its value, exactly, or its value or label but for case and width. */
export function matchOption(col, text) {
  const exact = col.options.find((o) => o.value === text);
  if (exact) return exact;
  const t = fold(text);
  return col.options.find((o) => fold(o.value) === t) || col.options.find((o) => fold(o.label) === t) || null;
}

/**
 * Check one value for its column: `{ value, empty, message }`. `value` is
 * what the grid posts (trimmed; a code in capitals; a choice's option value),
 * `empty` says nothing was given, and `message` is what is wrong with it, in
 * the column's words, or null. Whether an empty value is allowed is the
 * row's question (a column's `required` holds only in a row that is not
 * blank), so `empty` is never a message here.
 */
export function checkEntryValue(col, raw) {
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (text === "" || col.type === "readonly") return { value: text, empty: text === "", message: null };
  switch (col.type) {
    case "decimal": {
      if (/^[+-]?[\d,]+(?:\.\d+)?$/.test(text) && text.includes(",")) {
        return { value: text, empty: false, message: "Write it without grouping commas, like 1234.5" };
      }
      if (!DECIMAL.test(text)) return { value: text, empty: false, message: "Not a number: write it like 1234.5" };
      const d = parseDecimal(text);
      if (col.places !== undefined && d.frac.length > col.places) {
        return { value: text, empty: false, message: col.places === 0 ? "A whole number, with no decimal places" : `At most ${col.places} decimal place${col.places === 1 ? "" : "s"}` };
      }
      if (col.min !== undefined && compareDecimal(text, col.min) < 0) return { value: text, empty: false, message: `At least ${col.min}` };
      if (col.max !== undefined && compareDecimal(text, col.max) > 0) return { value: text, empty: false, message: `At most ${col.max}` };
      return { value: text, empty: false, message: null };
    }
    case "date": {
      if (!DAY.test(text)) return { value: text, empty: false, message: "Not a date: write it as YYYY-MM-DD" };
      if (!realDay(text)) return { value: text, empty: false, message: "Not a day in the calendar" };
      if (col.min !== undefined && text < col.min) return { value: text, empty: false, message: `On or after ${col.min}` };
      if (col.max !== undefined && text > col.max) return { value: text, empty: false, message: `On or before ${col.max}` };
      return { value: text, empty: false, message: null };
    }
    case "code": {
      const value = text.toUpperCase();
      if (!CODE.test(value)) return { value, empty: false, message: "Letters and digits only, like USD" };
      if (col.length && value.length !== col.length) return { value, empty: false, message: `Exactly ${col.length} character${col.length === 1 ? "" : "s"}` };
      if (value.length > col.max_length) return { value, empty: false, message: `At most ${col.max_length} characters` };
      return { value, empty: false, message: null };
    }
    case "choice": {
      const o = matchOption(col, text);
      return o ? { value: o.value, empty: false, message: null } : { value: text, empty: false, message: "Not one of the choices" };
    }
    default: {
      if (col.max_length && characters(text) > col.max_length) return { value: text, empty: false, message: `At most ${col.max_length} characters` };
      return { value: text, empty: false, message: null };
    }
  }
}

/**
 * Where a path falls in a grid whose rows sit at `prefix` (its `name`, a path
 * itself): `{ at: "table" }` for the prefix, `{ at: "row", index }` for
 * `prefix[n]`, `{ at: "cell", index, field }` for `prefix[n].field…`, or null
 * when the path is not inside the grid. `index` is the row's index as posted.
 */
export function locatePath(prefix, path) {
  if (typeof path !== "string") return null;
  if (path === prefix) return { at: "table" };
  if (!path.startsWith(`${prefix}[`)) return null;
  const m = /^\[(\d+)\](?:\.(.+))?$/.exec(path.slice(prefix.length));
  if (!m) return null;
  const index = Number(m[1]);
  if (!Number.isSafeInteger(index)) return null;
  if (m[2] === undefined) return { at: "row", index };
  return isPath(m[2]) ? { at: "cell", index, field: m[2] } : null;
}

/** The column a path under a row names: its own path exactly, or the one
 * whose path the field goes on beneath (`terms.cost.units` under `terms.cost`). */
export function columnForField(columns, field) {
  let best = null;
  for (const col of columns) {
    if (col.path === field) return col;
    if ((field.startsWith(`${col.path}.`) || field.startsWith(`${col.path}[`)) && (!best || col.path.length > best.path.length)) best = col;
  }
  return best;
}

// ── Reading cells: a spreadsheet's paste, and a CSV ─────────────────────────

/**
 * Rows of cells from delimited text, as a spreadsheet writes it (RFC 4180):
 * a cell in double quotes may hold the delimiter, a line break and `""` for a
 * quote; a quote anywhere else is part of the cell. Line ends are `\n`,
 * `\r\n` or `\r`; a byte-order mark and the last line's end are dropped.
 */
export function parseDelimited(text, delimiter = ",") {
  const s = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  let started = false; // the line has begun, so its end ends a row
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      started = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      started = true;
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      started = false;
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += ch;
    started = true;
    i++;
  }
  if (started || cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The delimiter a CSV's first line uses: a comma, a semicolon or a tab, whichever it has most of outside quotes. */
export function sniffDelimiter(text) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of String(text).replace(/^﻿/, "")) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a), [",", 0])[0];
}

const headerWord = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Each column's header in a CSV: `{ key: index }`, the index of the header
 * that names the column by its key, its label or its path (case, spacing and
 * punctuation aside), or -1. A header is matched to one column at most.
 */
export function matchHeaders(headers, columns) {
  const words = headers.map(headerWord);
  const used = new Set();
  const out = {};
  for (const col of columns) {
    const names = new Set([col.key, col.label, col.path].map(headerWord).filter(Boolean));
    const i = words.findIndex((w, j) => !used.has(j) && names.has(w));
    out[col.key] = i;
    if (i >= 0) used.add(i);
  }
  return out;
}
