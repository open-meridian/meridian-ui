// <om-pager>: pages of rows instead of a long page, as many a page as fit
// (meridian-design tasks/design/every-page-fits-one-screen.md).
//
//   <om-pager total="240" offset="0" size="25">
//     <table class="one-line">…the 25 rows the server drew…</table>
//     <nav class="pager">…the server's own links, for a browser without the kit…</nav>
//   </om-pager>
//
// It pages the rows inside it: the first table's body rows (an om-grid's
// too), or else its .list-row elements. How many a page is it works out from
// the space it is given: the page's height budget (--om-page-height, the
// page's own viewport; framed, the frame's), less everything else on the
// page, over the tallest row, so the page fits one screen. `rows="12"` fixes
// the number instead. It draws the pager under them: Previous, "Rows 1–12 of
// 240" and Next, one line.
//
// Two ways, by what the page holds:
//
// - Every row here (no `total`, or `total` no more than the rows inside):
//   it shows a page of them at a time, and Previous and Next turn the pages
//   in place, with no request.
// - A page of rows from the server: `total` rows in all, the first of them
//   row `offset` (from 0), drawn `size` a page (what the server used). It
//   shows as many of them as fit, and Previous and Next are links to the same
//   address with the query's `offset` and `size` (or the names `offset-param`
//   and `size-param` give) set: the next page starts after the last row shown
//   and is as long as fit, so the server draws a page that fits.
//
// A server's own pager inside it (`nav.pager`, the platform's markup) is what
// a browser without the kit shows; the kit hides it and draws its own. Rows
// the page itself hides stay hidden and are not counted. One om-pager on a
// screen: two would each take the whole space left.

import { whenParsed } from "../lib/declared.js";
import { contentHeight, pageBudget, rowsThatFit } from "../lib/budget.js";

const COUNT = new Intl.NumberFormat("en-US");
const count = (n) => COUNT.format(n);
// Marks a row this pager hid, apart from one the page hid itself.
const PAGED = "data-om-paged";

export class OmPager extends HTMLElement {
  static get observedAttributes() {
    return ["total", "offset", "size", "rows", "offset-param", "size-param"];
  }

  #built = false;
  #nav = null;
  #prev = null;
  #said = null;
  #next = null;
  #page = 0;
  #fit = null;
  #frame = null;
  #watch = null;
  #onResize = () => this.#schedule();

  connectedCallback() {
    whenParsed(() => {
      if (!this.isConnected) return;
      if (!this.#built) this.#build();
      globalThis.addEventListener?.("resize", this.#onResize);
      this.#schedule();
    });
  }

  disconnectedCallback() {
    globalThis.removeEventListener?.("resize", this.#onResize);
  }

  attributeChangedCallback() {
    if (this.#built) this.#schedule();
  }

  /** The rows on the page shown now: { first, last, total, size }, rows
   * counted from 1; first is 0 when there are none. */
  get shown() {
    return this.#view(this.#fit ?? this.#rows().length).said;
  }

  /** Lay out again now rather than on the next frame. */
  refit() {
    if (this.#frame !== null) {
      (globalThis.cancelAnimationFrame || clearTimeout)(this.#frame);
      this.#frame = null;
    }
    if (!this.#built) return;
    this.#layout();
  }

  /** Turn to the next (1) or the previous (-1) page in place; a server's pages are links. */
  turn(by) {
    if (this.#serverSide()) return;
    this.#page += by;
    this.#apply(this.#fit ?? this.#rows().length);
    this.dispatchEvent(new CustomEvent("om-page", { bubbles: true, detail: this.shown }));
  }

  #build() {
    this.#built = true;
    for (const own of this.querySelectorAll(":scope > nav.pager")) own.hidden = true;
    const nav = document.createElement("nav");
    nav.className = "pager om-pager-nav";
    nav.setAttribute("aria-label", "Pages");
    this.#said = document.createElement("span");
    this.#said.className = "pager-said";
    this.#said.setAttribute("aria-live", "polite");
    this.#nav = nav;
    this.#prev = this.#control("prev");
    this.#next = this.#control("next");
    nav.append(this.#prev, this.#said, this.#next);
    this.append(nav);
    // Rows drawn, sorted or replaced (an om-grid's) are paged again.
    if (globalThis.MutationObserver) {
      this.#watch = new MutationObserver((records) => {
        if (records.some((r) => !nav.contains(r.target))) this.#schedule();
      });
      this.#watch.observe(this, { childList: true, subtree: true });
    }
  }

  #control(which) {
    const server = this.#serverSide();
    const el = document.createElement(server ? "a" : "button");
    el.className = "button";
    if (server) el.rel = which;
    else {
      el.type = "button";
      el.addEventListener("click", () => this.turn(which === "next" ? 1 : -1));
    }
    el.textContent = which === "next" ? "Next →" : "← Previous";
    return el;
  }

  #rows() {
    const table = this.querySelector("table");
    const body = table && table.querySelector(":scope > tbody");
    const rows = table
      ? [...(body ? body.children : [])].filter((tr) => tr.localName === "tr" && !tr.classList.contains("om-grid-empty") && !tr.classList.contains("om-grid-spacer"))
      : [...this.querySelectorAll(".list-row")];
    // A row the page hid itself is not one to page.
    return rows.filter((r) => !r.hidden || r.hasAttribute(PAGED));
  }

  #int(name, fallback) {
    const n = Math.floor(Number(this.getAttribute(name)));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  #serverSide() {
    if (!this.hasAttribute("total")) return false;
    return this.#int("total", 0) > this.#rows().length || this.#int("offset", 0) > 0;
  }

  #schedule() {
    if (this.#frame !== null) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    this.#frame = raf(() => {
      this.#frame = null;
      this.#layout();
    });
  }

  /** Work out how many rows fit, show them, and draw the pager. */
  #layout() {
    const rows = this.#rows();
    // The pager's controls follow the way it pages (rows can arrive late).
    const server = this.#serverSide();
    if ((this.#prev.localName === "a") !== server) {
      const prev = this.#control("prev");
      const next = this.#control("next");
      this.#prev.replaceWith(prev);
      this.#next.replaceWith(next);
      this.#prev = prev;
      this.#next = next;
    }
    const fixed = this.#int("rows", 0);
    if (fixed > 0 || !rows.length) {
      this.#fit = fixed || null;
      this.#apply(fixed || rows.length);
      return;
    }
    // Measure with the rows shown now (the first page, when none is).
    const firstShown = rows.findIndex((r) => !r.hidden);
    if (firstShown < 0) this.#apply(Math.min(rows.length, this.#fit || 10));
    this.#nav.hidden = false;
    let fit = rowsThatFit(rows.filter((r) => !r.hidden)) ?? rows.length;
    this.#apply(fit);
    // Rows are not all one height: while the page is still too tall, one fewer.
    const budget = pageBudget();
    for (let i = 0; i < 200 && fit > 1 && contentHeight() > budget + 0.5; i++) this.#apply(--fit);
    this.#fit = fit;
  }

  /** What a page of `size` shows, from where the pager is. */
  #view(size) {
    const rows = this.#rows();
    const per = Math.max(1, size);
    if (this.#serverSide()) {
      const offset = this.#int("offset", 0);
      const total = this.#int("total", rows.length);
      const visible = rows.slice(0, per);
      return {
        rows,
        visible,
        server: true,
        offset,
        said: { first: visible.length ? offset + 1 : 0, last: offset + visible.length, total, size: per },
      };
    }
    const pages = Math.max(1, Math.ceil(rows.length / per));
    this.#page = Math.min(Math.max(0, this.#page), pages - 1);
    const start = this.#page * per;
    const visible = rows.slice(start, start + per);
    return {
      rows,
      visible,
      server: false,
      pages,
      said: { first: visible.length ? start + 1 : 0, last: start + visible.length, total: rows.length, size: per },
    };
  }

  #apply(size) {
    // Keep the first row shown in view when the page's length changes.
    const before = this.#rows();
    const anchor = before.findIndex((r) => !r.hidden);
    if (!this.#serverSide() && anchor >= 0 && size > 0 && this.#fit !== size) this.#page = Math.floor(anchor / Math.max(1, size));
    const v = this.#view(size);
    const keep = new Set(v.visible);
    for (const row of v.rows) {
      const show = keep.has(row);
      if (show && row.hidden) {
        row.hidden = false;
        row.removeAttribute(PAGED);
      } else if (!show && !row.hidden) {
        row.hidden = true;
        row.setAttribute(PAGED, "");
      }
    }
    const { first, last, total } = v.said;
    const one = v.server ? first <= 1 && last >= total : (v.pages || 1) <= 1;
    this.#nav.hidden = one;
    this.#said.textContent = total ? `Rows ${count(first)}–${count(last)} of ${count(total)}` : "No rows";
    if (v.server) {
      const at = (offset) => {
        const url = new URL(globalThis.location.href);
        url.searchParams.set(this.getAttribute("offset-param") || "offset", String(offset));
        url.searchParams.set(this.getAttribute("size-param") || "size", String(Math.max(1, size)));
        return url.pathname + url.search + url.hash;
      };
      this.#link(this.#prev, v.offset > 0 ? at(Math.max(0, v.offset - Math.max(1, size))) : null);
      this.#link(this.#next, last < total ? at(last) : null);
    } else {
      this.#prev.disabled = this.#page <= 0;
      this.#next.disabled = this.#page >= (v.pages || 1) - 1;
    }
  }

  #link(a, href) {
    if (href) {
      a.href = href;
      a.removeAttribute("aria-disabled");
      a.removeAttribute("tabindex");
    } else {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.tabIndex = -1;
    }
  }
}

if (!customElements.get("om-pager")) customElements.define("om-pager", OmPager);
