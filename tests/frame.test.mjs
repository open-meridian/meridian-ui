// The seamless frame: the host's word marks a framed page (src/meridian.js),
// the kit's CSS then drops what the frame draws (src/css/components.css,
// "Framed"), and the page posts its height to the host's origin alone, only
// when it changes. A page on its own is exactly as it was.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { read, settle } from "./helpers.mjs";

const SOURCE = read("src/meridian.js");
const KIT = "https://plugin.example/.meridian/ui/0.2.0/";
const HOST = "https://dashboard.example";
const SETTINGS = { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true };

/** A parent window that keeps what the page posts to it. */
function host() {
  const posted = [];
  return { posted, postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }) };
}

/** A page at `url`, framed by `parent` unless it is null, with the kit's
 * script run in it; its ResizeObserver, its animation frames and its height
 * are the test's to drive. */
function page(url, { parent = host(), storage, height = 600, body } = {}) {
  const win = new Window({ url, settings: SETTINGS });
  if (body !== undefined) win.document.body.innerHTML = body;
  const framedBy = parent === null ? win : parent;
  Object.defineProperty(win, "parent", { value: framedBy, configurable: true });
  Object.defineProperty(win.document, "currentScript", {
    value: { src: `${KIT}meridian.js`, hasAttribute: (n) => n === "data-no-components" },
    configurable: true,
  });
  const observers = [];
  win.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() {}
  };
  const frames = [];
  win.requestAnimationFrame = (callback) => frames.push(callback);
  const root = win.document.documentElement;
  const box = { height };
  root.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: 800, right: 800, height: box.height, bottom: box.height });
  if (storage) win.sessionStorage.setItem("om-theme", JSON.stringify(storage));
  new Function("window", SOURCE)(win);
  return {
    win,
    root,
    parent: framedBy,
    observers,
    frames,
    /** The page's content is now `h` tall: what a ResizeObserver reports. */
    resize(h) {
      box.height = h;
      for (const o of observers) o.callback([{ target: o.target }], o);
    },
    /** The next animation frame. */
    frame() {
      for (const callback of frames.splice(0)) callback(0);
    },
  };
}

function message(win, data, source, origin = "") {
  const e = new win.MessageEvent("message", { data });
  Object.defineProperty(e, "source", { value: source });
  Object.defineProperty(e, "origin", { value: origin });
  win.dispatchEvent(e);
}

const theme = (extra = {}) => ({ type: "meridian:theme", version: 3, scheme: "default", mode: "light", direction: "green-up", ...extra });
const size = (height) => ({ data: { type: "meridian:size", version: 1, height }, targetOrigin: HOST });

// ── The size message ─────────────────────────────────────────────────────────

test("nothing is sent before the host's first theme message, however the page resizes", () => {
  const p = page("https://plugin.example/admin");
  assert.equal(p.observers.length, 1, "a framed page watches its size");
  assert.equal(p.observers[0].target, p.root, "the whole document");
  p.resize(700);
  p.resize(820);
  p.frame();
  assert.deepEqual(p.parent.posted, []);
});

test("the first theme message teaches the host's origin, and the height goes there at once", () => {
  const p = page("https://plugin.example/admin", { height: 612.3 });
  message(p.win, theme(), p.parent, HOST);
  assert.deepEqual(p.parent.posted, [size(613)], "rounded up, to the host's origin");
});

test("only a change is sent, rounded up, at most once a frame", () => {
  const p = page("https://plugin.example/admin");
  message(p.win, theme(), p.parent, HOST);
  p.parent.posted.length = 0;

  p.resize(600);
  p.frame();
  assert.deepEqual(p.parent.posted, [], "the same height again is not sent");

  p.resize(640.2);
  p.resize(700);
  p.resize(812.4);
  assert.equal(p.frames.length, 1, "three changes in one frame ask for one frame");
  p.frame();
  assert.deepEqual(p.parent.posted, [size(813)], "and send its last height, once");

  p.resize(812.9);
  p.frame();
  assert.deepEqual(p.parent.posted, [size(813)], "what rounds to the height sent is no change");

  p.resize(480);
  p.frame();
  assert.deepEqual(p.parent.posted, [size(813), size(480)], "a page that shrinks says so");
  assert.ok(p.parent.posted.every((m) => m.targetOrigin === HOST), "never to '*'");
});

test("the origin is learned once: a later theme message from elsewhere redirects nothing", () => {
  const p = page("https://plugin.example/admin");
  message(p.win, theme(), p.parent, HOST);
  message(p.win, theme({ mode: "dark" }), p.parent, "https://elsewhere.example");
  assert.equal(p.root.getAttribute("data-om-mode"), "dark", "the theme is still the parent's to set");
  p.resize(900);
  p.frame();
  assert.deepEqual(p.parent.posted.map((m) => m.targetOrigin), [HOST, HOST]);
});

test("no origin is learned from another window, an unusable origin or another message", () => {
  const p = page("https://plugin.example/admin");
  message(p.win, theme(), {}, HOST);
  message(p.win, theme(), p.win, HOST);
  message(p.win, theme(), p.parent, "null");
  message(p.win, theme(), p.parent, "");
  message(p.win, theme(), p.parent, "*");
  message(p.win, { type: "meridian:size", version: 1, height: 1 }, p.parent, HOST);
  message(p.win, { type: "meridian:frame", framed: true }, p.parent, HOST);
  p.resize(750);
  p.frame();
  assert.deepEqual(p.parent.posted, [], "nothing sent");
  // The host's own theme message, from the parent, is what teaches it.
  message(p.win, theme(), p.parent, HOST);
  assert.deepEqual(p.parent.posted, [size(750)]);
});

test("a page on its own watches nothing and posts nothing", () => {
  const p = page("https://plugin.example/admin", { parent: null });
  const posted = [];
  p.win.postMessage = (...args) => posted.push(args);
  assert.equal(p.observers.length, 0);
  message(p.win, theme(), p.win, HOST);
  p.resize(900);
  p.frame();
  assert.deepEqual(posted, []);
});

// ── The framed marker ────────────────────────────────────────────────────────

test("the host's framed: true marks the page, and framed: false unmarks it", () => {
  const p = page("https://plugin.example/admin");
  assert.equal(p.root.hasAttribute("data-om-framed"), false, "not until the host says so");
  assert.equal(p.win.Meridian.frame.framed(), false);
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.equal(p.root.getAttribute("data-om-framed"), "");
  assert.equal(p.win.Meridian.frame.framed(), true);
  // A message that says nothing of it (version 2) keeps it.
  message(p.win, { type: "meridian:theme", version: 2, mode: "dark" }, p.parent, HOST);
  assert.equal(p.root.hasAttribute("data-om-framed"), true);
  // Anything but a boolean is not the host saying so.
  message(p.win, theme({ framed: "no" }), p.parent, HOST);
  assert.equal(p.root.hasAttribute("data-om-framed"), true);
  message(p.win, theme({ framed: false }), p.parent, HOST);
  assert.equal(p.root.hasAttribute("data-om-framed"), false);
  assert.equal(p.win.Meridian.frame.framed(), false);
});

test("om-framed=1 on first load marks a framed page before any message; om-framed=0 does not", () => {
  assert.equal(page("https://plugin.example/admin?om-mode=dark&om-framed=1").root.getAttribute("data-om-framed"), "");
  assert.equal(page("https://plugin.example/admin?om-framed=0").root.hasAttribute("data-om-framed"), false);
  assert.equal(page("https://plugin.example/admin?om-framed=yes").root.hasAttribute("data-om-framed"), false);
});

test("the window being framed is not enough, and the host's word is not enough on its own", () => {
  // In a frame, with nothing said: as on its own.
  assert.equal(page("https://plugin.example/admin").root.hasAttribute("data-om-framed"), false);
  // On its own, whatever the query or the tab kept says.
  const alone = page("https://plugin.example/admin?om-framed=1", { parent: null });
  assert.equal(alone.root.hasAttribute("data-om-framed"), false);
  message(alone.win, theme({ framed: true }), alone.win, HOST);
  assert.equal(alone.root.hasAttribute("data-om-framed"), false);
  const kept = page("https://plugin.example/admin", { parent: null, storage: { scheme: "default", mode: "light", framed: true } });
  assert.equal(kept.root.hasAttribute("data-om-framed"), false);
  // From any window but the parent.
  const p = page("https://plugin.example/admin");
  message(p.win, theme({ framed: true }), {}, HOST);
  assert.equal(p.root.hasAttribute("data-om-framed"), false);
});

test("a navigation inside the frame that drops the query stays framed; the query wins", () => {
  const p = page("https://plugin.example/admin");
  message(p.win, theme({ framed: true }), p.parent, HOST);
  const storage = JSON.parse(p.win.sessionStorage.getItem("om-theme"));
  assert.equal(storage.framed, true);
  assert.equal(page("https://plugin.example/admin/next", { storage }).root.hasAttribute("data-om-framed"), true);
  assert.equal(page("https://plugin.example/admin/next?om-framed=0", { storage }).root.hasAttribute("data-om-framed"), false);
});

// ── Header actions ───────────────────────────────────────────────────────────

// A head as a plugin writes one: a plain form with its token and a marked
// submit button, a marked button of the page's own, and one it leaves alone.
const HEAD = `
<main class="page">
  <header class="page-head">
    <div><h1>Brokerage connections</h1><p>Reading SnapTrade.</p></div>
    <div class="actions">
      <form method="post" action="/admin/read" class="inline" id="read-form"><input type="hidden" name="csrf" value="t0ken"><input type="hidden" name="back" value="/admin/connections"><button data-om-action="refresh" id="refresh">
        Refresh
      </button></form>
      <button type="button" class="primary" data-om-action="connect" id="connect">Connect a brokerage</button>
      <button type="button" id="plain">Export</button>
    </div>
  </header>
  <section class="panel padded"><button type="button" data-om-action="content" id="content">In the content</button></section>
</main>`;

const actions = (list) => ({ data: { type: "meridian:actions", version: 1, actions: list }, targetOrigin: HOST });
const offered = (p) => p.parent.posted.filter((m) => m.data.type === "meridian:actions");
const REFRESH = { id: "refresh", label: "Refresh" };
const CONNECT = { id: "connect", label: "Connect a brokerage", tone: "primary" };
const action = (id, extra = {}) => ({ type: "meridian:action", version: 1, id, ...extra });

test("framed, the head's marked buttons go to the host's origin with its first theme message, and nothing before", async () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: HEAD });
  p.resize(700);
  await settle();
  p.frame();
  assert.deepEqual(offered(p), [], "nothing before the host's origin is known");
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(offered(p), [actions([REFRESH, CONNECT])], "the label is the button's text; only the head's; never '*'");
  assert.deepEqual(p.win.Meridian.frame.actions(), [REFRESH, CONNECT]);
});

test("in a frame but not framed, and on its own, nothing is offered", async () => {
  const p = page("https://plugin.example/admin", { body: HEAD });
  message(p.win, theme(), p.parent, HOST);
  p.win.document.getElementById("connect").disabled = true;
  await settle();
  p.frame();
  assert.deepEqual(offered(p), [], "not framed: the buttons are the page's");

  const alone = page("https://plugin.example/admin?om-framed=1", { parent: null, body: HEAD });
  const posted = [];
  alone.win.postMessage = (...args) => posted.push(args);
  message(alone.win, theme({ framed: true }), alone.win, HOST);
  await settle();
  alone.frame();
  assert.deepEqual(posted, []);
});

test("a button the kit cannot offer stays in the page, marked kept", () => {
  const long = "A label that goes on far longer than any header's button";
  const p = page("https://plugin.example/admin?om-framed=1", { body: `
    <header class="pagehead"><div><h1>Orders</h1></div><div class="actions">
      <button data-om-action="one">One</button>
      <button data-om-action="Bad Id" id="bad">Bad</button>
      <button data-om-action="one" id="again">Again</button>
      <button data-om-action="blank" id="blank">   </button>
      <button data-om-action="long" id="long">${long}</button>
      <input type="submit" data-om-action="two" value="Two">
      <button data-om-action="three" class="danger" disabled>Three</button>
      <fieldset disabled><button data-om-action="four">Four</button></fieldset>
      <button data-om-action="five" id="fifth">Five</button>
    </div></header>` });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(offered(p), [actions([
    { id: "one", label: "One" },
    { id: "two", label: "Two" },
    { id: "three", label: "Three", tone: "danger", disabled: true },
    { id: "four", label: "Four", disabled: true },
  ])], "at most four, each id once, a short label; a disabled fieldset disables");
  const kept = [...p.win.document.querySelectorAll("[data-om-kept]")].map((el) => el.id);
  assert.deepEqual(kept, ["bad", "again", "blank", "long", "fifth"]);
});

test("a change to the set is offered again, at most once a frame, and only a change", async () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: HEAD });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  const doc = p.win.document;
  p.parent.posted.length = 0;

  doc.getElementById("plain").textContent = "Export all";
  doc.querySelector("#content").disabled = true;
  await settle();
  p.frame();
  assert.deepEqual(offered(p), [], "a change outside the offered set is not sent");

  doc.getElementById("refresh").disabled = true;
  doc.getElementById("connect").textContent = "Connect";
  await settle();
  assert.equal(p.frames.length, 1, "two changes ask for one frame");
  p.frame();
  assert.deepEqual(offered(p), [actions([{ ...REFRESH, disabled: true }, { ...CONNECT, label: "Connect" }])]);

  doc.getElementById("refresh").disabled = false;
  doc.getElementById("plain").setAttribute("data-om-action", "export");
  await settle();
  p.frame();
  assert.deepEqual(offered(p).at(-1), actions([REFRESH, { ...CONNECT, label: "Connect" }, { id: "export", label: "Export all" }]), "one marked later");

  doc.getElementById("connect").remove();
  await settle();
  p.frame();
  assert.deepEqual(offered(p).at(-1), actions([REFRESH, { id: "export", label: "Export all" }]), "one removed");
  assert.equal(offered(p).length, 3);
});

test("framed: false tells the host there are none, and framed: true offers them again", () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: HEAD });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  message(p.win, theme({ framed: false }), p.parent, HOST);
  message(p.win, theme({ framed: false }), p.parent, HOST);
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(offered(p), [actions([REFRESH, CONNECT]), actions([]), actions([REFRESH, CONNECT])]);
});

/** Every submit and click on the page, so a test sees what the host's word did. */
function watch(p) {
  const seen = [];
  const doc = p.win.document;
  doc.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = new p.win.FormData(e.target);
    seen.push({ submit: e.target.id, by: e.submitter && e.submitter.id, csrf: form.get("csrf"), back: form.get("back") });
  });
  doc.addEventListener("click", (e) => seen.push({ click: e.target.id }), true);
  return seen;
}

test("the host's meridian:action clicks the page's own button: its form posts with its own token", () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: HEAD });
  const seen = watch(p);
  message(p.win, theme({ framed: true }), p.parent, HOST);
  message(p.win, action("refresh"), p.parent, HOST);
  assert.deepEqual(seen, [{ click: "refresh" }, { submit: "read-form", by: "refresh", csrf: "t0ken", back: "/admin/connections" }]);
  message(p.win, action("connect"), p.parent, HOST);
  assert.deepEqual(seen.at(-1), { click: "connect" }, "a button of the page's own script");
});

test("meridian:action is taken only from the parent, at the learned origin, while framed, for a button offered", () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: HEAD });
  const seen = watch(p);
  message(p.win, action("refresh"), p.parent, HOST);
  assert.deepEqual(seen, [], "not before the host's origin is known");
  message(p.win, theme({ framed: true }), p.parent, HOST);
  message(p.win, action("refresh"), {}, HOST);
  message(p.win, action("refresh"), p.win, HOST);
  message(p.win, action("refresh"), p.parent, "https://elsewhere.example");
  message(p.win, action("refresh", { version: 2 }), p.parent, HOST);
  message(p.win, { type: "meridian:action", id: "refresh" }, p.parent, HOST);
  message(p.win, action("content"), p.parent, HOST);
  message(p.win, action("plain"), p.parent, HOST);
  message(p.win, action(["refresh"]), p.parent, HOST);
  message(p.win, action("toString"), p.parent, HOST);
  p.win.document.getElementById("connect").disabled = true;
  message(p.win, action("connect"), p.parent, HOST);
  assert.deepEqual(seen, [], "another window, another origin, another version, no id, a button not offered, a disabled one");
  message(p.win, theme({ framed: false }), p.parent, HOST);
  message(p.win, action("refresh"), p.parent, HOST);
  assert.deepEqual(seen, [], "not framed: the page's buttons are its own to press");
  message(p.win, theme({ framed: true }), p.parent, HOST);
  message(p.win, action("refresh"), p.parent, HOST);
  assert.equal(seen[0].click, "refresh", "the host's word, from the parent at its origin, framed");
});

// ── Icon actions (0.8.0) ─────────────────────────────────────────────────────

test("a header action marked with an icon the kit knows is offered with it; any other name, or an input, with none", async () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: `
    <header class="page-head"><div><h1>Statements</h1></div><div class="actions">
      <form method="post" action="/read" class="inline"><button data-om-action="refresh" data-om-icon="refresh" title="Refresh" id="refresh">Refresh</button></form>
      <button data-om-action="export" data-om-icon="spreadsheet" id="export">Export</button>
      <input type="submit" data-om-action="again" data-om-icon="refresh" value="Again">
      <button data-om-action="odd" data-om-icon="toString">Odd</button>
    </div></header>` });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(offered(p), [actions([
    { id: "refresh", label: "Refresh", icon: "refresh" },
    { id: "export", label: "Export" },
    { id: "again", label: "Again" },
    { id: "odd", label: "Odd" },
  ])], "the label is still the words: the host's name and tooltip for the icon");

  // An icon given or taken away later is told again, as any change is.
  p.win.document.getElementById("refresh").removeAttribute("data-om-icon");
  await settle();
  p.frame();
  assert.deepEqual(offered(p).at(-1).data.actions[0], { id: "refresh", label: "Refresh" });
  p.win.document.getElementById("export").setAttribute("data-om-icon", "refresh");
  await settle();
  p.frame();
  assert.deepEqual(offered(p).at(-1).data.actions[1], { id: "export", label: "Export", icon: "refresh" });
});

// ── Header status ────────────────────────────────────────────────────────────

// A head as SnapTrade writes one: its heading, its status dot marked for the
// host in the line under it, and Refresh, its one header action.
const STATUS_HEAD = (attrs = 'state="ok" label="SnapTrade read" at="2026-09-30T09:12:00.498692-04:00" at-label="Last read"') => `
<main class="page">
  <header class="page-head" id="head">
    <div><h1>Account links</h1><p><om-status data-om-header id="dot" ${attrs}>SnapTrade read.</om-status></p></div>
    <div class="actions"><form method="post" action="/admin/read" class="inline"><input type="hidden" name="csrf" value="t0ken"><button data-om-action="refresh">Refresh</button></form></div>
  </header>
  <section class="panel" id="first"><om-status state="error" label="In the content" data-om-header id="content-dot"></om-status></section>
</main>`;

const statuses = (p) => p.parent.posted.filter((m) => m.data.type === "meridian:status");
const status = (fields) => ({ data: { type: "meridian:status", version: 1, ...fields }, targetOrigin: HOST });
const READ = { state: "ok", label: "SnapTrade read", at: "2026-09-30T13:12:00.498Z", at_label: "Last read" };
const NONE = { state: null };

test("framed, the head's marked status goes to the host's origin with its first theme message, and nothing before", async () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: STATUS_HEAD() });
  await settle();
  p.frame();
  assert.deepEqual(statuses(p), [], "nothing before the host's origin is known");
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(statuses(p), [status(READ)], "the moment in UTC; only the head's; never '*'");
  assert.deepEqual(p.win.Meridian.frame.status(), READ);
});

test("a framed page with no marked status in its head says so; an unmarked one stays the page's", () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: HEAD });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(statuses(p), [status(NONE)]);
  const unmarked = page("https://plugin.example/admin?om-framed=1", {
    body: STATUS_HEAD().replace("data-om-header ", ""),
  });
  message(unmarked.win, theme({ framed: true }), unmarked.parent, HOST);
  assert.deepEqual(statuses(unmarked), [status(NONE)], "0.6.0's head: the dot stays in the page");
  assert.equal(unmarked.win.document.getElementById("head").hasAttribute("data-om-empty"), false);
});

test("in a frame but not framed, and on its own, no status is told", async () => {
  const p = page("https://plugin.example/admin", { body: STATUS_HEAD() });
  message(p.win, theme(), p.parent, HOST);
  p.win.document.getElementById("dot").setAttribute("state", "busy");
  await settle();
  p.frame();
  assert.deepEqual(statuses(p), []);
  const alone = page("https://plugin.example/admin?om-framed=1", { parent: null, body: STATUS_HEAD() });
  const posted = [];
  alone.win.postMessage = (...args) => posted.push(args);
  message(alone.win, theme({ framed: true }), alone.win, HOST);
  await settle();
  alone.frame();
  assert.deepEqual(posted, []);
  assert.equal(alone.win.document.getElementById("head").hasAttribute("data-om-empty"), false);
});

test("a change to the status is told again, at most once a frame, and only a change", async () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: STATUS_HEAD() });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  const dot = p.win.document.getElementById("dot");
  p.parent.posted.length = 0;

  dot.setAttribute("label", "  SnapTrade   read ");
  dot.setAttribute("zone", "local");
  p.win.document.getElementById("content-dot").setAttribute("state", "ok");
  await settle();
  p.frame();
  assert.deepEqual(statuses(p), [], "the same words, a zone, and a dot outside the head are no change");

  dot.setAttribute("state", "busy");
  dot.setAttribute("label", "Reading SnapTrade");
  dot.setAttribute("detail", "The last read failed: HTTP 503.");
  await settle();
  assert.equal(p.frames.length, 1, "three changes ask for one frame");
  p.frame();
  assert.deepEqual(statuses(p), [status({ state: "busy", label: "Reading SnapTrade", detail: "The last read failed: HTTP 503.", at: READ.at, at_label: "Last read" })]);

  dot.setAttribute("state", "error");
  dot.removeAttribute("label");
  dot.removeAttribute("detail");
  dot.removeAttribute("at");
  await settle();
  p.frame();
  assert.deepEqual(statuses(p).at(-1), status({ state: "error", label: "Failed" }), "the state's own name; no moment, no at_label");

  dot.remove();
  await settle();
  p.frame();
  assert.deepEqual(statuses(p).at(-1), status(NONE), "removed: none");
  assert.equal(statuses(p).length, 3);
});

test("framed: false clears the host's dot, and framed: true tells it again", () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: STATUS_HEAD() });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  message(p.win, theme({ framed: false }), p.parent, HOST);
  message(p.win, theme({ framed: false }), p.parent, HOST);
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(statuses(p), [status(READ), status(NONE), status(READ)]);
});

test("a status the kit cannot offer stays in the page, marked kept; a long detail is cut", () => {
  const long = "x".repeat(81);
  const cases = [
    ['state="green" label="Odd"', NONE, "a state not one of the four"],
    [`state="ok" label="${long}"`, NONE, "a label past 80"],
    [`state="ok" at="2026-09-30T13:12:00Z" at-label="${"y".repeat(41)}"`, NONE, "an at-label past 40"],
  ];
  for (const [attrs, told, why] of cases) {
    const p = page("https://plugin.example/admin?om-framed=1", { body: STATUS_HEAD(attrs) });
    message(p.win, theme({ framed: true }), p.parent, HOST);
    assert.deepEqual(statuses(p), [status(told)], why);
    const doc = p.win.document;
    assert.equal(doc.getElementById("dot").hasAttribute("data-om-kept"), true, why);
    assert.equal(doc.getElementById("head").hasAttribute("data-om-empty"), false, `${why}: the dot keeps the head`);
  }

  const p = page("https://plugin.example/admin?om-framed=1", {
    body: STATUS_HEAD(`state="error" label="The last read failed" detail="${"word ".repeat(80)}" at="yesterday"`).replace(
      "</p>",
      '<om-status data-om-header state="ok" id="second"></om-status></p>',
    ),
  });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  const [{ data }] = statuses(p);
  assert.equal(data.state, "error");
  assert.equal(data.detail.length, 300, "cut to 300");
  assert.ok(data.detail.endsWith("word…"), "ending in an ellipsis");
  assert.equal("at" in data || "at_label" in data, false, "a moment it cannot read is left out");
  assert.equal(p.win.document.getElementById("second").hasAttribute("data-om-kept"), true, "only the first is offered");
  assert.equal(p.win.document.getElementById("dot").hasAttribute("data-om-kept"), false);
});

test("framed, a head left empty once the host draws its heading, actions and status is marked empty", async () => {
  const p = page("https://plugin.example/admin?om-framed=1", { body: STATUS_HEAD() });
  const head = p.win.document.getElementById("head");
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.equal(head.getAttribute("data-om-empty"), "", "SnapTrade's head: nothing left");

  // Anything else it holds keeps it: a word, a kept action, a control, another component.
  const keeps = [
    ["a word beside the dot", (h) => h.querySelector("p").append(" Synthetic mode.")],
    ["a kept action", (h) => h.querySelector("button").setAttribute("data-om-action", "Bad Id")],
    ["a plain button", (h) => h.querySelector(".actions").insertAdjacentHTML("beforeend", "<button>Export</button>")],
    ["another component", (h) => h.querySelector(".actions").insertAdjacentHTML("beforeend", "<om-live></om-live>")],
  ];
  for (const [why, change] of keeps) {
    const q = page("https://plugin.example/admin?om-framed=1", { body: STATUS_HEAD() });
    const h = q.win.document.getElementById("head");
    change(h);
    message(q.win, theme({ framed: true }), q.parent, HOST);
    assert.equal(h.hasAttribute("data-om-empty"), false, why);
  }

  // It follows the page: a line added fills it again, removed empties it.
  const line = p.win.document.createElement("span");
  line.textContent = "Reading now.";
  head.querySelector("div").append(line);
  await settle();
  p.frame();
  assert.equal(head.hasAttribute("data-om-empty"), false, "a line added");
  line.remove();
  await settle();
  p.frame();
  assert.equal(head.hasAttribute("data-om-empty"), true, "and removed");

  message(p.win, theme({ framed: false }), p.parent, HOST);
  assert.equal(head.hasAttribute("data-om-empty"), false, "not framed: the head is the page's");
});

test("the Patterns' head, framed, hands the host its icon action and its status, and is left empty", async () => {
  const block = read("src/gallery/patterns.html").match(/<!-- pattern: the-head -->\n([\s\S]*?)\n<!-- \/pattern -->/)[1];
  const p = page("https://plugin.example/statements?om-framed=1", { body: `<main class="page">${block}</main>` });
  message(p.win, theme({ framed: true }), p.parent, HOST);
  assert.deepEqual(p.win.Meridian.frame.actions(), [{ id: "refresh", label: "Refresh", icon: "refresh" }]);
  assert.deepEqual(p.win.Meridian.frame.status(), { state: "ok", label: "SnapTrade read", at: "2026-10-02T13:12:00.000Z", at_label: "Last read" });
  assert.equal(p.win.document.querySelector(".page-head").getAttribute("data-om-empty"), "", "nothing left in the head");
});

// ── The framed look ──────────────────────────────────────────────────────────

const BASE = read("src/css/base.css");
const COMPONENTS = read("src/css/components.css");
const FRAMED_SECTION = /\/\* ── Framed ─[\s\S]*?(?=\/\* ── )/;

/** The kit's base and component CSS over `body`, in a fresh window (marked
 * framed or not before anything is drawn). */
function styled(body, { framed = false, css = BASE + COMPONENTS } = {}) {
  const win = new Window({ url: "https://plugin.example/admin", settings: SETTINGS });
  const doc = win.document;
  if (framed) doc.documentElement.setAttribute("data-om-framed", "");
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.appendChild(style);
  doc.body.innerHTML = body;
  return { win, doc, style: (el) => win.getComputedStyle(typeof el === "string" ? doc.querySelector(el) : el) };
}

// A page as the kit draws one: a head with its heading, its line and its
// actions, its tab row under it, and content that has a tab row and headings
// of its own.
const PAGE = `
<main class="page">
  <header class="page-head">
    <div><h1>Brokerage connections</h1><p id="line">Reading SnapTrade. Last read 12:04.</p></div>
    <div class="actions"><button type="button" class="primary">Connect a brokerage</button></div>
  </header>
  <nav class="tabs" id="page-tabs"><a class="tab on" href="#a">Connections</a><a class="tab" href="#b">Account links</a></nav>
  <div class="notice warn" id="first">Two accounts have not synced for a day.</div>
  <section class="tiles"><div class="panel tile"><div class="tile-label">Accounts</div><div class="tile-value">6</div></div></section>
  <nav class="tabs" id="view-tabs"><a class="tab on" href="#p">Positions</a><a class="tab" href="#o">Orders</a></nav>
  <section class="panel padded"><h2 id="section">Connections</h2><p>Each brokerage connected.</p></section>
  <section class="panel padded narrow"><h1 id="content-h1">This page is for the deployment's administrators</h1></section>
</main>`;

test("framed, the page's own heading and tab row go, and nothing else", () => {
  const { style } = styled(PAGE, { framed: true });
  assert.equal(style("h1").display, "none", "the head's heading");
  assert.equal(style("#page-tabs").display, "none", "the tab row under the head");
  assert.notEqual(style(".page-head").display, "none", "the head stays for what else it holds");
  assert.notEqual(style("#line").display, "none", "the line under the heading");
  assert.equal(style("#line").marginTop, "0px", "which now starts the head");
  assert.notEqual(style(".page-head .actions").display, "none", "the page's actions");
  assert.equal(style("#view-tabs").display, "flex", "a tab row in the content is the content's");
  assert.notEqual(style("#section").display, "none");
  assert.notEqual(style("#content-h1").display, "none", "a heading in the content is the content's");
  assert.equal(style("#first").marginTop, "0px", "the gap under the head is the head's");
  assert.equal(style(".page-head").marginBottom, "20px");
});

test("framed, the page loses its standalone padding and width, and its background", () => {
  const { style } = styled(PAGE, { framed: true });
  assert.equal(style(".page").maxWidth, "none");
  assert.equal(style(".page").paddingTop, "0px");
  assert.equal(style(".page").paddingLeft, "0px");
  assert.equal(style(".page").paddingBottom, "0px");
  assert.equal(style(".page").marginLeft, "0px");
  assert.equal(style("body").backgroundColor, "transparent", "the dashboard's page colour shows through");
});

test("framed, a head with nothing but its heading goes whole, and what follows starts the page", () => {
  const { style } = styled(`
    <main class="page"><header class="page-head" id="bare"><div><h1>Positions</h1></div></header>
    <nav class="tabs" id="tabs"><a class="tab on" href="#a">A</a></nav><div class="notice" id="first">First</div></main>
    <main class="page"><header class="pagehead" id="with-line"><div><h1>Orders</h1><p>Today's.</p></div></header></main>
    <main class="page"><header class="page-head" id="with-live"><h1>Feed</h1><om-live></om-live></header></main>
    <main class="page"><header class="page-head" id="marked-up"><div><h1>Positions <span class="faint">beta</span></h1></div></header></main>`, { framed: true });
  assert.equal(style("#bare").display, "none");
  assert.equal(style("#tabs").display, "none");
  assert.equal(style("#first").marginTop, "0px");
  assert.notEqual(style("#with-line").display, "none", "a head with a line under its heading stays");
  assert.notEqual(style("#with-live").display, "none", "a head with anything else in it stays");
  // A heading with markup inside keeps its (empty) head: never more hidden than the heading.
  assert.notEqual(style("#marked-up").display, "none");
  assert.equal(style("#marked-up h1").display, "none");
});

test("framed, the head's marked status goes, and a head marked empty goes whole with its gap", () => {
  const { style } = styled(`${STATUS_HEAD()}
    <header class="page-head"><div><h1>Orders</h1><p><om-status data-om-header data-om-kept state="odd" id="kept"></om-status>
      <om-status state="ok" id="unmarked"></om-status></p></div></header>`, { framed: true });
  assert.equal(style("#dot").display, "none", "the marked status");
  assert.notEqual(style("#kept").display, "none", "one the kit could not offer");
  assert.notEqual(style("#unmarked").display, "none", "an unmarked one");
  assert.notEqual(style("#content-dot").display, "none", "a marked one outside the head");
  const empty = styled(STATUS_HEAD().replace('id="head"', 'id="head" data-om-empty'), { framed: true });
  assert.equal(empty.style("#head").display, "none");
  assert.equal(empty.style("#first").marginTop, "0px", "what follows starts the frame");
  const alone = styled(STATUS_HEAD().replace('id="head"', 'id="head" data-om-empty'));
  assert.notEqual(alone.style("#head").display, "none", "on its own, the head is the page's");
  assert.notEqual(alone.style("#dot").display, "none");
});

test("on its own, the page is exactly as it was before the frame rules", () => {
  // The kit's CSS without its Framed section is the kit before it; the page
  // not marked must compute the same with it and without it.
  const before = BASE + COMPONENTS.replace(FRAMED_SECTION, "");
  assert.notEqual(before, BASE + COMPONENTS, "the Framed section was found");
  const body = read("src/gallery/sample.html").match(/<body>([\s\S]*)<\/body>/)[1] + PAGE;
  const now = styled(body);
  const then = styled(body, { css: before });
  const properties = [
    "display", "visibility", "position", "maxWidth", "width", "height",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "backgroundColor", "color", "borderTopWidth", "borderBottomWidth", "fontWeight",
  ];
  const a = [...now.doc.querySelectorAll("*")];
  const b = [...then.doc.querySelectorAll("*")];
  assert.equal(a.length, b.length);
  assert.ok(a.length > 150, `a whole page was compared (${a.length} elements)`);
  for (let i = 0; i < a.length; i++) {
    const x = now.style(a[i]);
    const y = then.style(b[i]);
    for (const p of properties) assert.equal(x[p], y[p], `<${a[i].localName}${a[i].id ? `#${a[i].id}` : ""}> ${p}`);
  }
  // And it draws what the frame would drop.
  assert.equal(now.style("h1").display, "block");
  assert.equal(now.style("#page-tabs").display, "flex");
  assert.equal(now.style("#first").marginTop, "20px");
  assert.equal(now.style(".page").maxWidth, "1152px", "72rem");
});

test("every framed rule is under the attribute, so nothing of it reaches a page on its own", () => {
  const section = COMPONENTS.match(FRAMED_SECTION)[0].replace(/\/\*[\s\S]*?\*\//g, "");
  // Each selector of each rule, split on the commas outside parentheses.
  const split = (list) => {
    const out = [""];
    let depth = 0;
    for (const c of list) {
      depth += c === "(" ? 1 : c === ")" ? -1 : 0;
      if (c === "," && depth === 0) out.push("");
      else out[out.length - 1] += c;
    }
    return out.map((s) => s.trim());
  };
  const selectors = [...section.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => split(m[1]));
  assert.ok(selectors.length >= 8, `the rules were read (${selectors.length})`);
  for (const s of selectors) assert.match(s, /^:root\[data-om-framed\] /, s);
  // And no rule anywhere else names it.
  assert.doesNotMatch(COMPONENTS.replace(FRAMED_SECTION, "") + BASE, /data-om-framed/);
});

test("framed, the head's offered buttons go with their one-button forms; one kept, or not in the head, stays", () => {
  const { style } = styled(`${HEAD}
    <header class="page-head"><div><h1>Orders</h1></div><div class="actions">
      <button data-om-action="bad id" data-om-kept id="kept">Kept</button></div></header>`, { framed: true });
  assert.equal(style("#refresh").display, "none", "the offered button");
  assert.equal(style("#read-form").display, "none", "and its form, so no gap is left");
  assert.equal(style("#connect").display, "none");
  assert.notEqual(style("#plain").display, "none", "a button not marked");
  assert.notEqual(style("#content").display, "none", "a marked button outside the head");
  assert.notEqual(style("#kept").display, "none", "one the kit could not offer");
  const alone = styled(HEAD);
  for (const id of ["#refresh", "#read-form", "#connect"]) assert.notEqual(alone.style(id).display, "none", `${id} on its own`);
});

test("in the page, a button marked with an icon the kit knows is drawn as it: square, its words its name, not shown", () => {
  const { style, doc } = styled(`
    <header class="page-head"><div><h1>Statements</h1></div><div class="actions">
      <button data-om-icon="refresh" title="Refresh" id="icon">Refresh</button>
      <button data-om-icon="spreadsheet" id="unknown">Export</button>
      <button id="words">Words</button>
    </div></header>`);
  const icon = style("#icon");
  assert.equal(icon.fontSize, "0px", "its words are not drawn");
  for (const side of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) assert.equal(icon[side], style("#words").paddingTop, `${side}: square, as tall as a button of words`);
  assert.equal(icon.borderTopWidth, style("#words").borderTopWidth, "a button's edge, as any button's");
  assert.equal(doc.getElementById("icon").textContent, "Refresh", "its words stay, its accessible name");
  assert.notEqual(style("#unknown").fontSize, "0px", "a name the kit does not know is no icon");
  assert.match(COMPONENTS, /button\[data-om-icon="refresh"\]::before \{[^}]*background: currentColor;/, "the icon is drawn in the button's own colour");
  // Framed, the offered one goes to the host as any header action does.
  const framed = styled(`${HEAD.replace('data-om-action="refresh"', 'data-om-action="refresh" data-om-icon="refresh"')}`, { framed: true });
  assert.equal(framed.style("#refresh").display, "none");
});

// ── The stand-in host's header (gallery/host.html) ──────────────────────────

/** The gallery's stand-in host, its script run in a window of its own, the
 * plugin's page beside it never loaded: what it draws from the messages a
 * test sends it. */
function standIn() {
  const html = read("src/gallery/host.html");
  const win = new Window({ url: "https://plugin.example/.meridian/ui/0.8.0/gallery/host.html", settings: SETTINGS });
  const doc = win.document;
  doc.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1];
  const style = doc.createElement("style");
  style.textContent = BASE + COMPONENTS + html.match(/<style>([\s\S]*?)<\/style>/)[1];
  doc.head.appendChild(style);
  win.Meridian = { theme: { current: () => ({ scheme: "default", mode: "light", direction: "green-up" }) } };
  const script = read("src/gallery/host.js")
    .replace(/^import .*$/m, "")
    .replace("import.meta.url", JSON.stringify(win.location.href));
  new Function("window", "document", "location", script)(win, doc, win.location);
  const frame = doc.getElementById("plugin");
  const send = (data) => message(win, data, frame.contentWindow, "https://plugin.example");
  return { win, doc, send, style: (sel) => win.getComputedStyle(doc.querySelector(sel)) };
}

test("the stand-in host's header: the name and its dot on the left; the page's actions left of the level switch, which is the rightmost", () => {
  const { doc, send, style } = standIn();
  const head = doc.getElementById("host-head");
  const title = head.querySelector(".host-title");
  assert.deepEqual([...title.children].map((el) => el.id), ["name", "dot"], "the dot right after the name, and nothing else beside it");
  assert.equal(doc.getElementById("name").title, "Sample plugin", "the whole name, where a phone cuts it");
  const side = doc.getElementById("side");
  assert.equal(head.lastElementChild, side, "the right-hand group is the head's last");
  assert.deepEqual([...side.children].map((el) => el.id), ["actions", "levels", "level-menu"], "the actions immediately left of the switch");
  assert.equal(style("#host-head").display, "grid");
  assert.equal(style("#side").justifySelf, "end", "the group sits at the right, so actions grow leftward");
  assert.equal(style("#level-menu").display, "none", "wider than a phone: the switch, not the menu");
  // On a phone, one row: the menu naming the level in place of the switch,
  // and a long name cut with an ellipsis.
  const phone = read("src/gallery/host.html").match(/@media \(max-width: 36rem\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(phone, /\.host-levels \{ display: none; \}/);
  assert.match(phone, /\.host-level-menu \{ display: block; \}/);
  assert.match(phone, /\.host-title h1 \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  const menu = doc.getElementById("level-menu");
  assert.equal(menu.localName, "details", "a disclosure, no script");
  assert.equal(menu.querySelector("summary").getAttribute("aria-label"), "Open it as: Open");
  assert.equal(menu.querySelector("[aria-current=page]").textContent, "Open");

  send({ type: "meridian:actions", version: 1, actions: [
    { id: "refresh", label: "Refresh", icon: "refresh" },
    { id: "export", label: "Export", icon: "spreadsheet" },
    { id: "new-order", label: "New order", tone: "primary" },
  ] });
  const buttons = [...doc.querySelectorAll("#actions button")];
  assert.equal(buttons.length, 3);
  const [refresh, exported, order] = buttons;
  assert.equal(refresh.getAttribute("data-om-icon"), "refresh", "an icon the host knows is drawn as it");
  assert.equal(refresh.getAttribute("aria-label"), "Refresh", "named for a screen reader");
  assert.equal(refresh.title, "Refresh", "and for a pointer");
  assert.equal(refresh.textContent, "Refresh");
  assert.equal(refresh.type, "button", "focusable, pressed by a key as a click");
  assert.equal(exported.hasAttribute("data-om-icon"), false, "one it does not know is its words");
  assert.equal(exported.textContent, "Export");
  assert.equal(order.className, "primary");
  assert.deepEqual([...side.children].map((el) => el.id), ["actions", "levels", "level-menu"], "the actions never move the level switch from the right");

  send({ type: "meridian:actions", version: 1, actions: [{ id: "refresh", label: "Refresh", icon: "<svg>" }] });
  assert.equal(doc.querySelectorAll("#actions button").length, 3, "an icon not in the kit's shape refuses the whole message");
});
