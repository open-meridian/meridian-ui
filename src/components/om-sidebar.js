// <om-sidebar>: a page's sections as a grouped left sidebar (0.13.0;
// meridian-design rulings 447 to 451, the admin sidebar). The groups are
// data, so the same element serves the dashboard's administration, a
// plugin's Manage page inside it, and later the platform's staff pages.
//
//   <div class="om-shell">
//     <om-sidebar label="Settings" remember="admin">
//       <script type="application/json">
//         { "groups": [
//           { "label": "Plugins", "items": [
//             { "id": "plugins", "label": "Plugins", "href": "/admin#plugins", "icon": "grid" } ] } ] }
//       </script>
//       <nav aria-label="Settings">…the server's own links, for a browser without the kit…</nav>
//     </om-sidebar>
//     <main class="om-shell-main">…the page, its own tab row and all…</main>
//   </div>
//
// Each item is a plain link: a click is the browser's navigation, never the
// kit's, so every address stays what it was. The current item is marked
// aria-current="page": the one the `current` attribute names by id; else one
// the data marks `current: true`; else the item whose address (or one of its
// `also` addresses) best matches the page's (below), again on every
// hashchange, so a page whose sections are hash tabs keeps it right.
//
// On a desktop it collapses to its icons and back, by its own button; the
// person's choice is remembered in the browser (localStorage, under
// `om-sidebar:<remember>`), and storage that is refused changes nothing but
// the remembering. Below 48rem (768px at the default size) it is a bar with
// a Menu button naming the current item, and the button opens the sidebar as
// a drawer: a modal dialog over the page, so focus stays in it; Escape, a
// click outside or the close button shuts it, and focus returns to Menu.

import { declaredJson, whenParsed } from "../lib/declared.js";
import { hasIcon, iconSvg } from "../lib/icons.js";

/** Where the sidebar becomes a drawer: below 48rem, as components.css says. */
export const NARROW = "(max-width: 47.99rem)";
const STORE = "om-sidebar:";

let serial = 0;

/** The groups declared, kept to their shape: each with a label and its items,
 * each item with a label and an href. What is not of that shape is dropped. */
export function normaliseGroups(data) {
  const groups = Array.isArray(data) ? data : data && Array.isArray(data.groups) ? data.groups : [];
  const out = [];
  for (const g of groups) {
    if (!g || typeof g !== "object" || !Array.isArray(g.items)) continue;
    const items = [];
    for (const it of g.items) {
      if (!it || typeof it !== "object" || typeof it.label !== "string" || !it.label || typeof it.href !== "string") continue;
      items.push({
        id: typeof it.id === "string" && it.id ? it.id : null,
        label: it.label,
        href: it.href,
        icon: typeof it.icon === "string" ? it.icon : null,
        also: Array.isArray(it.also) ? it.also.filter((a) => typeof a === "string") : [],
        current: it.current === true,
      });
    }
    if (items.length) out.push({ id: typeof g.id === "string" && g.id ? g.id : null, label: typeof g.label === "string" ? g.label : "", items });
  }
  return out;
}

/**
 * How well `href` names the page at `here` (a URL): null when it does not;
 * else a score, higher the more it names. Its path must be the page's; each
 * query parameter it gives must be the page's too (the page may have more);
 * and a fragment it gives must be the page's, but for a page with none, where
 * it is a weak match (the first of a page's hash tabs is the one shown).
 */
export function matchScore(href, here) {
  let url;
  try {
    url = new URL(href, here);
  } catch {
    return null;
  }
  if (url.origin !== here.origin || url.pathname !== here.pathname) return null;
  let score = 0;
  for (const [k, v] of url.searchParams) {
    if (here.searchParams.get(k) !== v) return null;
    score += 2;
  }
  if (url.hash) {
    if (url.hash === here.hash) score += 2;
    else if (!here.hash) score -= 1;
    else return null;
  }
  return score;
}

/** The index of the item, among `items` (flattened), that is the page at
 * `here`: the best-matching address, the first of equals; -1 for none. */
export function currentIndex(items, here) {
  let best = -1;
  let bestScore = -Infinity;
  items.forEach((item, i) => {
    for (const href of [item.href, ...item.also]) {
      const s = matchScore(href, here);
      if (s !== null && s > bestScore) {
        best = i;
        bestScore = s;
      }
    }
  });
  return best;
}

export class OmSidebar extends HTMLElement {
  static get observedAttributes() {
    return ["current", "label", "collapsed"];
  }

  #built = false;
  #groups = [];
  #links = [];
  #nav = null;
  #list = null;
  #collapse = null;
  #bar = null;
  #open = null;
  #here = null;
  #drawer = null;
  #mq = null;
  #reflecting = false;
  #onHash = () => this.#mark();
  #onMedia = () => this.#mode();

  connectedCallback() {
    whenParsed(() => {
      if (!this.isConnected) return;
      if (!this.#built) this.#build();
      globalThis.addEventListener?.("hashchange", this.#onHash);
      globalThis.addEventListener?.("popstate", this.#onHash);
      this.#mq = globalThis.matchMedia ? globalThis.matchMedia(NARROW) : null;
      this.#mq?.addEventListener?.("change", this.#onMedia);
      this.#mode();
    });
  }

  disconnectedCallback() {
    globalThis.removeEventListener?.("hashchange", this.#onHash);
    globalThis.removeEventListener?.("popstate", this.#onHash);
    this.#mq?.removeEventListener?.("change", this.#onMedia);
  }

  attributeChangedCallback(name) {
    if (!this.#built) return;
    if (name === "current") this.#mark();
    else if (name === "label") this.#name();
    else if (name === "collapsed" && !this.#reflecting) this.#showCollapsed();
  }

  /** The groups, as declared (normalised). Setting them draws them again. */
  get groups() {
    return this.#groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, also: [...i.also] })) }));
  }

  set groups(value) {
    this.#groups = normaliseGroups(value);
    if (this.#built) this.#render();
  }

  /** Whether it is collapsed to its icons (on a desktop). Setting it is the
   * person's choice, remembered. */
  get collapsed() {
    return this.hasAttribute("collapsed");
  }

  set collapsed(on) {
    this.#setCollapsed(!!on, true);
  }

  /** The current item ({ id, label, href, group }), or null. */
  get currentItem() {
    const a = this.#links.find((l) => l.getAttribute("aria-current") === "page");
    if (!a) return null;
    const { item, group } = a.__om;
    return { id: item.id, label: item.label, href: item.href, group: group.label };
  }

  /** Whether the drawer is open (narrow only). */
  get drawerOpen() {
    return !!this.#drawer?.open;
  }

  /** Open the drawer (narrow only): the sidebar over the page, focus in it. */
  openDrawer() {
    if (!this.#built || !this.#narrow() || this.#drawer.open) return;
    this.#drawer.querySelector(".om-sidebar-drawer-body").append(this.#nav);
    // Collapsing means nothing in the drawer: gone, and from a screen
    // reader too, whatever a host's own button styles say.
    this.#collapse.hidden = true;
    if (typeof this.#drawer.showModal === "function") this.#drawer.showModal();
    else this.#drawer.setAttribute("open", "");
    this.#open.setAttribute("aria-expanded", "true");
    const target = this.#links.find((l) => l.getAttribute("aria-current") === "page") || this.#links[0];
    target?.focus();
  }

  /** Close the drawer, focus back on Menu. */
  closeDrawer({ focus = true } = {}) {
    if (!this.#built || !this.#drawer.open) return;
    if (typeof this.#drawer.close === "function") this.#drawer.close();
    else this.#drawer.removeAttribute("open");
    this.#settle(focus);
  }

  #build() {
    this.#built = true;
    const declared = declaredJson(this);
    if (declared && !this.#groups.length) this.#groups = normaliseGroups(declared);
    // The server's own links are for a browser without the kit.
    for (const own of this.querySelectorAll(":scope > nav")) own.hidden = true;
    const id = `om-sidebar-${++serial}`;

    // The bar a phone sees: Menu, and where the page is.
    this.#bar = document.createElement("div");
    this.#bar.className = "om-sidebar-bar";
    this.#open = document.createElement("button");
    this.#open.type = "button";
    this.#open.className = "om-sidebar-open";
    this.#open.setAttribute("aria-haspopup", "dialog");
    this.#open.setAttribute("aria-expanded", "false");
    this.#open.setAttribute("aria-controls", `${id}-drawer`);
    this.#open.innerHTML = `${iconSvg("menu")}<span>Menu</span>`;
    this.#open.addEventListener("click", () => this.openDrawer());
    this.#here = document.createElement("span");
    this.#here.className = "om-sidebar-here";
    this.#bar.append(this.#open, this.#here);

    // The sidebar itself: the collapse button, then the groups.
    this.#nav = document.createElement("nav");
    this.#nav.className = "om-sidebar-nav";
    this.#nav.id = `${id}-nav`;
    this.#collapse = document.createElement("button");
    this.#collapse.type = "button";
    this.#collapse.className = "om-sidebar-collapse";
    this.#collapse.setAttribute("aria-controls", `${id}-nav`);
    this.#collapse.addEventListener("click", () => this.#setCollapsed(!this.collapsed, true));
    this.#list = document.createElement("div");
    this.#list.className = "om-sidebar-groups";
    this.#nav.append(this.#collapse, this.#list);

    // The drawer a phone opens: a modal dialog the sidebar moves into.
    this.#drawer = document.createElement("dialog");
    this.#drawer.className = "om-sidebar-drawer";
    this.#drawer.id = `${id}-drawer`;
    const head = document.createElement("div");
    head.className = "om-sidebar-drawer-head";
    const title = document.createElement("span");
    title.className = "om-sidebar-drawer-title";
    title.id = `${id}-title`;
    const shut = document.createElement("button");
    shut.type = "button";
    shut.className = "om-sidebar-close";
    shut.innerHTML = `${iconSvg("close")}<span class="visually-hidden">Close the menu</span>`;
    shut.title = "Close the menu";
    shut.addEventListener("click", () => this.closeDrawer());
    head.append(title, shut);
    const body = document.createElement("div");
    body.className = "om-sidebar-drawer-body";
    this.#drawer.append(head, body);
    this.#drawer.setAttribute("aria-labelledby", title.id);
    // Escape (the dialog's cancel), or closed any other way than closeDrawer
    // (which puts it back itself): put it back, focus on Menu.
    this.#drawer.addEventListener("close", () => {
      if (this.#nav.parentNode !== this) this.#settle(true);
    });
    // A click on the backdrop (the dialog itself, outside its box) shuts it.
    this.#drawer.addEventListener("click", (e) => {
      if (e.target === this.#drawer) this.closeDrawer();
    });
    // A link followed in the drawer: a hash on this page does not reload it.
    this.#nav.addEventListener("click", (e) => {
      if (this.#drawer.open && e.target.closest?.("a[href]")) this.closeDrawer({ focus: false });
    });

    this.append(this.#bar, this.#nav, this.#drawer);
    this.#name();
    this.#render();
    // The person's remembered choice; else the page's `collapsed`; else open.
    const kept = this.#recall();
    this.#setCollapsed(kept === null ? this.collapsed : kept, false);
  }

  #render() {
    this.#list.replaceChildren();
    this.#links = [];
    const id = this.#nav.id;
    this.#groups.forEach((group, gi) => {
      const box = document.createElement("div");
      box.className = "om-sidebar-group";
      box.setAttribute("role", "group");
      if (group.id) box.dataset.group = group.id;
      if (group.label) {
        const label = document.createElement("span");
        label.className = "om-sidebar-group-label";
        label.id = `${id}-g${gi}`;
        label.textContent = group.label;
        box.setAttribute("aria-labelledby", label.id);
        box.append(label);
      }
      const ul = document.createElement("ul");
      for (const item of group.items) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "om-sidebar-link";
        a.href = item.href;
        if (item.id) a.dataset.item = item.id;
        const icon = document.createElement("span");
        icon.className = "om-sidebar-icon";
        icon.setAttribute("aria-hidden", "true");
        if (hasIcon(item.icon)) icon.innerHTML = iconSvg(item.icon);
        else {
          icon.classList.add("om-sidebar-letter");
          // Drawn by CSS from the attribute, so the link's text is its label alone.
          icon.dataset.letter = [...item.label.trim()][0] || "";
        }
        const words = document.createElement("span");
        words.className = "om-sidebar-label";
        words.textContent = item.label;
        a.append(icon, words);
        a.__om = { item, group };
        li.append(a);
        ul.append(li);
        this.#links.push(a);
      }
      box.append(ul);
      this.#list.append(box);
    });
    this.#tips();
    this.#mark();
  }

  #name() {
    const label = this.getAttribute("label") || "Sections";
    this.#nav.setAttribute("aria-label", label);
    this.#drawer.querySelector(".om-sidebar-drawer-title").textContent = label;
  }

  /** Mark the current item, and say it beside Menu. */
  #mark() {
    if (!this.#built) return;
    const named = this.getAttribute("current");
    let at = named ? this.#links.findIndex((a) => a.__om.item.id === named) : -1;
    if (at < 0) at = this.#links.findIndex((a) => a.__om.item.current);
    if (at < 0) {
      let here = null;
      try {
        here = new URL(globalThis.location.href);
      } catch {
        here = null;
      }
      if (here) at = currentIndex(this.#links.map((a) => a.__om.item), here);
    }
    this.#links.forEach((a, i) => {
      if (i === at) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const now = this.#links[at];
    this.#here.textContent = now ? now.__om.item.label : "";
  }

  #narrow() {
    return !!this.#mq?.matches;
  }

  /** Wide or narrow: a drawer left open when the screen widens is shut. */
  #mode() {
    if (!this.#built) return;
    const narrow = this.#narrow();
    this.toggleAttribute("data-narrow", narrow);
    if (!narrow && this.#drawer.open) this.closeDrawer({ focus: false });
  }

  /** The drawer shut: the sidebar back in its place, Menu told, and focused. */
  #settle(focus) {
    if (this.#nav.parentNode !== this) this.insertBefore(this.#nav, this.#drawer);
    this.#collapse.hidden = false;
    this.#open.setAttribute("aria-expanded", "false");
    if (focus && this.#narrow()) this.#open.focus();
  }

  #setCollapsed(on, remember) {
    this.#reflecting = true;
    this.toggleAttribute("collapsed", on);
    this.#reflecting = false;
    this.#showCollapsed();
    if (remember) this.#keep(on);
    if (remember) this.dispatchEvent(new CustomEvent("om-collapse", { bubbles: true, detail: { collapsed: on } }));
  }

  #showCollapsed() {
    const on = this.collapsed;
    const words = on ? "Expand the menu" : "Collapse the menu";
    this.#collapse.innerHTML = `${iconSvg(on ? "expand" : "collapse")}<span class="visually-hidden">${words}</span>`;
    this.#collapse.title = words;
    this.#collapse.setAttribute("aria-expanded", on ? "false" : "true");
    this.#tips();
  }

  /** Collapsed, an icon's words are a pointer's tooltip too. */
  #tips() {
    const on = this.collapsed;
    for (const a of this.#links) {
      if (on) a.title = a.__om.item.label;
      else a.removeAttribute("title");
    }
  }

  #key() {
    return STORE + (this.getAttribute("remember") || "default");
  }

  #recall() {
    try {
      const v = globalThis.localStorage.getItem(this.#key());
      return v === "collapsed" ? true : v === "expanded" ? false : null;
    } catch {
      return null;
    }
  }

  #keep(on) {
    try {
      globalThis.localStorage.setItem(this.#key(), on ? "collapsed" : "expanded");
    } catch {
      /* storage refused: only the remembering is lost */
    }
  }
}

if (!customElements.get("om-sidebar")) customElements.define("om-sidebar", OmSidebar);
