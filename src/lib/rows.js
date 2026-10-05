// One-line rows, with script (meridian-design
// tasks/design/every-page-fits-one-screen.md). Without it a one-line table
// and its row-detail already work: the line cut, the detail opening and
// closing from its "…". With it, on any page that loads the kit's
// components:
//
// - a click (or a tap) anywhere on a row that has a row-detail, but on a
//   link, a button, a field or the detail itself, opens that row's detail:
//   on a phone the whole row is the target, not only its "…";
// - Escape closes an open detail and gives the keyboard back to its "…", and
//   a click outside it closes it; one open closes any other;
// - a cut cell shows its whole text on hover: the kit sets its title, once,
//   when the pointer first comes over it, unless the page gave one.

const ROWS = "table.one-line > tbody > tr, .list-row.one-line";
const CUT = "table.one-line td, table.one-line th, .list-row.one-line .grow, .page-head p, .pagehead p, .section-head p";
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button]";

/** The open row-details on the page. */
function open(doc) {
  return [...doc.querySelectorAll("details.row-detail[open]")];
}

function closeAll(doc, except = null) {
  for (const d of open(doc)) if (d !== except) d.open = false;
}

/** Wire the page's one-line rows up. Idempotent: a document is wired once. */
export function wireRows(doc = document) {
  if (!doc || doc.__omRows) return;
  doc.__omRows = true;

  doc.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".row-detail-pop")) return;
    // A click outside an open detail (over its backdrop) only closes it; its
    // own "…" toggles it as a summary does.
    const detail = target.closest("details.row-detail");
    const wasOpen = open(doc).filter((d) => d !== detail);
    if (wasOpen.length) {
      for (const d of wasOpen) d.open = false;
      if (!detail) {
        e.preventDefault();
        return;
      }
    }
    if (target.closest(INTERACTIVE)) return;
    const row = target.closest(ROWS);
    if (!row) return;
    const d = row.querySelector("details.row-detail");
    if (!d) return;
    d.open = true;
  });

  // One open at a time, where the page gave no shared name.
  doc.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (d instanceof Element && d.matches("details.row-detail") && d.open) closeAll(doc, d);
    },
    true,
  );

  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const shown = open(doc);
    if (!shown.length) return;
    for (const d of shown) d.open = false;
    shown[shown.length - 1].querySelector(":scope > summary")?.focus();
    e.preventDefault();
  });

  doc.addEventListener("mouseover", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest(CUT);
    if (!cell || cell.hasAttribute("title") || cell.hasAttribute("data-om-titled")) return;
    cell.setAttribute("data-om-titled", "");
    if (cell.scrollWidth > cell.clientWidth + 1) {
      const text = (cell.textContent || "").replace(/\s+/g, " ").trim();
      if (text) cell.setAttribute("title", text);
    }
  });
}

if (typeof document !== "undefined") wireRows(document);
