// <om-asof>: the date a page's figures are as of.
//
//   <om-asof name="as_of" value="2026-09-28" max="2026-09-28"></om-asof>
//   asof.addEventListener("change", (e) => reload(e.detail.value));
//
// The value is a calendar date, "YYYY-MM-DD", or "" for the latest. Day steps
// are calendar arithmetic on the date itself, so no time zone moves it. It is
// a form control: inside a <form>, its value is submitted under its name.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validDate(value) {
  const m = DATE.exec(value || "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function addDays(value, days) {
  const m = DATE.exec(value);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

/** Today in the reader's own calendar. */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export class OmAsOf extends HTMLElement {
  static formAssociated = true;

  static get observedAttributes() {
    return ["value", "min", "max", "label", "disabled"];
  }

  #internals = null;
  #input = null;
  #value = "";
  #built = false;

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
    const id = `om-asof-${Math.random().toString(36).slice(2, 9)}`;
    const label = document.createElement("label");
    label.className = "om-asof-label";
    label.htmlFor = id;
    label.textContent = this.getAttribute("label") || "As of";
    const prev = this.#button("‹", "Previous day", () => this.#step(-1));
    this.#input = document.createElement("input");
    this.#input.type = "date";
    this.#input.id = id;
    this.#input.addEventListener("change", () => this.#set(this.#input.value, true));
    const next = this.#button("›", "Next day", () => this.#step(1));
    const latest = this.#button("Latest", "Show the latest", () => this.#set("", true));
    latest.classList.remove("icon");
    latest.classList.add("om-asof-latest-button");
    this.append(label, prev, this.#input, next, latest);
    this.#set(this.getAttribute("value") || "", false);
    this.#sync();
  }

  attributeChangedCallback(name, _old, value) {
    if (!this.#built) return;
    if (name === "value") this.#set(value || "", false);
    else this.#sync();
  }

  get value() {
    return this.#value;
  }

  set value(v) {
    this.#set(v || "", false);
  }

  get min() {
    return this.getAttribute("min") || "";
  }

  get max() {
    return this.getAttribute("max") || "";
  }

  #button(text, label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  #step(days) {
    const from = this.#value || today();
    this.#set(addDays(from, days), true);
  }

  #clamp(v) {
    if (!v) return v;
    if (this.min && validDate(this.min) && v < this.min) return this.min;
    if (this.max && validDate(this.max) && v > this.max) return this.max;
    return v;
  }

  #set(v, announce) {
    const next = validDate(v) ? this.#clamp(v) : "";
    const changed = next !== this.#value;
    this.#value = next;
    if (this.#internals && this.#internals.setFormValue) this.#internals.setFormValue(next);
    this.#sync();
    if (announce && changed) {
      this.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: next } }));
    }
  }

  #sync() {
    if (!this.#input) return;
    this.#input.value = this.#value;
    this.#input.min = this.min;
    this.#input.max = this.max;
    const disabled = this.hasAttribute("disabled");
    for (const c of this.querySelectorAll("input, button")) c.disabled = disabled;
    const [prev, , next, latest] = this.querySelectorAll("button, input");
    const cur = this.#value || today();
    if (!disabled) {
      if (prev) prev.disabled = !!(this.min && addDays(cur, -1) < this.min);
      if (next) next.disabled = !this.#value || !!(this.max && addDays(cur, 1) > this.max);
      if (latest) latest.disabled = !this.#value;
    }
    this.toggleAttribute("latest", !this.#value);
  }
}

if (!customElements.get("om-asof")) customElements.define("om-asof", OmAsOf);
