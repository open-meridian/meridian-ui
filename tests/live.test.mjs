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
