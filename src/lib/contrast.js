// The scheme contract's contrast check, as a module with no DOM and no
// dependencies, so the build, the tests, a browser and the dashboard's scheme
// editor run the same code. The dashboard's server-side check (Rust) reads
// the same data, contract/scheme.json, and must agree with this one.
//
// A scheme is { light: { name: value }, dark: { name: value } }, the values
// being the custom properties' values without the leading "--" on the names.
// Only #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba() are read: a scheme is
// data an administrator typed, and a colour the check cannot read is refused
// rather than guessed at.
//
// Which colour means up is a convention (the contract's "direction"): a scheme
// defines its direction colours for green-up, and red-up swaps them. The check
// measures a scheme under each convention, so it is readable under both.

import { directionSwaps, underConvention } from "./scheme.js";

/** Parse a colour to [r, g, b, a], r/g/b in 0..255 and a in 0..1, or null. */
export function parseColour(text) {
  if (typeof text !== "string") return null;
  const v = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(v);
  if (m) {
    // rgb(1, 2, 3), rgba(1, 2, 3, .5), rgb(1 2 3), rgb(1 2 3 / 50%)
    const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const channel = (p) => {
      const pct = p.endsWith("%");
      const x = Number(pct ? p.slice(0, -1) : p);
      if (!Number.isFinite(x)) return NaN;
      return Math.min(255, Math.max(0, pct ? (x * 255) / 100 : x));
    };
    const rgb = parts.slice(0, 3).map(channel);
    let a = 1;
    if (parts.length === 4) {
      const p = parts[3];
      a = p.endsWith("%") ? Number(p.slice(0, -1)) / 100 : Number(p);
    }
    if (rgb.some(Number.isNaN) || !Number.isFinite(a)) return null;
    return [...rgb, Math.min(1, Math.max(0, a))];
  }
  return null;
}

/** A translucent colour drawn over an opaque one. */
export function composite(top, under) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
}

/** WCAG 2 relative luminance of an opaque colour. */
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** CIE76 colour difference in CIELAB (D65), for "must stay distinguishable". */
export function deltaE(a, b) {
  const lab = ([r, g, b]) => {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Check a scheme against the contract. Returns { ok, problems, results }:
 * problems are sentences naming each failing pair (or missing or unreadable
 * property); results carry every pair's ratio, passing or not, with the
 * convention it was measured under. Under the default convention every pair
 * and rule is measured. Under each other one, a pair or rule is measured only
 * when the swap makes it new: "buy on card" under red-up is sell's colour on
 * card, which "sell on card" has measured already, but "buy and good" becomes
 * sell's colour against good, which nothing has. Its problems name the
 * convention: "light, red-up: ...".
 */
export function checkScheme(scheme, contract) {
  const problems = [];
  const results = [];
  const names = contract.properties.map((p) => p.name);
  const d = contract.direction;
  const conventions = d ? [d.default, ...d.conventions.filter((c) => c !== d.default)] : [null];
  for (const mode of contract.modes) {
    const values = (scheme && scheme[mode]) || {};
    const colours = {};
    for (const name of names) {
      if (!(name in values)) {
        problems.push(`${mode}: --${name} is missing`);
        continue;
      }
      const c = parseColour(values[name]);
      if (!c) problems.push(`${mode}: --${name} is ${JSON.stringify(values[name])}, not a colour the check reads (hex, rgb() or rgba())`);
      else colours[name] = c;
    }
    const applies = (x) => !x.modes || x.modes.includes(mode);
    const pairKey = (fg, bg, over, kind) => [fg, bg, over || "", kind].join("|");
    const ruleKey = (a, b, over, min) => [[a, b].sort().join("|"), over || "", min].join("|");
    const measured = {
      pairs: new Set(contract.pairs.filter(applies).map((p) => pairKey(p.fg, p.bg, p.over, p.kind))),
      rules: new Set((contract.distinct || []).filter(applies).map((r) => ruleKey(r.a, r.b, r.over, r.min))),
    };
    for (const convention of conventions) {
      const swaps = convention ? directionSwaps(contract, convention) : [];
      if (!swaps.length) {
        measure(mode, mode, convention, colours, () => true, () => true);
        continue;
      }
      const other = Object.fromEntries(swaps.flatMap(([a, b]) => [[a, b], [b, a]]));
      const s = (n) => (n && other[n]) || n;
      measure(mode, `${mode}, ${convention}`, convention, underConvention(colours, contract, convention),
        (p) => !measured.pairs.has(pairKey(s(p.fg), s(p.bg), s(p.over), p.kind)),
        (r) => !measured.rules.has(ruleKey(s(r.a), s(r.b), s(r.over), r.min)));
    }
  }
  return { ok: problems.length === 0, problems, results };

  function measure(mode, label, convention, colours, newPair, newRule) {
    const ground = (name, over) => {
      // A translucent background is seen over the surface the contract names.
      const c = colours[name];
      if (!c) return null;
      if (c[3] >= 1) return c;
      const under = over && colours[over];
      return under ? composite(c, composite(under, [255, 255, 255, 1])) : null;
    };
    for (const pair of contract.pairs) {
      if (pair.modes && !pair.modes.includes(mode)) continue;
      if (!newPair(pair)) continue;
      const bg = ground(pair.bg, pair.over);
      const fgRaw = colours[pair.fg];
      if (!bg || !fgRaw) continue; // already reported as missing or unreadable
      const fg = fgRaw[3] >= 1 ? fgRaw : composite(fgRaw, bg);
      const ratio = contrastRatio(fg, bg);
      const min = contract.thresholds[pair.kind];
      const pass = ratio >= min;
      const over = pair.over && colours[pair.bg][3] < 1 ? ` over --${pair.over}` : "";
      results.push({ mode, convention, fg: pair.fg, bg: pair.bg, kind: pair.kind, ratio, min, pass, where: pair.where });
      if (!pass) {
        problems.push(
          `${label}: --${pair.fg} on --${pair.bg}${over} is ${ratio.toFixed(2)}:1, below ${min}:1 for ${pair.kind} (${pair.where})`,
        );
      }
    }
    for (const r of contract.distinct || []) {
      if (r.modes && !r.modes.includes(mode)) continue;
      if (!newRule(r)) continue;
      const [a, b] = [colours[r.a], colours[r.b]];
      if (!a || !b) continue;
      const bg = colours[r.over] || [255, 255, 255, 1];
      const diff = deltaE(composite(a, bg), composite(b, bg));
      if (diff < r.min) {
        problems.push(`${label}: --${r.a} and --${r.b} differ by ${diff.toFixed(1)} (CIE76), below ${r.min}: ${r.why}`);
      }
    }
  }
}
