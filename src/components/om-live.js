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

import { sameOrigin } from "../lib/url.js";

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
    this.#open(src.href);
    this.resync();
  }

  stop() {
    this.#gen++;
    clearTimeout(this.#retry);
    this.#retry = null;
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
      const d = { seq, data, event: e.type };
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
  #deliver({ seq, data, event }) {
    if (this.#last !== null && seq <= this.#last) return true; // a duplicate
    if (this.#last !== null && seq !== this.#last + 1n) {
      this.dispatchEvent(
        new CustomEvent("om-gap", {
          bubbles: true,
          detail: { expected: (this.#last + 1n).toString(), received: seq.toString() },
        }),
      );
      this.resync(); // synchronously empties the held list and starts holding
      this.#buffer.push({ seq, data, event }); // kept: the snapshot may be older than it
      return false;
    }
    this.#last = seq;
    const target = this.#target();
    if (target && data) {
      if (Array.isArray(data.rows) && data.rows.length) target.upsert(data.rows);
      if (Array.isArray(data.removed) && data.removed.length) target.remove(data.removed);
    }
    this.dispatchEvent(new CustomEvent("om-change", { bubbles: true, detail: { sequence: seq.toString(), data, event } }));
    if (this.#state !== "live" && this.#es && this.#es.readyState === 1) this.#setState("live");
    return true;
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
