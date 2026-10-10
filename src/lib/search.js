// A search over a list's rows, beside its pager rather than instead of it
// (meridian-design tasks/design/every-page-fits-one-screen.md, the product
// owner's preferences of 2026-10-10: "search bar where rows are expected to
// scale"). Shared by om-grid, om-pager and om-entry-grid, which each draw the
// box above their rows when given the `search` attribute.
//
// A row matches when every word typed is somewhere in its text, case,
// spacing and character width aside, as om-account-map's search and core's
// dashboard filter match.

/** Marks a row a search leaves out, apart from one a pager or the page hid. */
export const UNMATCHED = "data-om-unmatched";

const text = (v) => (v === undefined || v === null ? "" : String(v));

/** A value as a search compares it: case, spacing and width set aside. */
export const fold = (v) => text(v).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** The words of a query, each folded. */
export const wordsOf = (query) => fold(query).split(" ").filter(Boolean);

/** Whether folded text holds every word. */
export const matches = (hay, words) => words.every((w) => hay.includes(w));

const COUNT = new Intl.NumberFormat("en-US");

/** What the box says beside it: how many of how many match, or that none do. */
export function matchedSaid(matched, total) {
  if (!matched) return "No rows match";
  return `${COUNT.format(matched)} of ${COUNT.format(total)} ${total === 1 ? "row" : "rows"}`;
}

/**
 * Draw the search box: `<div class="om-search" role="search">` holding the
 * input and what it says. `label` is the `search` attribute's words (the
 * box's name and placeholder; "Search" when empty). `live` narrows as typed,
 * at most once a frame; otherwise Enter asks (a server's search). Escape
 * empties it. `onQuery(query)` is called with the query to apply. Returns
 * `{ bar, input, said, setLabel, setSaid, clear }`.
 */
export function searchBox({ label = "", value = "", live = true, onQuery }) {
  const bar = document.createElement("div");
  bar.className = "om-search";
  bar.setAttribute("role", "search");
  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("enterkeyhint", "search");
  input.value = value;
  const said = document.createElement("span");
  said.className = "om-search-said";
  said.setAttribute("aria-live", "polite");
  said.hidden = true;
  bar.append(input, said);

  const setLabel = (words) => {
    const name = (words || "").trim() || "Search";
    input.placeholder = name;
    input.setAttribute("aria-label", name);
  };
  setLabel(label);

  let frame = null;
  const apply = () => {
    frame = null;
    onQuery(input.value);
  };
  if (live) {
    input.addEventListener("input", () => {
      if (frame !== null) return;
      const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
      frame = raf(apply);
    });
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // Never the form's submit: the box is the list's, not the form's.
      e.preventDefault();
      if (!live) onQuery(input.value);
      return;
    }
    if (e.key === "Escape" && input.value) {
      e.preventDefault();
      e.stopPropagation();
      input.value = "";
      onQuery("");
    }
  });

  return {
    bar,
    input,
    said,
    setLabel,
    setSaid(words) {
      said.textContent = words || "";
      said.hidden = !words;
    },
    clear() {
      input.value = "";
      said.textContent = "";
      said.hidden = true;
    },
  };
}

/** Ask the page whether the element searches (`om-search`, cancelable):
 * false when the page took the search itself. */
export function askSearch(host, detail) {
  return host.dispatchEvent(new CustomEvent("om-search", { bubbles: true, cancelable: true, detail }));
}
