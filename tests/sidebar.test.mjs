// om-sidebar, in a headless DOM (happy-dom): the groups as data, the current
// item (by attribute, by data, by address), collapsing and remembering it,
// the drawer below 768px, and the icons. The real browser's checks (sizes,
// themes, the keyboard, focus) are tools/fit.mjs's.

import "./dom.mjs";
import "../src/components/index.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { currentIndex, matchScore, normaliseGroups } from "../src/components/om-sidebar.js";
import { ICON_NAMES, hasIcon, iconSvg } from "../src/lib/icons.js";
import { put, settle } from "./helpers.mjs";

const DATA = {
  groups: [
    { label: "Plugins", items: [
      { id: "plugins", label: "Plugins", href: "/admin#plugins", icon: "grid" },
      { id: "versions", label: "Versions · Browse · Registries", href: "/plugins?tab=installed", icon: "package", also: ["/plugins?tab=browse", "/plugins?tab=registries"] },
    ] },
    { label: "Accounts", items: [
      { id: "accounts", label: "Accounts", href: "/admin#accounts", icon: "wallet" },
      { id: "holds", label: "Holds", href: "/admin#holds", icon: "no-such-icon" },
    ] },
    { label: "Data", items: [{ id: "instruments", label: "Instruments", href: "/admin/instruments" }] },
  ],
};

const realMatchMedia = globalThis.matchMedia;
function screen(narrow) {
  globalThis.matchMedia = (q) => ({ matches: narrow && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} });
}

async function sidebar(attrs = "", data = DATA, extra = "") {
  const el = put(`<om-sidebar ${attrs}><script type="application/json">${JSON.stringify(data)}</script>${extra}</om-sidebar>`);
  await settle();
  return el;
}

const links = (el) => [...el.querySelectorAll("a.om-sidebar-link")];
const current = (el) => links(el).filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);

beforeEach(() => {
  screen(false);
  try {
    globalThis.localStorage.clear();
  } catch {
    /* not every test leaves storage readable */
  }
  history.replaceState(null, "", "https://plugin.example/app/");
});

afterEach(() => {
  globalThis.matchMedia = realMatchMedia;
});

// ── The data ────────────────────────────────────────────────────────────────

test("the groups are kept to their shape, what is not dropped", () => {
  const groups = normaliseGroups({
    groups: [
      { label: "A", items: [{ label: "One", href: "/one" }, { label: "", href: "/x" }, { label: "No href" }, null] },
      { label: "Empty", items: [] },
      { label: "No items" },
      "nonsense",
    ],
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items, [{ id: null, label: "One", href: "/one", icon: null, also: [], current: false }]);
  assert.deepEqual(normaliseGroups(null), []);
  assert.equal(normaliseGroups([{ label: "Bare", items: [{ label: "x", href: "/x" }] }]).length, 1, "an array of groups is taken too");
});

test("an address names the page by its path, its query and its hash", () => {
  const at = (u) => new URL(u, "https://d.example/");
  assert.equal(matchScore("/admin#holds", at("/admin#holds")), 2);
  assert.equal(matchScore("/admin#holds", at("/admin#accounts")), null, "another hash");
  assert.equal(matchScore("/admin#holds", at("/admin")), -1, "no hash on the page: a weak match");
  assert.equal(matchScore("/admin", at("/admin/instruments")), null, "another path");
  assert.equal(matchScore("/plugins?tab=browse", at("/plugins?tab=browse&offset=20")), 2, "the page may have more query");
  assert.equal(matchScore("/plugins?tab=browse", at("/plugins")), null, "a query the page lacks");
  assert.equal(matchScore("https://other.example/admin", at("/admin")), null, "another origin");

  const items = normaliseGroups(DATA).flatMap((g) => g.items);
  const index = (u) => currentIndex(items, at(u));
  assert.equal(items[index("/admin")].id, "plugins", "a page of hash tabs with none: its first");
  assert.equal(items[index("/admin#holds")].id, "holds");
  assert.equal(items[index("/plugins?tab=registries")].id, "versions", "one of its other addresses");
  assert.equal(items[index("/admin/instruments?q=EUR")].id, "instruments");
  assert.equal(index("/elsewhere"), -1);
});

// ── The element ─────────────────────────────────────────────────────────────

test("om-sidebar draws its groups as plain links, each group named", async () => {
  const el = await sidebar('label="Settings"', DATA, '<nav aria-label="Settings"><a href="/admin#plugins">Plugins</a></nav>');
  const nav = el.querySelector(":scope > nav.om-sidebar-nav");
  assert.equal(nav.getAttribute("aria-label"), "Settings");
  assert.ok(el.querySelector(":scope > nav:not(.om-sidebar-nav)").hidden, "the server's own links are hidden once drawn");
  const groups = [...el.querySelectorAll(".om-sidebar-group")];
  assert.deepEqual(groups.map((g) => g.getAttribute("role")), ["group", "group", "group"]);
  assert.deepEqual(groups.map((g) => document.getElementById(g.getAttribute("aria-labelledby")).textContent), ["Plugins", "Accounts", "Data"]);
  assert.deepEqual(links(el).map((a) => a.getAttribute("href")), ["/admin#plugins", "/plugins?tab=installed", "/admin#accounts", "/admin#holds", "/admin/instruments"]);
  assert.ok(links(el)[0].querySelector("svg.om-icon"), "a known icon is drawn");
  const holds = links(el)[3].querySelector(".om-sidebar-icon");
  assert.ok(holds.classList.contains("om-sidebar-letter") && holds.dataset.letter === "H" && links(el)[3].textContent === "Holds", "an unknown icon is the label's first letter");
  assert.equal(holds.getAttribute("aria-hidden"), "true");
});

test("the current item: the attribute's, else the data's, else the address's", async () => {
  history.replaceState(null, "", "https://plugin.example/admin#holds");
  const el = await sidebar();
  assert.deepEqual(current(el), ["Holds"]);
  assert.equal(el.querySelector(".om-sidebar-here").textContent, "Holds", "the bar says where the page is");
  assert.deepEqual(el.currentItem, { id: "holds", label: "Holds", href: "/admin#holds", group: "Accounts" });

  history.replaceState(null, "", "https://plugin.example/admin#accounts");
  window.dispatchEvent(new Event("hashchange"));
  assert.deepEqual(current(el), ["Accounts"], "it follows a hash tab");

  el.setAttribute("current", "plugins");
  assert.deepEqual(current(el), ["Plugins"], "a Manage page names Plugins");
  el.setAttribute("current", "no-such-item");
  assert.deepEqual(current(el), ["Accounts"], "an id it lacks is no override");

  const marked = structuredClone(DATA);
  marked.groups[2].items[0].current = true;
  el.groups = marked;
  assert.deepEqual(current(el), ["Instruments"], "the data may mark it");
});

test("groups and items added later draw with no change to the element", async () => {
  const el = await sidebar();
  const more = structuredClone(DATA);
  more.groups.push({ label: "Deployment", items: [{ id: "time-zone", label: "Time zone", href: "/admin#time-zone", icon: "clock" }, { id: "backups", label: "Later", href: "/admin#later" }] });
  el.groups = more;
  assert.equal(el.querySelectorAll(".om-sidebar-group").length, 4);
  assert.equal(links(el).at(-1).getAttribute("href"), "/admin#later");
  assert.equal(el.groups[3].items[0].icon, "clock");
});

test("collapsing is the person's choice, remembered, with a working default", async () => {
  let el = await sidebar('remember="admin"');
  assert.equal(el.collapsed, false, "open by default");
  const button = el.querySelector("button.om-sidebar-collapse");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.match(button.textContent, /Collapse the menu/);
  let said = null;
  el.addEventListener("om-collapse", (e) => { said = e.detail; });
  button.click();
  assert.ok(el.collapsed && el.hasAttribute("collapsed"));
  assert.deepEqual(said, { collapsed: true });
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.match(button.textContent, /Expand the menu/);
  assert.equal(links(el)[0].title, "Plugins", "collapsed, a link's words are its tooltip");
  assert.equal(localStorage.getItem("om-sidebar:admin"), "collapsed");

  el = await sidebar('remember="admin"');
  assert.equal(el.collapsed, true, "remembered on the next page");
  el.collapsed = false;
  assert.equal(localStorage.getItem("om-sidebar:admin"), "expanded");
  assert.equal(links(el)[0].hasAttribute("title"), false);

  el = await sidebar('remember="other" collapsed');
  assert.equal(el.collapsed, true, "the page's own default, when nothing is remembered");
});

test("storage refused changes only the remembering", async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("refused"); } });
  try {
    const el = await sidebar('remember="admin"');
    assert.equal(el.collapsed, false);
    el.querySelector("button.om-sidebar-collapse").click();
    assert.equal(el.collapsed, true, "it still collapses");
  } finally {
    if (real) Object.defineProperty(globalThis, "localStorage", real);
    else delete globalThis.localStorage;
  }
});

test("below 768px it is a bar whose Menu opens the sidebar as a drawer, and focus comes back", async () => {
  screen(true);
  history.replaceState(null, "", "https://plugin.example/admin#holds");
  const el = await sidebar('label="Settings"');
  assert.ok(el.hasAttribute("data-narrow"));
  const menu = el.querySelector("button.om-sidebar-open");
  const drawer = el.querySelector("dialog.om-sidebar-drawer");
  assert.equal(menu.getAttribute("aria-controls"), drawer.id);
  assert.equal(menu.getAttribute("aria-expanded"), "false");
  assert.equal(document.getElementById(drawer.getAttribute("aria-labelledby")).textContent, "Settings");

  menu.click();
  assert.ok(el.drawerOpen && drawer.open);
  assert.equal(menu.getAttribute("aria-expanded"), "true");
  assert.ok(drawer.contains(el.querySelector("nav.om-sidebar-nav")), "the sidebar moves into the drawer");
  assert.equal(document.activeElement.textContent, "Holds", "focus on the current item");
  assert.equal(el.querySelector("button.om-sidebar-collapse").hidden, true, "no collapse button in the drawer");

  el.querySelector("button.om-sidebar-close").click();
  assert.equal(el.drawerOpen, false);
  assert.ok(el.querySelector(":scope > nav.om-sidebar-nav"), "back in its place");
  assert.equal(menu.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, menu, "focus back on Menu");
  assert.equal(el.querySelector("button.om-sidebar-collapse").hidden, false, "the collapse button back with the sidebar");

  // Closed as Escape closes it (the dialog's own close): put back the same way.
  menu.click();
  drawer.close();
  drawer.dispatchEvent(new Event("close"));
  await settle();
  assert.ok(el.querySelector(":scope > nav.om-sidebar-nav"));
  assert.equal(document.activeElement, menu);

  // A link followed from the drawer shuts it.
  menu.click();
  links(el)[0].addEventListener("click", (e) => e.preventDefault());
  links(el)[0].click();
  assert.equal(el.drawerOpen, false);
});

test("on a desktop there is no drawer to open", async () => {
  const el = await sidebar();
  el.openDrawer();
  assert.equal(el.drawerOpen, false);
});

test("the icons: the platform's names and the sidebar's, hidden from a screen reader", () => {
  for (const name of ["users", "server", "database", "shield", "menu", "collapse", "expand", "close", "grid", "chart", "package", "route", "key", "bot", "link", "wallet", "layers", "lock", "list", "clock"]) {
    assert.ok(hasIcon(name), name);
  }
  assert.equal(hasIcon("toString"), false);
  assert.equal(iconSvg("nope"), "");
  const svg = iconSvg("clock");
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.doesNotMatch(svg, /#[0-9a-f]{3,6}\b/i, "no colour of its own");
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
});
