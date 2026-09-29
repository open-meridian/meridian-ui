// <om-panels>: resizable, rearrangeable panels inside a page.
//
//   <om-panels layout-id="positions-page" direction="row" style="--om-panels-height: 40rem">
//     <section data-panel="positions" data-title="Positions" data-min="320">…</section>
//     <section data-panel="orders" data-title="Orders">…</section>
//     <section data-panel="chart" data-title="Chart">…</section>
//   </om-panels>
//
// Each child with a data-panel id is a panel, holding whatever the page puts
// in it. The arrangement is a tree of splits, each laying its children side
// by side (row) or one above another (column) in given shares:
//
//   { "version": 1, "root": { "split": "row", "sizes": [0.6, 0.4], "children": [
//       { "panel": "positions" },
//       { "split": "column", "sizes": [0.5, 0.5], "children": [{ "panel": "orders" }, { "panel": "chart" }] } ] } }
//
// A person resizes by dragging the gutter between two panels (or focusing it
// and using the arrow keys), and rearranges by dragging a panel's grip onto
// another panel: onto an edge to dock beside it, onto the middle to swap. The
// grip's arrow keys swap a panel with its neighbour that way. No panel goes
// below its data-min (pixels, default 120).
//
// The panels never move in the document: each is placed by style over one
// positioned box, so a grid, a feed or a frame inside keeps its state when
// the arrangement changes. Tab order is the page's source order.
//
// The arrangement is remembered per person, in the browser (localStorage,
// under "om-panels:<layout-id>"), and each change fires om-layout, which a
// page may cancel to keep it somewhere else instead.

const VERSION = 1;
const DEFAULT_MIN = 120;
const STORE = "om-panels:";
const STEP = 16;
const BIG_STEP = 64;
const DRAG_START = 4;
const EDGE = 0.25;
const EPS = 1e-6;
const HALF = "var(--om-panels-gap, 8px) / 2";

// ── The arrangement, as data ───────────────────────────────────────────────

const isLeaf = (n) => n && typeof n.panel === "string";

function normaliseSizes(sizes) {
  const total = sizes.reduce((a, b) => a + b, 0);
  return total > 0 ? sizes.map((s) => s / total) : sizes.map(() => 1 / sizes.length);
}

// A split whose child splits the same way takes that child's children, in
// its share.
function flatten(node) {
  if (isLeaf(node)) return node;
  const children = [];
  const sizes = [];
  node.children.forEach((c, i) => {
    if (!isLeaf(c) && c.split === node.split) {
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push(node.sizes[i] * c.sizes[j]);
      });
    } else {
      children.push(c);
      sizes.push(node.sizes[i]);
    }
  });
  return { split: node.split, sizes: normaliseSizes(sizes), children };
}

function clean(node, ids, seen) {
  if (!node || typeof node !== "object") return null;
  if (isLeaf(node)) {
    if (!ids.has(node.panel) || seen.has(node.panel)) return null;
    seen.add(node.panel);
    return { panel: node.panel };
  }
  if ((node.split !== "row" && node.split !== "column") || !Array.isArray(node.children)) return null;
  const children = [];
  const sizes = [];
  node.children.forEach((c, i) => {
    const kept = clean(c, ids, seen);
    if (!kept) return;
    const s = Number(Array.isArray(node.sizes) ? node.sizes[i] : NaN);
    children.push(kept);
    sizes.push(Number.isFinite(s) && s > 0 ? s : 1 / node.children.length);
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return flatten({ split: node.split, sizes: normaliseSizes(sizes), children });
}

function append(root, id) {
  if (!root) return { panel: id };
  if (isLeaf(root)) return { split: "row", sizes: [0.5, 0.5], children: [root, { panel: id }] };
  const n = root.children.length;
  return { split: root.split, sizes: [...root.sizes.map((s) => (s * n) / (n + 1)), 1 / (n + 1)], children: [...root.children, { panel: id }] };
}

/** An arrangement fitted to the panels there are: unknown ones dropped, missing ones added at the end. Null when it is not an arrangement. */
export function normaliseLayout(layout, panelIds) {
  const ids = new Set(panelIds);
  if (!layout || typeof layout !== "object") return null;
  if ("version" in layout && layout.version !== VERSION) return null;
  const seen = new Set();
  let root = clean("root" in layout ? layout.root : layout, ids, seen);
  if (!root) return null;
  for (const id of panelIds) if (!seen.has(id)) root = append(root, id);
  return root;
}

/** Every panel side by side (row) or one above another (column), in equal shares. */
export function evenLayout(panelIds, direction = "row") {
  if (!panelIds.length) return null;
  if (panelIds.length === 1) return { panel: panelIds[0] };
  return {
    split: direction === "column" ? "column" : "row",
    sizes: panelIds.map(() => 1 / panelIds.length),
    children: panelIds.map((panel) => ({ panel })),
  };
}

function clone(node) {
  return JSON.parse(JSON.stringify(node));
}

function without(node, id) {
  if (isLeaf(node)) return node.panel === id ? null : node;
  const children = [];
  const sizes = [];
  node.children.forEach((c, i) => {
    const kept = without(c, id);
    if (!kept) return;
    children.push(kept);
    sizes.push(node.sizes[i]);
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return flatten({ split: node.split, sizes: normaliseSizes(sizes), children });
}

function swapIds(node, a, b) {
  if (isLeaf(node)) return { panel: node.panel === a ? b : node.panel === b ? a : node.panel };
  return { ...node, children: node.children.map((c) => swapIds(c, a, b)) };
}

function dock(node, target, id, where) {
  const axis = where === "left" || where === "right" ? "row" : "column";
  const before = where === "left" || where === "top";
  if (isLeaf(node)) {
    if (node.panel !== target) return node;
    return { split: axis, sizes: [0.5, 0.5], children: before ? [{ panel: id }, node] : [node, { panel: id }] };
  }
  const i = node.children.findIndex((c) => isLeaf(c) && c.panel === target);
  if (i >= 0 && node.split === axis) {
    const children = node.children.slice();
    const sizes = node.sizes.slice();
    const half = sizes[i] / 2;
    sizes[i] = half;
    children.splice(before ? i : i + 1, 0, { panel: id });
    sizes.splice(before ? i : i + 1, 0, half);
    return { split: node.split, sizes, children };
  }
  return flatten({ ...node, children: node.children.map((c) => dock(c, target, id, where)) });
}

/**
 * The arrangement with panel `id` moved to `target`: "swap" (their places
 * exchanged), or "left", "right", "top" or "bottom" (docked on that side of
 * it, sharing its space).
 */
export function movePanel(root, id, target, where) {
  if (id === target || !root) return clone(root);
  if (where === "swap") return swapIds(root, id, target);
  if (!["left", "right", "top", "bottom"].includes(where)) throw new TypeError(`om-panels: "${where}" is not a place to move to`);
  const rest = without(clone(root), id);
  return rest ? dock(rest, target, id, where) : clone(root);
}

/** Each panel's rectangle, and each gutter's, as shares of the whole (0 to 1). */
export function placeLayout(root) {
  const panels = new Map();
  const gutters = [];
  const walk = (node, x, y, w, h) => {
    if (isLeaf(node)) {
      panels.set(node.panel, { x, y, w, h });
      return;
    }
    const row = node.split === "row";
    let off = 0;
    node.children.forEach((c, i) => {
      const s = node.sizes[i];
      if (row) walk(c, x + off * w, y, s * w, h);
      else walk(c, x, y + off * h, w, s * h);
      off += s;
      if (i < node.children.length - 1) {
        gutters.push({ node, index: i, split: node.split, extent: row ? w : h, x: row ? x + off * w : x, y: row ? y : y + off * h, w: row ? 0 : w, h: row ? h : 0 });
      }
    });
  };
  if (root) walk(root, 0, 0, 1, 1);
  return { panels, gutters };
}

function firstLeaf(node) {
  return isLeaf(node) ? node.panel : firstLeaf(node.children[0]);
}

function rounded(node) {
  if (isLeaf(node)) return { panel: node.panel };
  // Four places, the last share the remainder, so the shares sum to one and
  // an arrangement read back is the arrangement stored.
  const sizes = node.sizes.map((s) => Math.round(s * 10000));
  sizes[sizes.length - 1] = 10000 - sizes.slice(0, -1).reduce((a, b) => a + b, 0);
  return { split: node.split, sizes: sizes.map((s) => s / 10000), children: node.children.map(rounded) };
}

// ── The element ─────────────────────────────────────────────────────────────

export class OmPanels extends HTMLElement {
  static get observedAttributes() {
    return ["direction", "layout-id"];
  }

  #root = null;
  #given = null; // the page's default arrangement, as given
  // The arrangement the current one is fitted from: the page's, the stored
  // one, or the last a person made; null for the default. Kept as given, so
  // panels that arrive after it (a parser, a framework) still take their
  // places in it.
  #source = null;
  #panels = new Map(); // id -> element
  #gutters = []; // gutter elements, in placeLayout's order
  #live = null;
  #drop = null;
  #observer = null;
  #built = false;

  connectedCallback() {
    if (!this.#built) {
      this.#built = true;
      this.#live = document.createElement("div");
      this.#live.className = "visually-hidden om-panels-live";
      this.#live.setAttribute("aria-live", "polite");
      this.#drop = document.createElement("div");
      this.#drop.className = "om-panels-drop";
      this.#drop.hidden = true;
      this.append(this.#live, this.#drop);
      // The page's own (set before connecting, restored from its own store)
      // wins over the browser's.
      this.#source ??= this.#load();
      this.#rescan(true);
    }
    if (!this.#observer && globalThis.MutationObserver) {
      this.#observer = new MutationObserver(() => this.#rescan());
      this.#observer.observe(this, { childList: true });
    }
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  attributeChangedCallback(name) {
    if (!this.#built) return;
    if (name === "direction" && !this.#source) this.#fit();
    if (name === "layout-id") {
      // Another arrangement's name: its stored one, or the default.
      this.#source = this.#load();
      this.#fit();
    }
  }

  // ── The API ──────────────────────────────────────────────────────────────

  /** The panels' ids, in source order. */
  get panels() {
    return [...this.#panels.keys()];
  }

  /** The arrangement, serialisable: { version, root }. */
  get layout() {
    return { version: VERSION, root: this.#root ? rounded(this.#root) : null };
  }

  /** Arrange the panels (a page restoring what it stored itself). Fires nothing, stores nothing. */
  set layout(value) {
    if (this.#built && !normaliseLayout(value, this.panels)) throw new TypeError("om-panels: not an arrangement of these panels");
    this.#source = value;
    if (this.#built) this.#fit();
  }

  /** The arrangement for a person who has none: used first, and by reset(). */
  get defaultLayout() {
    const root = this.#given && normaliseLayout(this.#given, this.panels);
    return root ? { version: VERSION, root: rounded(root) } : null;
  }

  set defaultLayout(value) {
    if (this.#built && value && !normaliseLayout(value, this.panels)) {
      throw new TypeError("om-panels: not an arrangement of these panels");
    }
    this.#given = value || null;
    if (this.#built && !this.#source) this.#fit();
  }

  /** Move panel `id` to `target`: "swap", "left", "right", "top" or "bottom". */
  move(id, target, where = "swap") {
    if (!this.#panels.has(id) || !this.#panels.has(target)) throw new TypeError(`om-panels: no panel "${this.#panels.has(id) ? target : id}"`);
    this.#root = movePanel(this.#root, id, target, where);
    this.#rebuild();
    this.#commit("move");
  }

  /** Back to the default arrangement, forgetting the stored one. */
  reset() {
    this.#source = null;
    this.#fit();
    this.#commit("reset");
  }

  // ── Panels ───────────────────────────────────────────────────────────────

  // The arrangement, fitted to the panels there are now.
  #fit() {
    const fitted = this.#source && normaliseLayout(this.#source, this.panels);
    const given = !fitted && this.#given && normaliseLayout(this.#given, this.panels);
    this.#root = fitted || given || evenLayout(this.panels, this.getAttribute("direction") || "row");
    this.#rebuild();
  }

  #scan() {
    this.#panels.clear();
    for (const el of this.querySelectorAll(":scope > [data-panel]")) {
      const id = el.dataset.panel;
      if (!id || this.#panels.has(id)) continue;
      this.#panels.set(id, el);
      this.#decorate(id, el);
    }
  }

  #rescan(force = false) {
    const before = this.panels.join("\n");
    this.#scan();
    if (force || this.panels.join("\n") !== before) this.#fit();
  }

  #title(id) {
    return this.#panels.get(id)?.dataset.title || id;
  }

  #decorate(id, el) {
    el.classList.add("om-panel");
    if (!el.hasAttribute("role") && el.dataset.title) {
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", el.dataset.title);
    }
    if (el.querySelector(":scope > .om-panel-head")) return;
    const head = document.createElement("div");
    head.className = "om-panel-head";
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "om-panel-grip";
    grip.textContent = "⠿";
    grip.setAttribute("aria-label", `Move ${this.#title(id)}`);
    grip.title = "Drag onto another panel to move it; arrow keys swap it with a neighbour";
    grip.addEventListener("pointerdown", (e) => this.#grab(e, id, grip));
    grip.addEventListener("keydown", (e) => this.#gripKey(e, id));
    head.append(grip);
    if (el.dataset.title) {
      const t = document.createElement("span");
      t.className = "om-panel-title";
      t.textContent = el.dataset.title;
      head.append(t);
    }
    el.prepend(head);
  }

  #min(id) {
    const m = Number(this.#panels.get(id)?.dataset.min);
    return Number.isFinite(m) && m >= 0 ? m : DEFAULT_MIN;
  }

  // The least a subtree may be along an axis, in pixels.
  #minOf(node, axis) {
    if (isLeaf(node)) return this.#min(node.panel);
    const mins = node.children.map((c) => this.#minOf(c, axis));
    return node.split === axis ? mins.reduce((a, b) => a + b, 0) : Math.max(...mins);
  }

  // ── Placing ──────────────────────────────────────────────────────────────

  #rebuild() {
    for (const g of this.#gutters) g.remove();
    this.#gutters = [];
    const { gutters } = placeLayout(this.#root);
    for (const g of gutters) {
      const el = document.createElement("div");
      el.className = "om-panels-gutter";
      el.tabIndex = 0;
      el.setAttribute("role", "separator");
      // A row's gutter stands between left and right: a vertical separator.
      el.setAttribute("aria-orientation", g.split === "row" ? "vertical" : "horizontal");
      el.setAttribute("aria-valuemin", "0");
      el.setAttribute("aria-valuemax", "100");
      el.setAttribute("aria-label", `Resize ${this.#title(firstLeaf(g.node.children[g.index]))} and ${this.#title(firstLeaf(g.node.children[g.index + 1]))}`);
      const k = this.#gutters.length;
      el.addEventListener("pointerdown", (e) => this.#resizeStart(e, k));
      el.addEventListener("keydown", (e) => this.#resizeKey(e, k));
      this.insertBefore(el, this.#live);
      this.#gutters.push(el);
    }
    this.#place();
  }

  #place() {
    const { panels, gutters } = placeLayout(this.#root);
    const pct = (v) => `${(v * 100).toFixed(4)}%`;
    for (const [id, el] of this.#panels) {
      const r = panels.get(id);
      el.hidden = !r;
      if (!r) continue;
      const l = r.x > EPS ? HALF : "0px";
      const rr = r.x + r.w < 1 - EPS ? HALF : "0px";
      const t = r.y > EPS ? HALF : "0px";
      const b = r.y + r.h < 1 - EPS ? HALF : "0px";
      el.style.left = `calc(${pct(r.x)} + ${l})`;
      el.style.top = `calc(${pct(r.y)} + ${t})`;
      el.style.width = `calc(${pct(r.w)} - ${l} - ${rr})`;
      el.style.height = `calc(${pct(r.h)} - ${t} - ${b})`;
    }
    gutters.forEach((g, k) => {
      const el = this.#gutters[k];
      if (!el) return;
      const row = g.split === "row";
      el.style.left = row ? `calc(${pct(g.x)} - ${HALF})` : pct(g.x);
      el.style.top = row ? pct(g.y) : `calc(${pct(g.y)} - ${HALF})`;
      el.style.width = row ? "var(--om-panels-gap, 8px)" : pct(g.w);
      el.style.height = row ? pct(g.h) : "var(--om-panels-gap, 8px)";
      const a = g.node.sizes[g.index];
      const share = a / (a + g.node.sizes[g.index + 1]);
      el.setAttribute("aria-valuenow", String(Math.round(share * 100)));
    });
  }

  #say(text) {
    this.#live.textContent = text;
  }

  // ── Remembering ──────────────────────────────────────────────────────────

  #key() {
    const id = this.getAttribute("layout-id");
    return id ? STORE + id : null;
  }

  #load() {
    const key = this.#key();
    if (!key) return null;
    try {
      const raw = globalThis.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // storage refused, or not ours to read: the default it is
    }
  }

  #commit(reason) {
    const layout = this.layout;
    if (reason !== "reset") this.#source = layout;
    const go = this.dispatchEvent(
      new CustomEvent("om-layout", { bubbles: true, cancelable: true, detail: { id: this.getAttribute("layout-id"), layout, reason } }),
    );
    const key = this.#key();
    if (!go || !key) return;
    try {
      if (reason === "reset") globalThis.localStorage.removeItem(key);
      else globalThis.localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      // Storage refused (private mode, full, blocked): the arrangement holds for this visit.
    }
  }

  // ── Resizing ─────────────────────────────────────────────────────────────

  // The pixels a gutter's split spans along its axis.
  #extentPx(g) {
    const box = this.getBoundingClientRect();
    return (g.split === "row" ? box.width : box.height) * g.extent;
  }

  // Set the share of the two children either side of gutter k to put `a` of
  // their pair's pixels first, held to each side's minimum.
  #setPair(g, aPx, pairPx, extentPx) {
    const { node, index } = g;
    const pairShare = node.sizes[index] + node.sizes[index + 1];
    const axis = g.split;
    const minA = this.#minOf(node.children[index], axis);
    const minB = this.#minOf(node.children[index + 1], axis);
    let a = aPx;
    if (pairPx > minA + minB) a = Math.min(Math.max(a, minA), pairPx - minB);
    else a = pairPx / 2; // too small to hold both minimums: share evenly
    const aShare = extentPx > 0 ? (a / extentPx) : node.sizes[index];
    node.sizes[index] = Math.max(EPS, Math.min(pairShare - EPS, aShare));
    node.sizes[index + 1] = pairShare - node.sizes[index];
    this.#place();
  }

  #resizeStart(e, k) {
    if (e.button !== 0) return;
    const g = placeLayout(this.#root).gutters[k];
    const el = this.#gutters[k];
    if (!g || !el) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    const extentPx = this.#extentPx(g);
    const pairPx = (g.node.sizes[g.index] + g.node.sizes[g.index + 1]) * extentPx;
    const startA = g.node.sizes[g.index] * extentPx;
    const start = g.split === "row" ? e.clientX : e.clientY;
    this.setAttribute("resizing", "");
    const move = (ev) => this.#setPair(g, startA + ((g.split === "row" ? ev.clientX : ev.clientY) - start), pairPx, extentPx);
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      this.removeAttribute("resizing");
      this.#commit("resize");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  #resizeKey(e, k) {
    const g = placeLayout(this.#root).gutters[k];
    if (!g) return;
    const row = g.split === "row";
    const less = row ? "ArrowLeft" : "ArrowUp";
    const more = row ? "ArrowRight" : "ArrowDown";
    if (![less, more, "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let extentPx = this.#extentPx(g);
    const unmeasured = !(extentPx > 0);
    if (unmeasured) extentPx = 1000; // no layout to measure: steps as shares of a notional 1000
    const pairPx = (g.node.sizes[g.index] + g.node.sizes[g.index + 1]) * extentPx;
    const a = g.node.sizes[g.index] * extentPx;
    const step = e.shiftKey ? BIG_STEP : STEP;
    const to = e.key === less ? a - step : e.key === more ? a + step : e.key === "Home" ? 0 : pairPx;
    this.#setPair(g, to, pairPx, extentPx);
    this.#commit("resize");
  }

  // ── Rearranging ──────────────────────────────────────────────────────────

  // Which panel, and which part of it, a point (in shares of the whole) is over.
  #target(fx, fy, self) {
    for (const [id, r] of placeLayout(this.#root).panels) {
      if (id === self || fx < r.x || fx > r.x + r.w || fy < r.y || fy > r.y + r.h) continue;
      const dx = (fx - r.x) / r.w;
      const dy = (fy - r.y) / r.h;
      const edges = [["left", dx], ["right", 1 - dx], ["top", dy], ["bottom", 1 - dy]].sort((p, q) => p[1] - q[1]);
      const where = edges[0][1] < EDGE ? edges[0][0] : "swap";
      return { id, where, r };
    }
    return null;
  }

  #showDrop(t) {
    if (!t) {
      this.#drop.hidden = true;
      return;
    }
    let { x, y, w, h } = t.r;
    if (t.where === "left") w /= 2;
    if (t.where === "right") { x += w / 2; w /= 2; }
    if (t.where === "top") h /= 2;
    if (t.where === "bottom") { y += h / 2; h /= 2; }
    Object.assign(this.#drop.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
    this.#drop.hidden = false;
  }

  #grab(e, id, grip) {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture?.(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let target = null;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START) return;
      if (!dragging) {
        dragging = true;
        this.setAttribute("dragging", "");
        this.#panels.get(id).classList.add("om-panel-lifted");
      }
      const box = this.getBoundingClientRect();
      if (!(box.width > 0 && box.height > 0)) return;
      target = this.#target((ev.clientX - box.left) / box.width, (ev.clientY - box.top) / box.height, id);
      this.#showDrop(target);
    };
    const finish = (ev) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", finish);
      grip.removeEventListener("pointercancel", finish);
      grip.removeEventListener("keydown", cancel);
      this.removeAttribute("dragging");
      this.#panels.get(id)?.classList.remove("om-panel-lifted");
      this.#showDrop(null);
      if (dragging && target && ev.type === "pointerup") {
        this.move(id, target.id, target.where);
        this.#say(target.where === "swap" ? `${this.#title(id)} swapped with ${this.#title(target.id)}` : `${this.#title(id)} moved ${target.where} of ${this.#title(target.id)}`);
      }
    };
    const cancel = (ev) => {
      if (ev.key !== "Escape") return;
      target = null;
      finish({ type: "cancel" });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
    grip.addEventListener("keydown", cancel);
  }

  // The grip's arrow keys swap the panel with its nearest neighbour that way.
  #gripKey(e, id) {
    const dirs = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    const dir = dirs[e.key];
    if (!dir) return;
    e.preventDefault();
    const { panels } = placeLayout(this.#root);
    const me = panels.get(id);
    const overlaps = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > EPS;
    let best = null;
    for (const [other, r] of panels) {
      if (other === id) continue;
      let gap;
      if (dir === "left" && r.x + r.w <= me.x + EPS && overlaps(me.y, me.y + me.h, r.y, r.y + r.h)) gap = me.x - (r.x + r.w);
      else if (dir === "right" && r.x >= me.x + me.w - EPS && overlaps(me.y, me.y + me.h, r.y, r.y + r.h)) gap = r.x - (me.x + me.w);
      else if (dir === "up" && r.y + r.h <= me.y + EPS && overlaps(me.x, me.x + me.w, r.x, r.x + r.w)) gap = me.y - (r.y + r.h);
      else if (dir === "down" && r.y >= me.y + me.h - EPS && overlaps(me.x, me.x + me.w, r.x, r.x + r.w)) gap = r.y - (me.y + me.h);
      else continue;
      if (!best || gap < best.gap) best = { id: other, gap };
    }
    if (!best) {
      this.#say(`${this.#title(id)} cannot move ${dir}`);
      return;
    }
    this.move(id, best.id, "swap");
    this.#say(`${this.#title(id)} moved ${dir}, swapped with ${this.#title(best.id)}`);
  }
}

if (!customElements.get("om-panels")) customElements.define("om-panels", OmPanels);
