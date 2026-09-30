// <om-moment>: the moment a page's figures are as of, to read rather than to
// choose (om-asof chooses a date).
//
//   <om-moment label="Last read" value="2026-09-29T12:04:00Z">2026-09-29 12:04 UTC</om-moment>
//
// `value` is an ISO 8601 date-time with its offset (`Z` or `±hh:mm`), or a
// date (`YYYY-MM-DD`), shown as it is. A date-time is shown to the minute in
// UTC, `2026-09-29 12:04 UTC`, or with `zone="local"` in the reader's own time
// zone, named. What the page puts inside is shown until the kit draws it, so
// the same words serve a browser without the kit. An empty or unreadable
// value shows `empty` (default "Not yet"), never a guess.

import { whenParsed } from "../lib/declared.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A date-time with an explicit offset: without one, the moment is not known.
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const pad = (n) => String(n).padStart(2, "0");

/** A moment as the kit shows it: `{ datetime, text }`, or null when it is not one. */
export function formatMoment(value, zone = "utc") {
  const v = String(value || "").trim();
  if (DATE.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return { datetime: v, text: v };
  }
  if (!MOMENT.test(v)) return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  const datetime = t.toISOString();
  if (zone !== "local") {
    return {
      datetime,
      text: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} UTC`,
    };
  }
  let name = "";
  try {
    name = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(t).find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    name = "";
  }
  return {
    datetime,
    text: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}${name ? ` ${name}` : ""}`,
  };
}

export class OmMoment extends HTMLElement {
  static get observedAttributes() {
    return ["value", "label", "zone", "empty"];
  }

  #drawn = false;

  connectedCallback() {
    // After the page's own words inside it are parsed, so they are replaced, not joined.
    whenParsed(() => {
      if (!this.isConnected) return;
      this.#drawn = true;
      this.#render();
    });
  }

  attributeChangedCallback() {
    if (this.#drawn) this.#render();
  }

  get value() {
    return this.getAttribute("value") || "";
  }

  set value(v) {
    this.setAttribute("value", v || "");
  }

  #render() {
    const parts = [];
    const label = this.getAttribute("label");
    if (label) {
      const l = document.createElement("span");
      l.className = "om-moment-label";
      l.textContent = `${label} `;
      parts.push(l);
    }
    const shown = formatMoment(this.value, this.getAttribute("zone") || "utc");
    if (shown) {
      const time = document.createElement("time");
      time.dateTime = shown.datetime;
      time.title = shown.datetime;
      time.textContent = shown.text;
      parts.push(time);
    } else {
      const e = document.createElement("span");
      e.className = "om-moment-empty";
      e.textContent = this.getAttribute("empty") || "Not yet";
      parts.push(e);
    }
    this.replaceChildren(...parts);
  }
}

if (!customElements.get("om-moment")) customElements.define("om-moment", OmMoment);
