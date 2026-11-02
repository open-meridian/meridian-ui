// <om-live>: sequences, the snapshot, gaps and reconnects, against a fake
// server-sent events stream and a fake snapshot endpoint.

import "./dom.mjs";
import "../src/components/index.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { settle } from "./helpers.mjs";

class FakeEventSource {
  static all = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.all.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  close() {
    this.readyState = 2;
    this.closed = true;
  }
  emit(type, e = {}) {
    for (const fn of this.listeners[type] || []) fn({ type, ...e });
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  send(id, data, type = "message") {
    this.emit(type, { lastEventId: String(id), data: JSON.stringify(data) });
  }
  drop(readyState = 0) {
    this.readyState = readyState;
    this.emit("error");
  }
}

/** A snapshot endpoint answering from a queue; each read waits for release(). */
function snapshots() {
  const reads = [];
  globalThis.fetch = (url) =>
    new Promise((resolve) => {
      reads.push({
        url,
        answer: (body) => resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })),
      });
    });
  return reads;
}

function page() {
  document.body.innerHTML = `
    <om-grid id="g" row-key="id"></om-grid>
    <om-live id="live" src="events" snapshot="snapshot.json" for="g" manual></om-live>`;
  const grid = document.getElementById("g");
  grid.columns = [{ key: "id" }, { key: "qty", type: "decimal" }];
  const live = document.getElementById("live");
  const events = [];
  for (const name of ["om-snapshot", "om-change", "om-gap", "om-state", "om-error"]) {
    live.addEventListener(name, (e) => events.push([name, e.detail]));
  }
  return { grid, live, events };
}

const qtys = (grid) => {
  grid.flush();
  return Object.fromEntries(grid.rows.map((r) => [r.id, r.qty]));
};
const of = (events, name) => events.filter(([n]) => n === name).map(([, d]) => d);

beforeEach(() => {
  FakeEventSource.all = [];
  globalThis.EventSource = FakeEventSource;
});

test("om-live reads the snapshot, applies what arrived meanwhile, and follows in order", async () => {
  const reads = snapshots();
  const { grid, live, events } = page();
  live.start();
  const es = FakeEventSource.all[0];
  assert.equal(new URL(es.url).pathname, "/app/events", "the stream on the page's own origin");
  assert.equal(reads.length, 1);
  es.open();
  es.send(10, { rows: [{ id: "a", qty: "1" }] }); // at or below the snapshot: dropped
  es.send(11, { rows: [{ id: "a", qty: "2" }] }); // after it: held, then applied
  reads[0].answer({ sequence: "10", rows: [{ id: "a", qty: "1" }, { id: "b", qty: "5" }] });
  await settle();
  assert.deepEqual(qtys(grid), { a: "2", b: "5" });
  assert.equal(live.sequence, "11");
  es.send(12, { rows: [{ id: "c", qty: "7" }], removed: ["b"] });
  es.send(12, { rows: [{ id: "c", qty: "999" }] }); // a duplicate
  assert.deepEqual(qtys(grid), { a: "2", c: "7" });
  assert.deepEqual(of(events, "om-change").map((d) => d.sequence), ["11", "12"]);
  assert.equal(of(events, "om-snapshot").length, 1);
  assert.equal(live.state, "live");
  assert.equal(live.getAttribute("state"), "live");
  assert.equal(live.querySelector(".badge").textContent, "Live");
});

test("om-live resumes after a gap by re-reading the snapshot", async () => {
  const reads = snapshots();
  const { grid, live, events } = page();
  live.start();
  const es = FakeEventSource.all[0];
  es.open();
  reads[0].answer({ sequence: "20", rows: [{ id: "a", qty: "1" }] });
  await settle();
  es.send(21, { rows: [{ id: "a", qty: "2" }] });
  es.send(23, { rows: [{ id: "a", qty: "4" }] }); // 22 was lost on the way
  assert.deepEqual(of(events, "om-gap"), [{ expected: "22", received: "23" }]);
  assert.equal(reads.length, 2, "the snapshot is read again");
  assert.equal(live.state, "catching-up");
  es.send(24, { rows: [{ id: "a", qty: "5" }] }); // held while it is read
  // The snapshot is as of 22: it holds what was lost; 23 and 24 follow it.
  reads[1].answer({ sequence: "22", rows: [{ id: "a", qty: "3" }, { id: "z", qty: "9" }] });
  await settle();
  assert.deepEqual(qtys(grid), { a: "5", z: "9" });
  assert.equal(live.sequence, "24");
  assert.deepEqual(of(events, "om-change").map((d) => d.sequence), ["21", "23", "24"]);
  assert.equal(live.state, "live");
  // And it keeps following.
  es.send(25, { rows: [{ id: "z", qty: "10" }] });
  assert.deepEqual(qtys(grid), { a: "5", z: "10" });
});

test("om-live re-reads the snapshot on every reconnect", async () => {
  const reads = snapshots();
  const { grid, live, events } = page();
  live.start();
  const es = FakeEventSource.all[0];
  es.open();
  reads[0].answer({ sequence: "5", rows: [{ id: "a", qty: "1" }] });
  await settle();
  es.drop(0); // the browser will reconnect by itself
  assert.equal(live.state, "reconnecting");
  assert.equal(reads.length, 1, "nothing is read until the stream is back");
  es.open();
  assert.equal(reads.length, 2, "reconnected: the snapshot is read, not trusted to have been sent");
  reads[1].answer({ sequence: "9", rows: [{ id: "a", qty: "4" }] });
  await settle();
  assert.deepEqual(qtys(grid), { a: "4" });
  assert.equal(live.sequence, "9");
  es.send(10, { rows: [{ id: "a", qty: "5" }] });
  assert.equal(live.sequence, "10");
  assert.equal(of(events, "om-gap").length, 0, "a reconnect is not a gap");
  assert.deepEqual(of(events, "om-state").map((d) => d.state), ["connecting", "live", "reconnecting", "catching-up", "live"]);
});

test("om-live opens a new stream when the old one is closed for good", async (t) => {
  const reads = snapshots();
  const { live } = page();
  live.start();
  const es = FakeEventSource.all[0];
  es.open();
  reads[0].answer({ sequence: "1", rows: [] });
  await settle();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  es.drop(2);
  assert.equal(live.state, "offline");
  assert.ok(es.closed);
  t.mock.timers.tick(1000);
  assert.equal(FakeEventSource.all.length, 2, "a new stream after the backoff");
  FakeEventSource.all[1].open();
  assert.equal(reads.length, 2, "and the snapshot re-read when it opens");
  live.stop();
});

test("om-live compares sequences exactly, beyond a double's precision", async () => {
  const reads = snapshots();
  const { live, events } = page();
  live.start();
  const es = FakeEventSource.all[0];
  es.open();
  reads[0].answer({ sequence: "9007199254740992", rows: [] });
  await settle();
  es.send("9007199254740993", { rows: [] });
  es.send("9007199254740994", { rows: [] });
  assert.equal(of(events, "om-gap").length, 0);
  assert.equal(live.sequence, "9007199254740994");
});

test("om-live refuses a stream on another origin", () => {
  snapshots();
  const { live, events } = page();
  live.setAttribute("src", "https://elsewhere.example/events");
  live.start();
  assert.equal(FakeEventSource.all.length, 0);
  assert.match(of(events, "om-error")[0].error, /not this page's origin/);
  assert.equal(live.state, "offline");
});

test("om-live stops when it leaves the page", async () => {
  const reads = snapshots();
  const { live } = page();
  live.start();
  const es = FakeEventSource.all[0];
  live.remove();
  assert.ok(es.closed);
  reads[0].answer({ sequence: "1", rows: [{ id: "a", qty: "1" }] });
  await settle();
  assert.equal(live.sequence, null, "a read that finishes after stop is ignored");
});

// ── Cells (0.16.0): a page's live values, never blind ──────────────────────

// The deployment's clock: 2026-11-02 12:00:00 UTC, in ms.
const NOW = 1793620800000;

function cellsPage() {
  document.body.innerHTML = `
    <table id="rates"><tbody>
      <tr data-live="pair:EUR/USD">
        <td data-f="mid">–</td><td data-f="chg" data-tone-chg="">–</td>
        <td><span data-f="age">–</span> <span class="badge" data-f="state"></span></td>
        <td data-f="source">–</td><td data-f="limit">–</td><td data-f="why">–</td>
      </tr>
      <tr><td data-live="cell:EUR/JPY" data-f="mid">–</td></tr>
    </tbody></table>
    <om-live id="live" src="rates/live/events" snapshot="rates/live" cells="rates" manual></om-live>`;
  return { live: document.getElementById("live"), row: document.querySelector('[data-live="pair:EUR/USD"]'), cell: document.querySelector('[data-live="cell:EUR/JPY"]') };
}

const f = (el, name) => (el.getAttribute("data-f") === name ? el : el.querySelector(`[data-f="${name}"]`)).textContent;

function value(over = {}) {
  return {
    key: "pair:EUR/USD",
    f: { mid: "1.08420", chg: "+0.12%" },
    tone: { chg: "up" },
    title: "EUR/USD bid 1.08415 ask 1.08425",
    source: "oanda-1:quotes",
    at_ms: NOW - 2000,
    stale_at_ms: NOW + 3000,
    closed: false,
    recorded_ms: NOW - 1990,
    why: "",
    ...over,
  };
}

async function started(t, rows) {
  const reads = snapshots();
  const parts = cellsPage();
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: NOW + 7200000 }); // the browser's clock, 2 h off
  parts.live.start();
  const es = FakeEventSource.all[0];
  es.open();
  reads[0].answer({ sequence: "4", rows, now_ms: NOW });
  await settle();
  return { ...parts, es, reads };
}

test("om-live cells show each value with its source and age, counted on the deployment's clock", async (t) => {
  const { live, row } = await started(t, [value()]);
  assert.equal(f(row, "mid"), "1.08420");
  assert.equal(row.querySelector("[data-tone-chg]").getAttribute("data-tone-chg"), "up");
  assert.equal(f(row, "source"), "oanda-1:quotes");
  assert.equal(f(row, "age"), "2 s", "the deployment's clock, not the browser's");
  assert.equal(f(row, "limit"), "stale after 5 s");
  assert.equal(f(row, "why"), "–");
  assert.ok(!row.hasAttribute("data-stale"));
  assert.equal(row.title, "EUR/USD bid 1.08415 ask 1.08425; source oanda-1:quotes; 2 s old");
  t.mock.timers.tick(1000);
  assert.equal(f(row, "age"), "3 s", "counting on");
  t.mock.timers.tick(3000);
  assert.ok(row.hasAttribute("data-stale"), "past its ceiling");
  assert.equal(f(row, "state"), "stale");
  assert.equal(row.querySelector('[data-f="state"]').getAttribute("data-state"), "stale");
  assert.match(row.title, /6 s old; stale$/);
  live.stop();
});

test("om-live cells: out of session a value is closed with its age, never stale", async (t) => {
  const { live, row } = await started(t, [value({ closed: true, at_ms: NOW - 3 * 3600000, stale_at_ms: NOW - 3 * 3600000 + 5000 })]);
  assert.ok(row.hasAttribute("data-closed"));
  assert.ok(!row.hasAttribute("data-stale"), "out of session, staleness is not counted");
  assert.equal(f(row, "state"), "closed");
  assert.equal(f(row, "age"), "3 h");
  assert.match(row.title, /closed, 3 h old$/);
  live.stop();
});

test("om-live cells: with no ceiling declared a value says so and is never stale", async (t) => {
  const { live, row } = await started(t, [value({ stale_at_ms: 0, at_ms: NOW - 86400000 * 3 })]);
  assert.ok(row.hasAttribute("data-no-limit"));
  assert.ok(!row.hasAttribute("data-stale"));
  assert.equal(f(row, "limit"), "no stale limit declared");
  assert.equal(f(row, "age"), "3 d");
  assert.match(row.title, /3 d old; no stale limit declared$/);
  live.stop();
});

test("om-live cells: a value with nothing to show says why, never a blank or an old figure", async (t) => {
  const { live, row, cell, es } = await started(t, [value(), { ...value(), key: "cell:EUR/JPY", f: { mid: "162.10" } }]);
  assert.equal(cell.textContent, "162.10");
  es.send(5, { rows: [value({ f: { chg: "" }, why: "no EUR/USD quote is entitled", at_ms: 0, stale_at_ms: 0 })], sent_ms: NOW });
  assert.ok(row.hasAttribute("data-missing"));
  assert.equal(f(row, "mid"), "–", "the old figure is not left");
  assert.equal(f(row, "chg"), "–");
  assert.equal(f(row, "why"), "no EUR/USD quote is entitled");
  assert.equal(f(row, "age"), "–");
  assert.equal(f(row, "state"), "no value");
  assert.equal(row.querySelector('[data-f="state"]').getAttribute("data-state"), "missing");
  assert.equal(row.title, "EUR/USD bid 1.08415 ask 1.08425; no EUR/USD quote is entitled");
  es.send(6, { rows: [], removed: ["cell:EUR/JPY"], sent_ms: NOW });
  assert.equal(cell.textContent, "–");
  assert.equal(cell.getAttribute("data-why"), "no longer served");
  live.stop();
});

test("om-live cells measure quote-to-screen and each row's redraws for the browser check", async (t) => {
  globalThis.meridianLive = undefined;
  const { live, es } = await started(t, [value()]);
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  // A new quote: the server's part is sent_ms less recorded_ms.
  es.send(5, { rows: [value({ f: { mid: "1.08430" }, recorded_ms: NOW + 900 })], sent_ms: NOW + 1000 });
  // The same input again (an age or a session changed): not a new quote.
  es.send(6, { rows: [value({ f: { mid: "1.08430" }, closed: true, recorded_ms: NOW + 900 })], sent_ms: NOW + 1300 });
  // A key no element shows: neither drawn nor counted.
  es.send(7, { rows: [value({ key: "pair:GBP/USD", recorded_ms: NOW + 1400 })], sent_ms: NOW + 1500 });
  frames.forEach((fn) => fn());
  delete globalThis.requestAnimationFrame;
  const held = live.measures;
  assert.equal(held, globalThis.meridianLive, "the samples' window.meridianLive, read as before");
  assert.equal(held.quoteToScreen.length, 1);
  assert.ok(held.quoteToScreen[0] >= 100 && held.quoteToScreen[0] < 1000, `server 100 ms plus the frame: ${held.quoteToScreen[0]}`);
  assert.equal(held.toFrame.length, 3);
  assert.deepEqual(Object.keys(held.redraws), ["pair:EUR/USD"]);
  assert.equal(held.redraws["pair:EUR/USD"].length, 2);
  assert.equal(held.events, 3);
  assert.equal(held.snapshots, 1);
  const said = held.summary();
  assert.equal(said.ticking_row_redraws_per_second, 2);
  assert.equal(said.quote_to_screen_p99_ms, held.quoteToScreen[0]);
  assert.equal(said.rows, 1);
  live.stop();
});
