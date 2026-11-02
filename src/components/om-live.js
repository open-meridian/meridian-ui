// <om-live>: follow a plugin's server-sent events, and never miss one.
//
//   <om-live src="events" snapshot="positions.json" for="positions"></om-live>
//
// The channel is spec/plugins-hear-and-read.md's (Q4): server-sent events
// from the plugin's own server to its page, each delivery carrying its
// sequence, and the page re-reading on reconnect. The wire (the README has it
// in full):
//
//   GET <snapshot>  ->  { "sequence": "41", "rows": [ ...whole records... ] }
//   GET <src>       ->  text/event-stream, each delivery:
//                         id: 42
//                         data: { "rows": [ ...whole new states... ], "removed": [ "key" ] }
//
// The sequence is the event's id (a decimal string, compared exactly), so a
// delivery at or below the last one seen is a duplicate and dropped, and one
// that skips a number is a gap. On a gap, and on every reconnect, it re-reads
// the snapshot and resumes after it, applying what arrived meanwhile.
// Deliveries arriving while a snapshot is read are held and applied after it.
//
// Events, on this element, bubbling:
//   om-snapshot  { sequence, data }         a snapshot was read (first, or after a gap)
//   om-change    { sequence, data, event }  a delivery, in order, no gaps
//   om-gap       { expected, received }     a gap was seen; a snapshot read follows
//   om-state     { state }                  connecting | live | catching-up | reconnecting | offline | stopped
//
// With for="<id>", it feeds that <om-grid>: a snapshot's rows replace the
// grid's, a delivery's rows are upserted and its removed keys removed.
//
// With cells (0.16.0), it keeps a page's live values: each row the SDK's
// pages.live_values sends (meridian-design spec/one-data-access-model §§5-6;
// plans/the-step-3-build 5g, rule 1050, never blind) applied to the elements
// marked data-live="<key>" -- in the document, or in the element whose id
// cells names -- each value's age counted on once a second, its source, a
// stale flag past its ceiling, closed out of session, and why where it has
// nothing to show:
//
//   { key, f: {field: text}, tone: {name: tone}, title, source, at_ms,
//     stale_at_ms, closed, recorded_ms, why }
//
// f's texts go to the elements marked data-f="<field>" (the live element or
// within it), tone's to data-tone-<name>; the kit fills data-f="age",
// "source", "state" (stale, closed or no value), "limit" ("stale after 5 s",
// "no stale limit declared") and "why" itself, and marks the live element data-stale,
// data-closed, data-missing or data-no-limit. at_ms and stale_at_ms are the
// deployment's clock, which the page follows by the snapshot's now_ms and
// each event's sent_ms. It measures, for the browser check (§5), each
// change's quote-to-screen -- the server's part, sent_ms less the row's
// recorded_ms, and the browser's, the event's receipt to the next frame --
// and each row's redraws, on window.meridianLive (summary() reads both).

import { sameOrigin } from "../lib/url.js";

/** The page's live measures (window.meridianLive), shared by every om-live. */
function measures() {
  const held = (globalThis.meridianLive = globalThis.meridianLive || {});
  held.quoteToScreen = held.quoteToScreen || []; // ms: server's part + browser's, per newly recorded row
  held.toFrame = held.toFrame || []; // ms: an event's receipt to its next frame
  held.redraws = held.redraws || {}; // key -> [ms since the page opened, ...]
  held.events = held.events || 0;
  held.snapshots = held.snapshots || 0;
  if (!held.summary) held.summary = () => summary(held);
  return held;
}

const KEPT = 20000;
const REDRAWS_KEPT = 2400;

function p99(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)];
}

/** The most redraws one row made within any one second. */
function peakPerSecond(times) {
  let most = 0;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end] - times[start] >= 1000) start++;
    most = Math.max(most, end - start + 1);
  }
  return most;
}

/** The two bands (§5): quote_to_screen_p99_ms and ticking_row_redraws_per_second. */
export function summary(held = measures()) {
  const keys = Object.keys(held.redraws);
  return {
    quote_to_screen_p99_ms: p99(held.quoteToScreen),
    to_frame_p99_ms: p99(held.toFrame),
    ticking_row_redraws_per_second: keys.reduce((m, k) => Math.max(m, peakPerSecond(held.redraws[k])), 0),
    quotes: held.quoteToScreen.length,
    rows: keys.length,
    events: held.events,
    snapshots: held.snapshots,
  };
}

/** An age as a cell says it: seconds, minutes, hours or days. */
export function ageText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 120) return `${s} s`;
  if (s < 7200) return `${Math.floor(s / 60)} min`;
  if (s < 2 * 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

const KIT_FIELDS = new Set(["age", "source", "state", "limit", "why"]);

function fieldsOf(el, name) {
  const found = Array.from(el.querySelectorAll(`[data-f="${name}"]`));
  if (el.getAttribute("data-f") === name) found.unshift(el);
  return found;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

const LABEL = {
  connecting: ["Connecting", ""],
  live: ["Live", "good"],
  "catching-up": ["Catching up", "warn"],
  reconnecting: ["Reconnecting", "warn"],
  offline: ["Offline", "bad"],
  stopped: ["Stopped", ""],
};

/** A sequence as a BigInt, from an event id or a JSON value; null if it is not one. */
export function toSequence(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

export class OmLive extends HTMLElement {
  static get observedAttributes() {
    return ["src", "snapshot"];
  }

  #offset = 0; // cells: the deployment's clock less the browser's, in ms
  #recorded = new Map(); // cells: key -> the recorded_ms last applied
  #ticker = null;

  #es = null;
  #last = null; // BigInt: the last sequence applied
  #buffer = [];
  #reading = false; // a snapshot read is in flight: deliveries are held
  #gen = 0; // bumps on every snapshot read and stop, so a stale read is ignored
  #stale = false; // the stream dropped: re-read when it reopens
  #retry = null;
  #backoff = 1000;
  #state = "stopped";
  #badge = null;

  connectedCallback() {
    if (!this.#badge) {
      this.#badge = document.createElement("span");
      this.append(this.#badge);
      this.#setState(this.#state);
    }
    if (this.getAttribute("src") && this.getAttribute("snapshot") && !this.hasAttribute("manual")) this.start();
  }

  disconnectedCallback() {
    this.stop();
  }

  attributeChangedCallback() {
    if (this.isConnected && this.#es) this.start();
  }

  /** The last sequence applied, as a decimal string, or null before the first snapshot. */
  get sequence() {
    return this.#last === null ? null : this.#last.toString();
  }

  get state() {
    return this.#state;
  }

  /** Open the stream and read the snapshot. Restarts if already running. */
  start() {
    this.stop();
    let src;
    try {
      src = sameOrigin(this.getAttribute("src") || "");
      sameOrigin(this.getAttribute("snapshot") || "");
    } catch (e) {
      this.#setState("offline");
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: e.message } }));
      return;
    }
    this.#setState("connecting");
    if (this.hasAttribute("cells")) {
      measures();
      this.#ticker = setInterval(() => this.#tickAll(), 1000);
    }
    this.#open(src.href);
    this.resync();
  }

  stop() {
    this.#gen++;
    clearTimeout(this.#retry);
    this.#retry = null;
    clearInterval(this.#ticker);
    this.#ticker = null;
    if (this.#es) {
      this.#es.close();
      this.#es = null;
    }
    this.#buffer = [];
    this.#reading = false;
    this.#stale = false;
    if (this.#state !== "stopped") this.#setState("stopped");
  }

  /** Re-read the snapshot and resume after it. */
  async resync() {
    const gen = ++this.#gen;
    this.#reading = true;
    this.#buffer = [];
    if (this.#last !== null) this.#setState("catching-up");
    let body;
    try {
      const url = sameOrigin(this.getAttribute("snapshot") || "");
      const res = await globalThis.fetch(url.href, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`the snapshot answered ${res.status}`);
      body = await res.json();
    } catch (e) {
      if (gen !== this.#gen) return;
      this.#setState("offline");
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: e.message } }));
      this.#retry = setTimeout(() => this.resync(), this.#nextBackoff());
      return;
    }
    if (gen !== this.#gen) return; // a newer read, or a stop, overtook this one
    const seq = toSequence(body && body.sequence);
    if (seq === null) {
      this.#setState("offline");
      this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: "the snapshot carries no sequence" } }));
      return;
    }
    this.#backoff = 1000;
    this.#last = seq;
    this.#reading = false;
    const target = this.#target();
    if (target && Array.isArray(body.rows)) target.setRows(body.rows);
    if (this.hasAttribute("cells") && Array.isArray(body.rows)) this.#snapshotCells(body);
    this.dispatchEvent(new CustomEvent("om-snapshot", { bubbles: true, detail: { sequence: seq.toString(), data: body } }));
    const held = this.#buffer;
    this.#buffer = [];
    this.#setState(this.#es && this.#es.readyState === 1 ? "live" : this.#stale ? "reconnecting" : "connecting");
    for (let i = 0; i < held.length; i++) {
      // A gap in what was held: deliver() has begun a re-read; hold the rest for it.
      if (!this.#deliver(held[i])) {
        this.#buffer.push(...held.slice(i + 1));
        break;
      }
    }
  }

  #nextBackoff() {
    const wait = this.#backoff;
    this.#backoff = Math.min(30000, this.#backoff * 2);
    return wait;
  }

  #open(href) {
    const Source = globalThis.EventSource;
    const es = new Source(href);
    this.#es = es;
    const onDelivery = (e) => {
      if (es !== this.#es) return;
      let data = null;
      try {
        data = e.data ? JSON.parse(e.data) : null;
      } catch {
        this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: "a delivery is not JSON" } }));
        return;
      }
      const seq = toSequence(e.lastEventId) ?? toSequence(data && data.sequence);
      if (seq === null) {
        this.dispatchEvent(new CustomEvent("om-error", { bubbles: true, detail: { error: "a delivery carries no sequence" } }));
        return;
      }
      const d = { seq, data, event: e.type, received: globalThis.performance ? performance.now() : Date.now() };
      if (this.#reading) this.#buffer.push(d);
      else this.#deliver(d);
    };
    es.addEventListener("message", onDelivery);
    for (const name of (this.getAttribute("events") || "").split(/[\s,]+/).filter(Boolean)) {
      es.addEventListener(name, onDelivery);
    }
    es.addEventListener("open", () => {
      if (es !== this.#es) return;
      if (this.#stale) {
        // Reconnected: whatever was sent while away is read, not trusted.
        this.#stale = false;
        this.resync();
      } else if (!this.#reading) this.#setState("live");
    });
    es.addEventListener("error", () => {
      if (es !== this.#es) return;
      this.#stale = true;
      if (es.readyState === 2) {
        // Closed for good (the server refused): open a new stream later.
        es.close();
        this.#setState("offline");
        clearTimeout(this.#retry);
        this.#retry = setTimeout(() => {
          if (es === this.#es) this.#open(href);
        }, this.#nextBackoff());
      } else {
        this.#setState("reconnecting");
      }
    });
  }

  /** Apply one delivery; false if it was a gap (and a re-read has begun). */
  #deliver({ seq, data, event, received }) {
    if (this.#last !== null && seq <= this.#last) return true; // a duplicate
    if (this.#last !== null && seq !== this.#last + 1n) {
      this.dispatchEvent(
        new CustomEvent("om-gap", {
          bubbles: true,
          detail: { expected: (this.#last + 1n).toString(), received: seq.toString() },
        }),
      );
      this.resync(); // synchronously empties the held list and starts holding
      this.#buffer.push({ seq, data, event, received }); // kept: the snapshot may be older than it
      return false;
    }
    this.#last = seq;
    const target = this.#target();
    if (target && data) {
      if (Array.isArray(data.rows) && data.rows.length) target.upsert(data.rows);
      if (Array.isArray(data.removed) && data.removed.length) target.remove(data.removed);
    }
    if (this.hasAttribute("cells") && data) this.#changeCells(data, received);
    this.dispatchEvent(new CustomEvent("om-change", { bubbles: true, detail: { sequence: seq.toString(), data, event } }));
    if (this.#state !== "live" && this.#es && this.#es.readyState === 1) this.#setState("live");
    return true;
  }

  // ── Cells (0.16.0) ─────────────────────────────────────────────────────

  /** The elements marked data-live in its scope, by key. */
  #cells() {
    const id = this.getAttribute("cells");
    const scope = (id && document.getElementById(id)) || document;
    const byKey = new Map();
    for (const el of scope.querySelectorAll("[data-live]")) {
      const key = el.getAttribute("data-live");
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(el);
    }
    return byKey;
  }

  #follow(ms) {
    const at = Number(ms);
    if (at > 0) this.#offset = at - Date.now();
  }

  #now() {
    return Date.now() + this.#offset;
  }

  #snapshotCells(body) {
    this.#follow(body.now_ms);
    measures().snapshots++;
    const cells = this.#cells();
    for (const row of body.rows) {
      if (!row || typeof row.key !== "string") continue;
      this.#recorded.set(row.key, row.recorded_ms);
      for (const el of cells.get(row.key) || []) this.#apply(el, row);
    }
  }

  #changeCells(data, received) {
    this.#follow(data.sent_ms);
    const held = measures();
    held.events++;
    const cells = this.#cells();
    const anew = [];
    for (const row of Array.isArray(data.rows) ? data.rows : []) {
      if (!row || typeof row.key !== "string") continue;
      const fresh = row.recorded_ms && row.recorded_ms !== this.#recorded.get(row.key);
      this.#recorded.set(row.key, row.recorded_ms);
      const els = cells.get(row.key) || [];
      if (!els.length) continue;
      for (const el of els) this.#apply(el, row);
      const times = (held.redraws[row.key] = held.redraws[row.key] || []);
      times.push(Math.round(received ?? 0));
      if (times.length > REDRAWS_KEPT) times.splice(0, times.length - REDRAWS_KEPT);
      if (fresh && data.sent_ms) anew.push(Number(data.sent_ms) - Number(row.recorded_ms));
    }
    for (const key of Array.isArray(data.removed) ? data.removed : []) {
      this.#recorded.delete(key);
      for (const el of cells.get(key) || []) this.#apply(el, { key, f: {}, why: "no longer served" }, true);
    }
    if (received === undefined) return;
    const frame = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
    frame(() => {
      const drawn = (globalThis.performance ? performance.now() : Date.now()) - received;
      held.toFrame.push(Math.round(drawn * 10) / 10);
      for (const server of anew) held.quoteToScreen.push(Math.round((server + drawn) * 10) / 10);
      if (held.toFrame.length > KEPT) held.toFrame.splice(0, KEPT / 2);
      if (held.quoteToScreen.length > KEPT) held.quoteToScreen.splice(0, KEPT / 2);
    });
  }

  /** One element's value: its texts, tones and times, then its age said. */
  #apply(el, row, gone = false) {
    const why = row.why || "";
    for (const [name, text] of Object.entries(row.f || {})) {
      if (KIT_FIELDS.has(name) && name !== "source") continue;
      for (const f of fieldsOf(el, name)) setText(f, text === "" || text == null ? "–" : String(text));
    }
    if (gone || why) {
      // Nothing to show: never a blank or a figure left over.
      for (const f of [...(el.hasAttribute("data-f") ? [el] : []), ...el.querySelectorAll("[data-f]")]) {
        const name = f.getAttribute("data-f");
        if (!KIT_FIELDS.has(name) && !(name in (row.f || {}))) setText(f, "–");
      }
    }
    for (const [name, tone] of Object.entries(row.tone || {})) {
      const attr = `data-tone-${name}`;
      const targets = el.hasAttribute(attr) ? [el, ...el.querySelectorAll(`[${attr}]`)] : el.querySelectorAll(`[${attr}]`);
      for (const t of targets) t.setAttribute(attr, tone || "");
    }
    const source = (row.f && row.f.source) || row.source || "";
    for (const f of fieldsOf(el, "source")) setText(f, source || "no source");
    for (const f of fieldsOf(el, "why")) setText(f, why || "–");
    el.setAttribute("data-at", String(row.at_ms || 0));
    el.setAttribute("data-stale-at", String(row.stale_at_ms || 0));
    el.setAttribute("data-source", source);
    el.setAttribute("data-why", why);
    el.setAttribute("data-title", row.title || "");
    el.toggleAttribute("data-closed", !why && row.closed === true);
    el.toggleAttribute("data-missing", Boolean(why));
    this.#tick(el);
  }

  /** One element's age, stale flag, limit and hover text, from its times. */
  #tick(el) {
    const at = Number(el.getAttribute("data-at") || 0);
    const staleAt = Number(el.getAttribute("data-stale-at") || 0);
    const why = el.getAttribute("data-why") || "";
    const closed = el.hasAttribute("data-closed");
    const now = this.#now();
    const stale = !why && !closed && staleAt > 0 && now > staleAt;
    const noLimit = !why && at > 0 && !(staleAt > 0);
    el.toggleAttribute("data-stale", stale);
    el.toggleAttribute("data-no-limit", noLimit);
    const age = at > 0 ? ageText(now - at) : "";
    for (const f of fieldsOf(el, "age")) setText(f, why ? "–" : age || "–");
    const state = why ? "no value" : stale ? "stale" : closed ? "closed" : "";
    for (const f of fieldsOf(el, "state")) {
      setText(f, state);
      if (state) f.setAttribute("data-state", why ? "missing" : state);
      else f.removeAttribute("data-state");
    }
    const limit = why ? "" : noLimit ? "no stale limit declared" : staleAt > 0 && at > 0 ? `stale after ${ageText(staleAt - at)}` : "";
    for (const f of fieldsOf(el, "limit")) setText(f, limit || "–");
    const source = el.getAttribute("data-source") || "";
    const said = why
      ? [el.getAttribute("data-title"), why]
      : [
          el.getAttribute("data-title"),
          source && `source ${source}`,
          age && (closed ? `closed, ${age} old` : `${age} old`),
          stale && "stale",
          noLimit && "no stale limit declared",
        ];
    const title = said.filter(Boolean).join("; ");
    if (el.title !== title) el.title = title;
  }

  #tickAll() {
    for (const els of this.#cells().values()) for (const el of els) if (el.hasAttribute("data-at")) this.#tick(el);
  }

  /** The page's live measures (window.meridianLive), shared by every om-live. */
  get measures() {
    return measures();
  }

  #target() {
    const id = this.getAttribute("for");
    if (!id) return null;
    const el = document.getElementById(id);
    return el && typeof el.setRows === "function" && typeof el.upsert === "function" ? el : null;
  }

  #setState(state) {
    this.#state = state;
    this.setAttribute("state", state);
    if (this.#badge) {
      const [text, tone] = LABEL[state];
      this.#badge.className = `badge${tone ? ` ${tone}` : ""}`;
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");
      this.#badge.replaceChildren(dot, document.createTextNode(text));
      this.#badge.setAttribute("role", "status");
    }
    this.dispatchEvent(new CustomEvent("om-state", { bubbles: true, detail: { state } }));
  }
}

if (!customElements.get("om-live")) customElements.define("om-live", OmLive);
