// The page's height budget, and how many rows of a list fit in it (meridian-
// design tasks/design/every-page-fits-one-screen.md). Shared by om-pager and
// om-account-map's page-size="auto".
//
// The budget is --om-page-height (base.css): the page's own viewport unless
// the page says otherwise; framed, the frame's, which the host holds to the
// viewport under its chrome. How many rows fit is what the rest of the page
// leaves: the budget, less everything on the page but the rows shown now,
// over the tallest row's height. A row is never cut to fit, and at least one
// is shown.

/** The page's height budget, in CSS pixels. */
export function pageBudget(doc = document) {
  const win = doc.defaultView || globalThis;
  const fallback = win.innerHeight || doc.documentElement.clientHeight || 0;
  if (!doc.body) return fallback;
  const probe = doc.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;width:0;height:var(--om-page-height, 100vh)";
  doc.body.append(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h > 0 ? h : fallback;
}

/** How tall the page's content is, in CSS pixels, however tall the viewport:
 * the furthest a child of the body reaches, with its margin and the body's
 * padding under it. A body held to the viewport's height (min-height: 100vh)
 * does not count, only what is in it. */
export function contentHeight(doc = document) {
  const win = doc.defaultView || globalThis;
  const body = doc.body;
  if (!body) return 0;
  const style = (el) => (win.getComputedStyle ? win.getComputedStyle(el) : { marginBottom: "0", paddingBottom: "0", position: "static", display: "block" });
  let bottom = 0;
  for (const child of body.children) {
    const st = style(child);
    if (st.display === "none" || st.position === "fixed" || st.position === "absolute") continue;
    const r = child.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    bottom = Math.max(bottom, r.bottom + (parseFloat(st.marginBottom) || 0));
  }
  const scroll = win.scrollY || 0;
  const measured = bottom + scroll + (parseFloat(style(body).paddingBottom) || 0) + (parseFloat(style(body).marginBottom) || 0);
  // What spills out of a box held to a height (a page laid out to the
  // viewport) is still the document's: while the document scrolls, it counts.
  const root = doc.documentElement;
  return root.scrollHeight > root.clientHeight + 1 ? Math.max(measured, root.scrollHeight) : measured;
}

/**
 * How many rows fit: `shown` are the rows drawn now. The rest of the page is
 * the content's height less theirs; the rows get what the budget leaves of
 * it, each as tall as the tallest of them. `rowHeight` is used where no row
 * is drawn yet to measure.
 */
export function rowsThatFit(shown, { doc = document, budget = pageBudget(doc), content = contentHeight(doc), rowHeight = 0, least = 1 } = {}) {
  let rowsHeight = 0;
  let tallest = 0;
  for (const row of shown) {
    const h = row.getBoundingClientRect().height;
    rowsHeight += h;
    tallest = Math.max(tallest, h);
  }
  const each = tallest || rowHeight;
  if (!(each > 0)) return null;
  const rest = content - rowsHeight;
  return Math.max(least, Math.floor((budget - rest + 0.5) / each));
}
