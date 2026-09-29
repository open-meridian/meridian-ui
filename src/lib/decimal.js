// Exact decimal strings, compared and grouped without ever becoming a float.
// A price or a quantity reaches a page as a string ("1234.50", "-0.0001");
// the grid sorts and shows it as that string, so what the plugin sent is what
// the person reads (never floating point for money).

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** { sign: 1 | -1 | 0, int: "123", frac: "45" } or null for a non-decimal. */
export function parseDecimal(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(value);
    if (/e/i.test(value)) return null; // a float too large or small to be exact here
  }
  if (typeof value === "bigint") value = value.toString();
  if (typeof value !== "string") return null;
  const m = DECIMAL.exec(value.trim().replace(/,/g, ""));
  if (!m) return null;
  const int = m[2].replace(/^0+(?=\d)/, "");
  const frac = (m[3] || "").replace(/0+$/, "");
  const zero = /^0+$/.test(int) && frac === "";
  return { sign: zero ? 0 : m[1] === "-" ? -1 : 1, int, frac };
}

function compareMagnitude(a, b) {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const n = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(n, "0");
  const fb = b.frac.padEnd(n, "0");
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

/** Compare two decimals exactly: -1, 0 or 1. A non-decimal sorts after any decimal. */
export function compareDecimal(x, y) {
  const a = parseDecimal(x);
  const b = parseDecimal(y);
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  const m = compareMagnitude(a, b);
  return a.sign < 0 ? -m : m;
}

/** The sign of a decimal: 1, -1, 0, or null for a non-decimal. */
export function signOf(value) {
  const d = parseDecimal(value);
  return d ? d.sign : null;
}

/** "1234567.891" as "1,234,567.891": digits grouped, nothing rounded. */
export function groupDigits(value, separator = ",") {
  const text = typeof value === "string" ? value.trim() : String(value);
  const m = /^([+-]?)(\d+)(\.\d+)?$/.exec(text);
  if (!m) return text;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, separator) + (m[3] || "");
}
