// om-panels, in a headless DOM (happy-dom): the arrangement as data, placing,
// resizing from the keyboard and the pointer, rearranging, and remembering.

import "./dom.mjs";
import "../src/components/index.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { evenLayout, movePanel, normaliseLayout, placeLayout } from "../src/components/om-panels.js";

const INNER =
  '<section data-panel="a" data-title="Alpha"><p>A</p></section>' +
  '<section data-panel="b" data-title="Beta" data-min="200"><p>B</p></section>' +
  '<section data-panel="c"><p>C</p></section>';

// Mounted as a parser mounts it: the element may connect before its
// children arrive, so this waits a turn for them to take their places.
async function panels(attrs = "", inner = INNER, box = { width: 1000, height: 600 }) {
  document.body.innerHTML = `<om-panels ${attrs}>${inner}</om-panels>`;
  const p = document.body.firstElementChild;
  // happy-dom has no layout: the box the panels share, as a browser would measure it.
  p.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, right: box.width, bottom: box.height, ...box });
  await new Promise((r) => setTimeout(r, 0));
  return p;
}

const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
const pointer = (el, type, x, y) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
const ids = (node) => (node.panel ? [node.panel] : node.children.flatMap(ids));
const gutters = (p) => [...p.querySelectorAll(":scope > .om-panels-gutter")];

beforeEach(() => {
  try {
    globalThis.localStorage.clear();
  } catch {
    /* not every test leaves storage readable */
  }
});

// ── The arrangement, as data ────────────────────────────────────────────────

test("an arrangement is fitted to the panels there are", async () => {
  const saved = { version: 1, root: { split: "column", sizes: [0.7, 0.3], children: [{ panel: "a" }, { panel: "gone" }] } };
  const root = normaliseLayout(saved, ["a", "b"]);
  assert.deepEqual(ids(root), ["a", "b"], "the unknown one dropped, the missing one added");
  assert.equal(normaliseLayout({ version: 2, root: { panel: "a" } }, ["a"]), null, "another version is not read");
  assert.equal(normaliseLayout({ split: "diagonal", children: [] }, ["a"]), null);
  assert.equal(normaliseLayout("nonsense", ["a"]), null);
  const nested = normaliseLayout(
    { split: "row", sizes: [1, 1], children: [{ panel: "a" }, { split: "row", sizes: [1, 3], children: [{ panel: "b" }, { panel: "c" }] }] },
    ["a", "b", "c"],
  );
  assert.equal(nested.split, "row");
  assert.deepEqual(nested.sizes, [0.5, 0.125, 0.375], "a split inside one splitting the same way is flattened");
  assert.deepEqual(evenLayout(["a", "b"], "column"), { split: "column", sizes: [0.5, 0.5], children: [{ panel: "a" }, { panel: "b" }] });
});

test("moving a panel docks it beside another, or swaps them", async () => {
  const root = evenLayout(["a", "b", "c"]);
  const docked = movePanel(root, "c", "a", "top");
  assert.deepEqual(docked, {
    split: "row",
    sizes: [0.5, 0.5],
    children: [{ split: "column", sizes: [0.5, 0.5], children: [{ panel: "c" }, { panel: "a" }] }, { panel: "b" }],
  });
  const beside = movePanel(root, "a", "c", "right");
  assert.deepEqual(ids(beside), ["b", "c", "a"], "along the same split, it takes half its neighbour's share");
  assert.deepEqual(beside.sizes.map((s) => Math.round(s * 1000) / 1000), [0.5, 0.25, 0.25]);
  assert.deepEqual(ids(movePanel(root, "a", "c", "swap")), ["c", "b", "a"]);
  assert.deepEqual(movePanel(root, "a", "a", "left"), root, "onto itself, nothing");
  const { panels, gutters: gs } = placeLayout(docked);
  assert.deepEqual(panels.get("c"), { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.deepEqual(panels.get("b"), { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.equal(gs.length, 2);
});

// ── The element ─────────────────────────────────────────────────────────────

test("om-panels places each panel, with a head, and a gutter between each two", async () => {
  const p = await panels();
  assert.deepEqual(p.panels, ["a", "b", "c"]);
  const a = p.querySelector('[data-panel="a"]');
  assert.ok(a.classList.contains("om-panel"));
  assert.equal(a.getAttribute("role"), "region");
  assert.equal(a.getAttribute("aria-label"), "Alpha");
  assert.equal(a.firstElementChild.className, "om-panel-head");
  assert.equal(a.querySelector(".om-panel-grip").getAttribute("aria-label"), "Move Alpha");
  assert.equal(a.querySelector(".om-panel-title").textContent, "Alpha");
  assert.equal(a.querySelector("p").textContent, "A", "the page's content is kept");
  assert.equal(p.querySelector('[data-panel="c"] .om-panel-title'), null, "no title, no title text");
  assert.equal(a.style.left, "calc(0.0000% + 0px)");
  assert.match(a.style.width, /^calc\(33\.3333% - 0px - var\(--om-panels-gap, 8px\) \/ 2\)$/);
  const gs = gutters(p);
  assert.equal(gs.length, 2);
  assert.equal(gs[0].getAttribute("role"), "separator");
  assert.equal(gs[0].getAttribute("aria-orientation"), "vertical");
  assert.equal(gs[0].getAttribute("aria-valuenow"), "50");
  assert.equal(gs[0].getAttribute("aria-label"), "Resize Alpha and Beta");
  assert.equal(gs[0].tabIndex, 0);
  assert.deepEqual(p.layout.root.sizes, [0.3333, 0.3333, 0.3334], "four places, summing to one, so it reads back as stored");
  const col = await panels('direction="column"');
  assert.equal(col.layout.root.split, "column");
  assert.equal(gutters(col)[0].getAttribute("aria-orientation"), "horizontal");
});

test("om-panels resizes from the keyboard, never below a panel's minimum", async () => {
  const p = await panels('layout-id="k"');
  const events = [];
  p.addEventListener("om-layout", (e) => events.push(e.detail));
  const [g0, g1] = gutters(p);
  key(g0, "ArrowRight");
  assert.equal(p.layout.root.sizes[0], Math.round(((1000 / 3 + 16) / 1000) * 10000) / 10000, "16 pixels");
  key(g0, "ArrowLeft", { shiftKey: true });
  assert.equal(p.layout.root.sizes[0], Math.round(((1000 / 3 - 48) / 1000) * 10000) / 10000, "64 with shift");
  key(g0, "Home");
  assert.equal(p.layout.root.sizes[0], 0.12, "Alpha's minimum, the default 120 pixels");
  key(g1, "Home");
  assert.equal(p.layout.root.sizes[1], 0.2, "Beta's own minimum, 200");
  key(g1, "End");
  assert.equal(p.layout.root.sizes[2], 0.12);
  assert.equal(events.length, 5);
  assert.deepEqual(events.at(-1), { id: "k", layout: p.layout, reason: "resize" });
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("om-panels:k")), p.layout, "remembered under the page's id");
});

test("om-panels resizes with the pointer", async () => {
  const p = await panels();
  const [g0] = gutters(p);
  pointer(g0, "pointerdown", 333, 300);
  pointer(g0, "pointermove", 433, 300);
  assert.ok(p.hasAttribute("resizing"));
  pointer(g0, "pointerup", 433, 300);
  assert.ok(!p.hasAttribute("resizing"));
  assert.equal(Math.round(p.layout.root.sizes[0] * 1000), 433);
  pointer(g0, "pointerdown", 433, 300);
  pointer(g0, "pointermove", 999, 300);
  pointer(g0, "pointerup", 999, 300);
  assert.equal(p.layout.root.sizes[1], 0.2, "held at Beta's minimum");
});

test("om-panels rearranges by dragging a grip onto another panel", async () => {
  const p = await panels();
  const grip = p.querySelector('[data-panel="a"] .om-panel-grip');
  pointer(grip, "pointerdown", 20, 20);
  pointer(grip, "pointermove", 900, 300); // the middle of c: a swap
  assert.equal(p.querySelector(".om-panels-drop").hidden, false, "where it would land is shown");
  pointer(grip, "pointerup", 900, 300);
  assert.deepEqual(ids(p.layout.root), ["c", "b", "a"]);
  assert.equal(p.querySelector(".om-panels-drop").hidden, true);
  // Onto the lower edge of b: docked beneath it.
  const gripC = p.querySelector('[data-panel="c"] .om-panel-grip');
  pointer(gripC, "pointerdown", 20, 20);
  pointer(gripC, "pointermove", 500, 580);
  pointer(gripC, "pointerup", 500, 580);
  assert.deepEqual(p.layout.root, {
    split: "row",
    sizes: [0.5, 0.5],
    children: [{ split: "column", sizes: [0.5, 0.5], children: [{ panel: "b" }, { panel: "c" }] }, { panel: "a" }],
  });
  assert.equal(p.querySelector(".om-panels-live").textContent, "c moved bottom of Beta", "said to a screen reader");
  // Escape puts it down where it was.
  const gripA = p.querySelector('[data-panel="a"] .om-panel-grip');
  const before = JSON.stringify(p.layout);
  pointer(gripA, "pointerdown", 900, 20);
  pointer(gripA, "pointermove", 200, 150);
  key(gripA, "Escape");
  pointer(gripA, "pointerup", 200, 150);
  assert.equal(JSON.stringify(p.layout), before);
});

test("om-panels: a grip's arrow keys swap a panel with its neighbour that way", async () => {
  const p = await panels();
  const grip = p.querySelector('[data-panel="a"] .om-panel-grip');
  key(grip, "ArrowRight");
  assert.deepEqual(ids(p.layout.root), ["b", "a", "c"]);
  assert.equal(p.querySelector(".om-panels-live").textContent, "Alpha moved right, swapped with Beta");
  key(grip, "ArrowUp");
  assert.equal(p.querySelector(".om-panels-live").textContent, "Alpha cannot move up");
  p.move("c", "a", "bottom");
  const gripC = p.querySelector('[data-panel="c"] .om-panel-grip');
  key(gripC, "ArrowUp");
  assert.deepEqual(ids(p.layout.root), ["b", "c", "a"], "c and a exchanged places in their column");
});

test("om-panels remembers the arrangement per page id, and a page may keep it elsewhere", async () => {
  const first = await panels('layout-id="desk"');
  first.move("a", "c", "swap");
  const saved = first.layout;
  const again = await panels('layout-id="desk"');
  assert.deepEqual(again.layout, saved, "the same page, the same arrangement");
  const other = await panels('layout-id="other"');
  assert.deepEqual(ids(other.layout.root), ["a", "b", "c"], "another page's is its own");
  other.setAttribute("layout-id", "desk");
  assert.deepEqual(other.layout, saved, "renamed, it takes that name's arrangement");

  const kept = await panels('layout-id="kept"');
  let got = null;
  kept.addEventListener("om-layout", (e) => {
    got = e.detail.layout;
    e.preventDefault();
  });
  kept.move("a", "b", "swap");
  assert.deepEqual(ids(got.root), ["b", "a", "c"]);
  assert.equal(globalThis.localStorage.getItem("om-panels:kept"), null, "cancelled: not stored in the browser");

  // The page restores what it kept, before or after connecting.
  const el = document.createElement("om-panels");
  el.layout = got;
  el.innerHTML = INNER;
  document.body.replaceChildren(el);
  assert.deepEqual(ids(el.layout.root), ["b", "a", "c"]);
  el.layout = { version: 1, root: { split: "column", sizes: [1, 1, 1], children: [{ panel: "c" }, { panel: "b" }, { panel: "a" }] } };
  assert.equal(el.layout.root.split, "column");
  assert.throws(() => (el.layout = { version: 1, root: { panel: "nobody" } }), /not an arrangement/);
});

test("om-panels: a stored arrangement that no longer fits, or cannot be read, gives way", async () => {
  globalThis.localStorage.setItem("om-panels:fit", JSON.stringify({ version: 1, root: { split: "column", sizes: [0.7, 0.3], children: [{ panel: "a" }, { panel: "gone" }] } }));
  const p = await panels('layout-id="fit"');
  assert.deepEqual(ids(p.layout.root).sort(), ["a", "b", "c"]);
  globalThis.localStorage.setItem("om-panels:bad", "{not json");
  const q = await panels('layout-id="bad"');
  assert.deepEqual(ids(q.layout.root), ["a", "b", "c"]);
});

test("om-panels works when storage is refused", async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage is disabled");
    },
  });
  try {
    const p = await panels('layout-id="locked"');
    const events = [];
    p.addEventListener("om-layout", (e) => events.push(e.detail.reason));
    key(gutters(p)[0], "ArrowRight");
    p.reset();
    assert.deepEqual(events, ["resize", "reset"], "the arrangement still changes and is announced");
  } finally {
    Object.defineProperty(globalThis, "localStorage", real);
  }
});

test("om-panels: the page's default, reset, and panels added later", async () => {
  const p = await panels('layout-id="d"');
  const preferred = { version: 1, root: { split: "column", sizes: [0.5, 0.5], children: [{ panel: "a" }, { split: "row", sizes: [0.5, 0.5], children: [{ panel: "b" }, { panel: "c" }] }] } };
  p.defaultLayout = preferred;
  assert.deepEqual(p.layout, preferred, "nothing stored: the page's default applies");
  p.move("a", "c", "swap");
  assert.ok(globalThis.localStorage.getItem("om-panels:d"));
  p.reset();
  assert.deepEqual(p.layout, preferred);
  assert.equal(globalThis.localStorage.getItem("om-panels:d"), null, "reset forgets the stored one");
  assert.throws(() => (p.defaultLayout = { version: 1, root: { panel: "nobody" } }), /not an arrangement/);

  const d = document.createElement("section");
  d.dataset.panel = "d";
  d.dataset.title = "Delta";
  p.append(d);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(p.panels, ["a", "b", "c", "d"]);
  assert.ok(ids(p.layout.root).includes("d"), "a panel added later is placed");
  assert.ok(d.querySelector(".om-panel-grip"));
});
