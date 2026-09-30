// <om-status>: how something the page reads is doing, as a small coloured dot
// with a note on hover or focus.
//
//   <om-status state="ok" label="Up to date" at="2026-09-30T13:12:00Z" at-label="Last read">
//     Up to date. Last read 2026-09-30 13:12 UTC
//   </om-status>
//
// `state` is `ok` (the last update succeeded: good, a check), `busy` (updating
// now: warning, a turning ring), `warn` (it needs attention: warning, a
// triangle) or `error` (it failed: danger, an exclamation in a disc). Colour
// is never the only signal: each state has its own mark, and `label` (default
// "Up to date", "Updating", "Needs attention" or "Failed") is the dot's name,
// visually hidden. Hovering or focusing the dot, or pressing it, shows
// a note with the label, `detail` (the error message, say) and `at`, the
// moment of the last update, formatted as om-moment formats it (`zone` as
// om-moment's) after `at-label` (default "Updated"). Escape hides the note.
// Everything is set as text, never as markup.
//
// What the page puts inside is shown, beside a dot the kit's CSS draws from
// `state`, until the kit draws it, so the same words serve a browser without
// the kit's script.

import { whenParsed } from "../lib/declared.js";
import { formatMoment } from "./om-moment.js";

/** Each state the element draws, and the name its dot has when the page gives no label. */
export const STATES = Object.freeze({ ok: "Up to date", busy: "Updating", warn: "Needs attention", error: "Failed" });

let made = 0;

export class OmStatus extends HTMLElement {
  static get observedAttributes() {
    return ["state", "label", "detail", "at", "at-label", "zone"];
  }

  #drawn = false;
  #dot = null;
  #name = null;
  #note = null;
  #label = null;
  #detail = null;
  #at = null;

  connectedCallback() {
    // After the page's own words inside it are parsed, so they are replaced, not joined.
    whenParsed(() => {
      if (!this.isConnected || this.#drawn) return;
      this.#build();
      this.#drawn = true;
      this.#render();
    });
  }

  attributeChangedCallback() {
    if (this.#drawn) this.#render();
  }

  get state() {
    const s = this.getAttribute("state") || "";
    return Object.hasOwn(STATES, s) ? s : "";
  }

  set state(v) {
    this.setAttribute("state", v || "");
  }

  #build() {
    const id = `om-status-${++made}`;
    this.#dot = document.createElement("button");
    this.#dot.type = "button";
    this.#dot.className = "om-status-dot";
    this.#name = document.createElement("span");
    this.#name.className = "visually-hidden";
    this.#dot.append(this.#name);

    this.#note = document.createElement("span");
    this.#note.className = "om-status-note";
    this.#note.setAttribute("role", "tooltip");
    this.#note.id = `${id}-note`;
    this.#label = document.createElement("strong");
    this.#label.className = "om-status-label";
    this.#detail = document.createElement("span");
    this.#detail.className = "om-status-detail";
    this.#detail.id = `${id}-detail`;
    this.#at = document.createElement("span");
    this.#at.className = "om-status-at";
    this.#at.id = `${id}-at`;
    this.#note.append(this.#label, this.#detail, this.#at);
    this.replaceChildren(this.#dot, this.#note);

    // Pressed (a tap on a phone, where nothing hovers), it holds the note open;
    // pressed again, or Escape, it hides it until the pointer or focus leaves.
    this.#dot.addEventListener("click", () => {
      if (this.hasAttribute("open")) {
        this.removeAttribute("open");
        this.setAttribute("dismissed", "");
      } else {
        this.removeAttribute("dismissed");
        this.setAttribute("open", "");
        this.#place();
      }
    });
    this.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      this.removeAttribute("open");
      this.setAttribute("dismissed", "");
    });
    this.addEventListener("focusin", () => this.#place());
    this.addEventListener("focusout", (e) => {
      if (e.relatedTarget && this.contains(e.relatedTarget)) return;
      this.removeAttribute("open");
      this.removeAttribute("dismissed");
    });
    this.addEventListener("pointerenter", () => this.#place());
    this.addEventListener("pointerleave", () => {
      if (!this.contains(document.activeElement)) this.removeAttribute("dismissed");
    });
  }

  #render() {
    const state = this.state;
    const label = (this.getAttribute("label") || "").trim() || STATES[state] || "Unknown";
    const detail = (this.getAttribute("detail") || "").trim();
    const shown = formatMoment(this.getAttribute("at"), this.getAttribute("zone") || "utc");

    this.#name.textContent = label;
    this.#label.textContent = label;
    this.#detail.textContent = detail;
    this.#detail.hidden = !detail;
    if (shown) {
      const time = document.createElement("time");
      time.dateTime = shown.datetime;
      time.textContent = shown.text;
      this.#at.replaceChildren(document.createTextNode(`${(this.getAttribute("at-label") || "").trim() || "Updated"} `), time);
    } else {
      this.#at.replaceChildren();
    }
    this.#at.hidden = !shown;
    // The label is the dot's name; what else the note says is its description.
    const described = [detail ? this.#detail.id : "", shown ? this.#at.id : ""].filter(Boolean);
    if (described.length) this.#dot.setAttribute("aria-describedby", described.join(" "));
    else this.#dot.removeAttribute("aria-describedby");
  }

  /** Keep the note inside the window: shifted left where it would run off the right edge. */
  #place() {
    const note = this.#note;
    if (!note) return;
    note.style.left = "";
    const frame = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 0));
    frame(() => {
      const r = note.getBoundingClientRect();
      const width = document.documentElement.clientWidth || globalThis.innerWidth || 0;
      if (!r.width || !width) return;
      const over = r.right - (width - 8);
      if (over > 0) note.style.left = `${-Math.min(over, Math.max(0, r.left - 8))}px`;
    });
  }
}

if (!customElements.get("om-status")) customElements.define("om-status", OmStatus);
