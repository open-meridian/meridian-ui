// The theme applier (src/meridian.js): the query on first load, the parent
// frame's message on change, and nothing from anywhere else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { read } from "./helpers.mjs";

const SOURCE = read("src/meridian.js");
const KIT = "https://plugin.example/.meridian/ui/0.1.0/";

/** A page at `url`, framed by `parent` unless it is null, with the kit's script run in it. */
function page(url, { parent = {}, storage } = {}) {
  const win = new Window({
    url,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true },
  });
  const framedBy = parent === null ? win : parent;
  Object.defineProperty(win, "parent", { value: framedBy, configurable: true });
  // As if linked from the kit's base, with components not loaded (not under test here).
  Object.defineProperty(win.document, "currentScript", {
    value: { src: `${KIT}meridian.js`, hasAttribute: (n) => n === "data-no-components" },
    configurable: true,
  });
  if (storage) win.sessionStorage.setItem("om-theme", JSON.stringify(storage));
  new Function("window", SOURCE)(win);
  return { win, root: win.document.documentElement, parent: framedBy };
}

function message(win, data, source) {
  const e = new win.MessageEvent("message", { data });
  Object.defineProperty(e, "source", { value: source });
  win.dispatchEvent(e);
}

const link = (win) => win.document.getElementById("om-scheme");

test("the query applies the scheme and mode on first load, from the kit's own base", () => {
  const { win, root } = page("https://plugin.example/admin?om-scheme=harbour&om-mode=dark");
  assert.equal(root.getAttribute("data-om-mode"), "dark");
  assert.equal(root.getAttribute("data-om-scheme"), "harbour");
  assert.equal(link(win).getAttribute("href"), `${KIT}schemes/harbour.css`);
  assert.deepEqual(win.Meridian.theme.current(), { scheme: "harbour", mode: "dark", resolved: "dark" });
  assert.equal(win.Meridian.kit.base, KIT);
});

test("no query is the brand default, following the system; the default loads nothing extra", () => {
  const { win, root } = page("https://plugin.example/admin");
  assert.equal(root.getAttribute("data-om-mode"), "system");
  assert.equal(root.getAttribute("data-om-scheme"), "default");
  assert.equal(link(win), null);
});

test("an invalid scheme or mode is ignored, not guessed", () => {
  const { win, root } = page("https://plugin.example/admin?om-scheme=..%2Fevil&om-mode=sepia");
  assert.equal(root.getAttribute("data-om-scheme"), "default");
  assert.equal(root.getAttribute("data-om-mode"), "system");
  assert.equal(link(win), null);
});

test("a theme message from the parent frame switches scheme and mode live", () => {
  const { win, root, parent } = page("https://plugin.example/admin?om-scheme=default&om-mode=light");
  const seen = [];
  win.addEventListener("om-theme", (e) => seen.push(e.detail));
  message(win, { type: "meridian:theme", version: 1, scheme: "harbour", mode: "dark" }, parent);
  assert.equal(root.getAttribute("data-om-mode"), "dark");
  assert.equal(root.getAttribute("data-om-scheme"), "harbour");
  assert.equal(link(win).getAttribute("href"), `${KIT}schemes/harbour.css`);
  assert.deepEqual(seen, [{ scheme: "harbour", mode: "dark", resolved: "dark" }]);
  // Back to the default: the extra stylesheet goes.
  message(win, { type: "meridian:theme", version: 1, scheme: "default", mode: "light" }, parent);
  assert.equal(link(win), null);
  assert.equal(root.getAttribute("data-om-mode"), "light");
  // A message may change one of the two.
  message(win, { type: "meridian:theme", version: 1, mode: "system" }, parent);
  assert.equal(root.getAttribute("data-om-mode"), "system");
  assert.equal(root.getAttribute("data-om-scheme"), "default");
});

test("a theme message from any other source is ignored", () => {
  const { win, root } = page("https://plugin.example/admin?om-mode=light");
  const other = {};
  message(win, { type: "meridian:theme", version: 1, scheme: "harbour", mode: "dark" }, other);
  message(win, { type: "meridian:theme", version: 1, scheme: "harbour", mode: "dark" }, win);
  message(win, { type: "meridian:theme", version: 1, scheme: "harbour", mode: "dark" }, null);
  assert.equal(root.getAttribute("data-om-mode"), "light");
  assert.equal(root.getAttribute("data-om-scheme"), "default");
  assert.equal(link(win), null);
});

test("an unframed page takes no theme message, even from itself", () => {
  const { win, root } = page("https://plugin.example/admin?om-mode=light", { parent: null });
  message(win, { type: "meridian:theme", version: 1, scheme: "harbour", mode: "dark" }, win);
  assert.equal(root.getAttribute("data-om-mode"), "light");
});

test("the parent's other messages, and a bad scheme in a theme message, change nothing", () => {
  const { win, root, parent } = page("https://plugin.example/admin?om-scheme=harbour&om-mode=dark");
  message(win, { type: "meridian:resize", height: 400 }, parent);
  message(win, "meridian:theme", parent);
  message(win, { type: "meridian:theme", version: 1, scheme: "../../x", mode: "dusk" }, parent);
  assert.equal(root.getAttribute("data-om-scheme"), "harbour");
  assert.equal(root.getAttribute("data-om-mode"), "dark");
});

test("a scheme that fails to load falls back to the brand default", () => {
  const { win, root } = page("https://plugin.example/admin?om-scheme=missing");
  const seen = [];
  win.addEventListener("om-theme", (e) => seen.push(e.detail.scheme));
  link(win).dispatchEvent(new win.Event("error"));
  assert.equal(link(win), null);
  assert.equal(root.getAttribute("data-om-scheme"), "default");
  assert.deepEqual(seen, ["default"]);
});

test("a navigation inside the frame that drops the query keeps the tab's theme", () => {
  const { root } = page("https://plugin.example/admin/next", { storage: { scheme: "harbour", mode: "dark" } });
  assert.equal(root.getAttribute("data-om-scheme"), "harbour");
  assert.equal(root.getAttribute("data-om-mode"), "dark");
  // And the query, when present, wins over what was kept.
  const again = page("https://plugin.example/admin?om-mode=light", { storage: { scheme: "harbour", mode: "dark" } });
  assert.equal(again.root.getAttribute("data-om-mode"), "light");
  assert.equal(again.root.getAttribute("data-om-scheme"), "harbour");
});

test("the components load from the kit's base unless the page says not to", () => {
  const win = new Window({ url: "https://plugin.example/admin", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  Object.defineProperty(win.document, "currentScript", { value: { src: `${KIT}meridian.js`, hasAttribute: () => false }, configurable: true });
  new Function("window", SOURCE)(win);
  const s = win.document.querySelector('script[type="module"]');
  assert.equal(s.getAttribute("src"), `${KIT}components/index.js`);
});
