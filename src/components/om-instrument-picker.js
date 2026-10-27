// <om-instrument-picker>: find an instrument by any identifier or its name.
//
//   <om-instrument-picker name="instrument_id" src="/api/instruments/search"
//                         asof="asof"></om-instrument-picker>
//   picker.addEventListener("om-select", (e) => use(e.detail.instrument));
//
// It asks the page's own server, never the security master: the plugin's
// backend answers `src` and proxies the security master itself. The request
// and the answer (the README has them in full):
//
//   GET <src>?q=<text>&limit=<n>[&as_of=YYYY-MM-DD]      Accept: application/json
//   200 { "results": [ { "instrument_id": "INS-…", "description": "…",
//                        "asset_class": "equity", "currency": "USD",
//                        "exchange_mic": "XNAS",
//                        "identifiers": [ { "scheme": "ticker", "value": "AAPL", "source": "" } ] } ] }
//
// The fields are SearchInstruments' InstrumentRecord's (meridian-core's
// reference.proto), by their proto names. `asof` names an <om-asof> on the
// page, or is a date; resolution is dated, so a search as of a date asks
// what an identifier meant then.
//
// Bringing an instrument in (0.14.0): with a bring-in hook -- the `bringIn`
// property, a function, or the `bring-in` attribute, a URL on the page's
// origin that lib/instruments.js's bringInstrumentIn POSTs to -- the search
// asks for candidates too: results the page does not hold yet, marked
// `"candidate": true` with an empty `instrument_id`. They are listed as the
// held ones are, the record's ID shown for neither. Choosing one calls the
// hook, which resolves to the instrument the page now holds; until it does,
// the picker's value is empty and the control invalid, so its form does not
// submit, and the outcome is announced.

import { bringInstrumentIn, findInstruments, instrumentLabel, instrumentOption, instrumentStatus, isCandidate } from "../lib/instruments.js";
import { sameOrigin } from "../lib/url.js";

let counter = 0;

export class OmInstrumentPicker extends HTMLElement {
  static formAssociated = true;

  #internals = null;
  #input = null;
  #list = null;
  #chosen = null;
  #results = [];
  #active = -1;
  #timer = null;
  #abort = null;
  #value = null;
  #built = false;
  #live = null;
  #bringIn = null;
  #bringing = null;
  #id = `om-picker-${++counter}`;

  constructor() {
    super();
    try {
      this.#internals = this.attachInternals ? this.attachInternals() : null;
    } catch {
      this.#internals = null;
    }
  }

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.#input = document.createElement("input");
    this.#input.type = "search";
    this.#input.autocomplete = "off";
    this.#input.spellcheck = false;
    this.#input.placeholder = this.getAttribute("placeholder") || "Ticker, ISIN, FIGI or name";
    this.#input.setAttribute("role", "combobox");
    this.#input.setAttribute("aria-autocomplete", "list");
    this.#input.setAttribute("aria-expanded", "false");
    this.#input.setAttribute("aria-controls", `${this.#id}-list`);
    this.#input.setAttribute("aria-label", this.getAttribute("label") || "Instrument");
    this.#list = document.createElement("ul");
    this.#list.id = `${this.#id}-list`;
    this.#list.className = "om-picker-list";
    this.#list.setAttribute("role", "listbox");
    this.#list.hidden = true;
    this.#chosen = document.createElement("div");
    this.#chosen.className = "om-picker-chosen";
    this.#chosen.hidden = true;
    // What a choice came to, for a screen reader: bringing in, chosen, or why not.
    this.#live = document.createElement("span");
    this.#live.className = "visually-hidden";
    this.#live.setAttribute("role", "status");
    this.#input.addEventListener("input", () => this.#queue());
    this.#input.addEventListener("keydown", (e) => this.#key(e));
    this.#input.addEventListener("blur", () => setTimeout(() => this.#close(), 150));
    this.#list.addEventListener("mousedown", (e) => e.preventDefault());
    this.#list.addEventListener("click", (e) => {
      const li = e.target.closest("[data-index]");
      if (li) this.#choose(Number(li.dataset.index));
    });
    this.append(this.#input, this.#list, this.#chosen, this.#live);
  }

  /** The chosen instrument's id, or "". */
  get value() {
    return this.#value ? this.#value.instrument_id : "";
  }

  /** The chosen instrument, as the search answered it, or null. */
  get instrument() {
    return this.#value;
  }

  set instrument(inst) {
    this.#stopBringing();
    this.#value = inst || null;
    this.#showChosen();
  }

  /** The bring-in hook (0.14.0): `(candidate, { signal }) => Promise<instrument>`,
   * the instrument the page holds once it is brought in; or null. Without one,
   * a `bring-in` attribute's URL is POSTed to (lib/instruments.js). */
  get bringIn() {
    return this.#bringIn;
  }

  set bringIn(hook) {
    this.#bringIn = typeof hook === "function" ? hook : null;
  }

  /** Whether a chosen candidate is still being brought in. */
  get bringing() {
    return this.#bringing !== null;
  }

  #hook() {
    if (this.#bringIn) return this.#bringIn;
    const url = this.getAttribute("bring-in");
    return url ? (candidate, options) => bringInstrumentIn(url, candidate, options) : null;
  }

  clear() {
    this.instrument = null;
    this.dispatchEvent(new CustomEvent("om-select", { bubbles: true, detail: { instrument: null } }));
  }

  /** Search now, rather than after the debounce. Resolves when drawn. */
  search(text = this.#input ? this.#input.value : "") {
    clearTimeout(this.#timer);
    return this.#search(text);
  }

  #asOf() {
    const a = this.getAttribute("asof");
    if (!a) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
    const el = document.getElementById(a);
    return el && typeof el.value === "string" ? el.value : "";
  }

  #queue() {
    clearTimeout(this.#timer);
    const wait = Number(this.getAttribute("debounce") ?? 200);
    this.#timer = setTimeout(() => this.#search(this.#input.value), wait);
  }

  async #search(text) {
    const q = text.trim();
    const min = Number(this.getAttribute("min-chars") ?? 1);
    if (q.length < min) {
      this.#results = [];
      this.#close();
      return;
    }
    const src = this.getAttribute("src") || "";
    try {
      sameOrigin(src);
    } catch (e) {
      this.#status(e.message, true);
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: e.message } }));
      return;
    }
    this.#abort?.abort();
    const abort = (this.#abort = new AbortController());
    this.#status("Searching…");
    let found;
    try {
      found = await findInstruments(src, q, {
        limit: Number(this.getAttribute("limit") || 10),
        asOf: this.#asOf(),
        signal: abort.signal,
        candidates: this.#hook() !== null,
      });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      this.#results = [];
      this.#status(`Search failed: ${e.message}`, true);
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: e.message } }));
      return;
    }
    if (abort.signal.aborted) return;
    this.#results = found;
    this.#active = this.#results.length ? 0 : -1;
    this.#draw();
  }

  #status(text, bad = false) {
    this.#list.replaceChildren(instrumentStatus(text, bad));
    this.#open();
  }

  #draw() {
    if (!this.#results.length) {
      this.#status("No instrument matches.");
      return;
    }
    const ids = this.#hook() === null;
    const items = this.#results.map((inst, i) => {
      const li = instrumentOption(inst, `${this.#id}-opt-${i}`, i === this.#active, { ids });
      li.dataset.index = String(i);
      return li;
    });
    this.#list.replaceChildren(...items);
    this.#input.setAttribute("aria-activedescendant", this.#active >= 0 ? `${this.#id}-opt-${this.#active}` : "");
    this.#open();
  }

  #open() {
    this.#list.hidden = false;
    this.#input.setAttribute("aria-expanded", "true");
  }

  #close() {
    if (!this.#list) return;
    this.#list.hidden = true;
    this.#input.setAttribute("aria-expanded", "false");
    this.#input.removeAttribute("aria-activedescendant");
  }

  #key(e) {
    const n = this.#results.length;
    if (e.key === "ArrowDown" && n) {
      e.preventDefault();
      this.#active = (this.#active + 1) % n;
      this.#draw();
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault();
      this.#active = (this.#active - 1 + n) % n;
      this.#draw();
    } else if (e.key === "Enter" && !this.#list.hidden && this.#active >= 0) {
      e.preventDefault();
      this.#choose(this.#active);
    } else if (e.key === "Escape") {
      this.#close();
    }
  }

  #choose(i) {
    const inst = this.#results[i];
    if (!inst) return;
    this.#input.value = "";
    this.#close();
    const hook = isCandidate(inst) ? this.#hook() : null;
    if (hook) {
      this.#bringInto(inst, hook);
      return;
    }
    this.#stopBringing();
    this.#value = inst;
    this.#showChosen();
    this.#announce(`${instrumentLabel(inst)} chosen.`);
    this.dispatchEvent(new CustomEvent("om-select", { bubbles: true, detail: { instrument: inst } }));
  }

  // A candidate chosen: brought in by the hook, the value empty and the
  // control invalid until it resolves to the instrument the page holds.
  async #bringInto(candidate, hook) {
    this.#stopBringing();
    const abort = new AbortController();
    this.#bringing = abort;
    this.#value = null;
    this.#showChosen(candidate);
    const label = instrumentLabel(candidate);
    this.#announce(`Bringing in ${label}…`);
    let held;
    try {
      held = await hook(candidate, { signal: abort.signal });
      if (!held || typeof held.instrument_id !== "string" || !held.instrument_id) {
        throw new Error("bringing it in answered no instrument");
      }
    } catch (e) {
      if (this.#bringing !== abort) return;
      this.#bringing = null;
      this.#showChosen();
      if (e && e.name === "AbortError") return;
      const why = `Could not bring in ${label}: ${e && e.message ? e.message : e}`;
      this.#status(why, true);
      this.#announce(why);
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: why } }));
      return;
    }
    if (this.#bringing !== abort) return;
    this.#bringing = null;
    this.#value = held;
    this.#showChosen();
    this.#announce(`${instrumentLabel(held)} chosen.`);
    this.dispatchEvent(new CustomEvent("om-select", { bubbles: true, detail: { instrument: held } }));
  }

  #stopBringing() {
    if (!this.#bringing) return;
    this.#bringing.abort();
    this.#bringing = null;
  }

  #announce(text) {
    if (this.#live) this.#live.textContent = text;
  }

  // The chosen instrument as a chip; or, with `bringing`, the candidate
  // being brought in, marked busy.
  #showChosen(bringing = null) {
    if (this.#internals && this.#internals.setFormValue) this.#internals.setFormValue(this.value);
    if (this.#internals && this.#internals.setValidity) {
      if (bringing) this.#internals.setValidity({ customError: true }, "The instrument is still being brought in.", this.#input || undefined);
      else this.#internals.setValidity({});
    }
    if (!this.#chosen) return;
    const shown = bringing || this.#value;
    if (!shown) {
      this.#chosen.hidden = true;
      this.#chosen.removeAttribute("aria-busy");
      this.#chosen.replaceChildren();
      return;
    }
    const chip = document.createElement("span");
    chip.className = "chip";
    const text = document.createElement("span");
    text.textContent = bringing ? `${instrumentLabel(bringing)}: bringing in…` : instrumentLabel(shown);
    if (bringing) this.#chosen.setAttribute("aria-busy", "true");
    else this.#chosen.removeAttribute("aria-busy");
    const x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Clear the instrument");
    x.textContent = "×";
    x.addEventListener("click", () => this.clear());
    chip.append(text, x);
    this.#chosen.replaceChildren(chip);
    this.#chosen.hidden = false;
  }
}

if (!customElements.get("om-instrument-picker")) customElements.define("om-instrument-picker", OmInstrumentPicker);
