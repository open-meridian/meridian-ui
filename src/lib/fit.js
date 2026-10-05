// Whether a page fits one screen (meridian-design
// tasks/design/every-page-fits-one-screen.md): its document no taller and no
// wider than the viewport, and each row marked one line on one line.
//
//   import { SIZES, measureFit, fitProblems } from ".../lib/fit.js";
//   for (const size of SIZES) {
//     await page.setViewportSize(size);
//     const problems = fitProblems(await page.evaluate(measureFit), size);
//     // [] when the page fits; else one line per problem, naming the element
//   }
//
// measureFit is self-contained, so a test driving a browser (Playwright's
// page.evaluate, or the kit's own tools/fit.mjs) hands it to the page as it
// is; in a page it can be called directly. It reads the layout and changes
// nothing. What it measures:
//
// - the document's height and width against the viewport's, and when either
//   is over, the element that reaches furthest past the edge (followed down
//   from the body, the child reaching furthest at each step) and the first
//   element wholly past it, each named by its path: what to page, tab or
//   shorten. An element
//   inside something that scrolls or clips (a table-wrap, a frame), or one
//   fixed to the viewport, is not the document's and is not counted;
// - every visible row of a table.one-line, and every .list-row.one-line: a
//   cell whose text takes more than one line is named. A row opened in place
//   (its row-detail open) is the person's choice and not counted.

/** The two screens every page is held to: a desktop and a phone. */
export const SIZES = Object.freeze([
  Object.freeze({ name: "desktop", width: 1440, height: 900 }),
  Object.freeze({ name: "phone", width: 390, height: 844 }),
]);

/** Measure the page this runs in. Self-contained: nothing from this module's
 * scope is used, so it can be serialised into a page as it is. */
export function measureFit() {
  const doc = document;
  const root = doc.documentElement;
  const W = root.clientWidth;
  const H = window.innerHeight;
  const docW = root.scrollWidth;
  const docH = root.scrollHeight;

  function name(el) {
    let s = el.localName;
    if (el.id) return `${s}#${el.id}`;
    const cls = [...el.classList].filter((c) => !c.startsWith("om-") || el.localName.includes("-")).slice(0, 2);
    if (cls.length) s += `.${cls.join(".")}`;
    const parent = el.parentElement;
    if (parent && !el.id) {
      const same = [...parent.children].filter((c) => c.localName === el.localName);
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return s;
  }
  function path(el) {
    const parts = [];
    for (let e = el; e && e !== doc.body && e !== root && parts.length < 5; e = e.parentElement) {
      parts.unshift(name(e));
      if (e.id) break;
    }
    return parts.join(" > ");
  }
  function words(el) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > 48 ? `${t.slice(0, 47)}…` : t;
  }
  function shown(el) {
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && (el.getClientRects().length > 0);
  }

  // Elements that count towards the document: not inside anything that
  // scrolls or clips, not fixed to the viewport, and drawn.
  const counted = [];
  (function walk(el, clipped) {
    for (const child of el.children) {
      const st = getComputedStyle(child);
      if (st.display === "none") continue;
      if (st.position === "fixed") continue;
      if (!clipped) counted.push(child);
      const clips = st.overflowX !== "visible" || st.overflowY !== "visible" || child.localName === "iframe";
      walk(child, clipped || clips);
    }
  })(doc.body, false);

  // Past the edge: from the body down, the child reaching furthest past it,
  // while one does; and the first element wholly past it, in the order the
  // page reads.
  const isCounted = new Set(counted);
  function reachOf(el, edge) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return -Infinity;
    return edge === "bottom" ? r.bottom + window.scrollY : r.right + window.scrollX;
  }
  function past(edge, limit) {
    let at = doc.body;
    let reach = -Infinity;
    for (;;) {
      let next = null;
      let best = limit + 0.5;
      for (const child of at.children) {
        if (!isCounted.has(child)) continue;
        const r = reachOf(child, edge);
        if (r > best) { best = r; next = child; }
      }
      if (!next) break;
      at = next;
      reach = best;
    }
    // Nothing under the body reaches past it but something deeper does (a
    // row of controls spilling out of its box): the furthest of those.
    if (at === doc.body) {
      for (const el of counted) {
        const r = reachOf(el, edge);
        if (r > limit + 0.5 && r >= reach) { reach = r; at = el; }
      }
    }
    const out = at === doc.body ? { element: "", text: "", reach: Math.round(reach) } : { element: path(at), text: words(at), reach: Math.round(reach) };
    for (const el of counted) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const start = edge === "bottom" ? r.top + window.scrollY : r.left + window.scrollX;
      if (start >= limit) {
        out.first = path(el);
        out.firstText = words(el);
        out.firstAt = Math.round(start);
        break;
      }
    }
    return out;
  }

  const overflow = [];
  if (docH > H) overflow.push({ axis: "height", by: docH - H, ...past("bottom", H) });
  if (docW > W) overflow.push({ axis: "width", by: docW - W, ...past("right", W) });

  // Rows marked one line, on one line.
  function lines(cell) {
    const tops = new Set();
    const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/\S/.test(n.nodeValue)) continue;
      const parent = n.parentElement;
      if (!parent || !shown(parent) || parent.closest(".row-detail-pop, .menu-pop, .om-status-note")) continue;
      const range = doc.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4));
    }
    // Line boxes a few pixels apart (a badge beside text) are one line.
    const sorted = [...tops].sort((a, b) => a - b);
    let count = 0;
    let last = -Infinity;
    for (const t of sorted) {
      if (t - last > 2) count++;
      last = t;
    }
    return count;
  }
  const wrapped = [];
  const rows = [
    ...doc.querySelectorAll("table.one-line > tbody > tr"),
    ...doc.querySelectorAll(".list-row.one-line"),
  ];
  for (const row of rows) {
    if (!shown(row) || row.querySelector("details.row-detail[open]")) continue;
    const cells = row.localName === "tr" ? [...row.cells] : [...row.children];
    for (const cell of cells) {
      if (!shown(cell)) continue;
      const n = lines(cell);
      if (n > 1) wrapped.push({ row: path(row), cell: words(cell), lines: n });
    }
  }

  return { width: W, height: H, docWidth: docW, docHeight: docH, overflow, wrapped };
}

/** What a measurement says is wrong, a line each; [] when the page fits. */
export function fitProblems(m, size = null) {
  const at = size ? `${size.width}×${size.height}` : `${m.width}×${m.height}`;
  const out = [];
  for (const o of m.overflow) {
    let what = o.element ? `${o.element}${o.text ? ` (“${o.text}”)` : ""} reaches ${o.reach}px` : "the document";
    if (o.first) what += `; first ${o.axis === "height" ? "below the fold" : "past the edge"}: ${o.first}${o.firstText ? ` (“${o.firstText}”)` : ""} at ${o.firstAt}px`;
    out.push(`at ${at} the document is ${o.by}px too ${o.axis === "height" ? "tall" : "wide"}: ${what}`);
  }
  for (const w of m.wrapped) out.push(`at ${at} a one-line row wraps to ${w.lines} lines: ${w.row}, “${w.cell}”`);
  return out;
}
