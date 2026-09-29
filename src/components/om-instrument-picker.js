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

import { sameOrigin } from "../lib/url.js";

let counter = 0;

function describe(inst) {
  const ids = (inst.identifiers || []).map((i) => `${i.scheme}:${i.value}`).join("  ");
  const meta = [inst.asset_class, inst.currency, inst.exchange_mic].filter(Boolean).join(" · ");
  return { ids, meta };
}

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
    this.#input.addEventListener("input", () => this.#queue());
    this.#input.addEventListener("keydown", (e) => this.#key(e));
    this.#input.addEventListener("blur", () => setTimeout(() => this.#close(), 150));
    this.#list.addEventListener("mousedown", (e) => e.preventDefault());
    this.#list.addEventListener("click", (e) => {
      const li = e.target.closest("[data-index]");
      if (li) this.#choose(Number(li.dataset.index));
    });
    this.append(this.#input, this.#list, this.#chosen);
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
    this.#value = inst || null;
    this.#showChosen();
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
    let url;
    try {
      url = sameOrigin(this.getAttribute("src") || "");
    } catch (e) {
      this.#status(e.message, true);
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: e.message } }));
      return;
    }
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(Number(this.getAttribute("limit") || 10)));
    const asOf = this.#asOf();
    if (asOf) url.searchParams.set("as_of", asOf);
    this.#abort?.abort();
    const abort = (this.#abort = new AbortController());
    this.#status("Searching…");
    try {
      const res = await globalThis.fetch(url.href, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`the search answered ${res.status}`);
      const body = await res.json();
      if (!body || !Array.isArray(body.results)) throw new Error("the search's answer has no results list");
      if (abort.signal.aborted) return;
      this.#results = body.results.filter((r) => r && typeof r.instrument_id === "string" && r.instrument_id);
      this.#active = this.#results.length ? 0 : -1;
      this.#draw();
    } catch (e) {
      if (e && e.name === "AbortError") return;
      this.#results = [];
      this.#status(`Search failed: ${e.message}`, true);
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: e.message } }));
    }
  }

  #status(text, bad = false) {
    const li = document.createElement("li");
    li.className = `om-picker-status${bad ? " bad" : ""}`;
    li.setAttribute("role", "presentation");
    li.textContent = text;
    this.#list.replaceChildren(li);
    this.#open();
  }

  #draw() {
    if (!this.#results.length) {
      this.#status("No instrument matches.");
      return;
    }
    const items = this.#results.map((inst, i) => {
      const li = document.createElement("li");
      li.id = `${this.#id}-opt-${i}`;
      li.className = "om-picker-option";
      li.setAttribute("role", "option");
      li.dataset.index = String(i);
      li.setAttribute("aria-selected", String(i === this.#active));
      const { ids, meta } = describe(inst);
      const name = document.createElement("span");
      name.className = "om-picker-name";
      name.textContent = inst.description || inst.instrument_id;
      const m = document.createElement("span");
      m.className = "om-picker-meta";
      m.textContent = meta;
      const idl = document.createElement("span");
      idl.className = "om-picker-ids";
      idl.textContent = `${inst.instrument_id}${ids ? `  ${ids}` : ""}`;
      li.append(name, m, idl);
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
    this.#value = inst;
    this.#input.value = "";
    this.#close();
    this.#showChosen();
    this.dispatchEvent(new CustomEvent("om-select", { bubbles: true, detail: { instrument: inst } }));
  }

  #showChosen() {
    if (this.#internals && this.#internals.setFormValue) this.#internals.setFormValue(this.value);
    if (!this.#chosen) return;
    if (!this.#value) {
      this.#chosen.hidden = true;
      this.#chosen.replaceChildren();
      return;
    }
    const chip = document.createElement("span");
    chip.className = "chip";
    const text = document.createElement("span");
    const first = (this.#value.identifiers || [])[0];
    text.textContent = `${this.#value.description || this.#value.instrument_id}${first ? ` (${first.value})` : ""}`;
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
