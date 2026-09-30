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
