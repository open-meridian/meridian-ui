/* Open Meridian's plugin UI kit __KIT_VERSION__: the theme applier, and the loader
 * for the components.
 *
 * Link it as a classic script in <head>, before first paint, beside the
 * stylesheet:
 *
 *   <link rel="stylesheet" href="/.meridian/ui/__KIT_VERSION__/meridian.css">
 *   <script src="/.meridian/ui/__KIT_VERSION__/meridian.js"></script>
 *
 * The dashboard's frame hands the page the person's colour scheme, mode and
 * market-direction convention (which colour means up):
 *
 * - on first load, as query parameters on the page's URL:
 *     ?om-scheme=<id>&om-mode=<light|dark|system>&om-direction=<green-up|red-up>&om-framed=1
 * - on change, as a message from the parent window (the dashboard's frame):
 *     { "type": "meridian:theme", "version": 3, "scheme": "<id>", "mode": "<light|dark|system>",
 *       "direction": "<green-up|red-up>", "framed": <true|false> }
 *   Version 2 added direction and version 3 framed; an earlier version's
 *   message is still taken, and any field left out keeps its current value.
 *   A kit that knows an earlier version ignores what it does not know.
 *
 * The direction is set as data-om-direction on <html>; each scheme's
 * stylesheet swaps only its direction colours (buy and sell, and their
 * washes) under red-up, so status colours never flip.
 *
 * A message is accepted only when its source is this window's parent, and
 * never when the page is not framed. The scheme's stylesheet is loaded from
 * the kit's own base path (schemes/<id>.css beside this file); the brand
 * default is always underneath it, so an unknown or unloadable scheme falls
 * back to it. The last theme is kept for the tab (sessionStorage), so a
 * navigation inside the frame that drops the query keeps the person's theme.
 *
 * Seamless in the frame. The host says the page is framed, so the frame draws
 * its heading and tab row: by `om-framed=1` on the page's URL on first load,
 * and by `framed: true` (or false) in the theme message (version 3). Only a
 * page that is in a frame takes it; then data-om-framed is set on <html>, and
 * the kit's CSS drops the page's own heading and tab row, its standalone
 * padding and width, and its background.
 *
 * And the frame grows to the page. Once the host's first theme message has
 * taught this page the host's origin (event.origin), the page posts its height
 * to its parent, to that origin alone, and again whenever it changes: rounded
 * up to a whole pixel, at most once a frame, from a ResizeObserver on <html>:
 *     { "type": "meridian:size", "version": 1, "height": <CSS pixels> }
 * Before that message it sends nothing, and it never sends to "*".
 *
 * No plugin code is needed: the page follows the theme by linking this file.
 */
(function (win) {
  "use strict";
  if (!win || !win.document) return;
  var doc = win.document;
  var root = doc.documentElement;
  var MODES = { light: 1, dark: 1, system: 1 };
  var DIRECTIONS = { "green-up": 1, "red-up": 1 };
  var SCHEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var STORE = "om-theme";
  var LINK_ID = "om-scheme";
  var FRAMED = "data-om-framed";
  // An origin a message can be posted to: never "null", never a wildcard.
  var ORIGIN = /^https?:\/\/[^\/\s]+$/;
  // Whether this page is in a frame at all: the host's word counts only then.
  var inFrame = !!(win.parent && win.parent !== win);

  // The kit's base: the directory this script was served from.
  var script = doc.currentScript;
  var base = (script && script.src) ? new URL(".", script.src).href : new URL("./", win.location.href).href;

  var current = { scheme: "default", mode: "system", direction: "green-up" };
  var framed = false;

  function valid(scheme, mode, direction) {
    return {
      scheme: typeof scheme === "string" && SCHEME_ID.test(scheme) ? scheme : null,
      mode: typeof mode === "string" && MODES[mode] ? mode : null,
      direction: typeof direction === "string" && DIRECTIONS[direction] ? direction : null,
    };
  }

  function resolved(mode) {
    if (mode !== "system") return mode;
    var mq = win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)");
    return mq && mq.matches ? "dark" : "light";
  }

  function remember() {
    var kept = { scheme: current.scheme, mode: current.mode, direction: current.direction, framed: framed };
    try { win.sessionStorage.setItem(STORE, JSON.stringify(kept)); } catch (e) { /* storage refused: fine */ }
  }

  function recall() {
    try { return JSON.parse(win.sessionStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }

  function announce() {
    var detail = { scheme: current.scheme, mode: current.mode, resolved: resolved(current.mode), direction: current.direction };
    win.dispatchEvent(new win.CustomEvent("om-theme", { detail: detail }));
  }

  function setScheme(id) {
    var link = doc.getElementById(LINK_ID);
    if (id === "default") {
      if (link) link.remove();
      return;
    }
    var href = new URL("schemes/" + id + ".css", base).href;
    if (link && link.getAttribute("href") === href) return;
    var next = doc.createElement("link");
    next.rel = "stylesheet";
    next.id = LINK_ID;
    next.href = href;
    next.addEventListener("error", function () {
      // Unknown or unreachable: the brand default, which is always underneath.
      if (next.parentNode) next.remove();
      if (current.scheme === id) {
        current.scheme = "default";
        root.setAttribute("data-om-scheme", "default");
        remember();
        announce();
      }
    });
    if (link) link.replaceWith(next);
    else doc.head.appendChild(next);
  }

  /** Apply a scheme, a mode and a direction convention; a part left out or
   * invalid keeps its current value, never guessed. */
  function apply(scheme, mode, direction) {
    var v = valid(scheme, mode, direction);
    if (v.scheme) current.scheme = v.scheme;
    if (v.mode) current.mode = v.mode;
    if (v.direction) current.direction = v.direction;
    root.setAttribute("data-om-mode", current.mode);
    root.setAttribute("data-om-scheme", current.scheme);
    root.setAttribute("data-om-direction", current.direction);
    setScheme(current.scheme);
    remember();
    announce();
    return { scheme: current.scheme, mode: current.mode, direction: current.direction };
  }

  /** Framed or not, as the host says; a page not in a frame never is. */
  function frame(on) {
    framed = on === true && inFrame;
    if (framed) root.setAttribute(FRAMED, "");
    else root.removeAttribute(FRAMED);
  }

  // The frame's size. The host's origin is learned from its first theme
  // message and never changes; until then nothing is sent.
  var host = null;
  var sent = null;
  var pending = false;

  function report() {
    pending = false;
    if (!host) return;
    var height = Math.ceil(root.getBoundingClientRect().height);
    if (height === sent) return;
    try {
      win.parent.postMessage({ type: "meridian:size", version: 1, height: height }, host);
      sent = height;
    } catch (e) { /* the parent went away: nothing to size */ }
  }

  function schedule() {
    if (pending || !host) return;
    pending = true;
    if (win.requestAnimationFrame) win.requestAnimationFrame(report);
    else win.setTimeout(report, 16);
  }

  function onMessage(event) {
    var parent = win.parent;
    // Only the frame this page is in: never itself, never another window.
    if (!parent || parent === win || event.source !== parent) return;
    var d = event.data;
    if (!d || typeof d !== "object" || d.type !== "meridian:theme") return;
    if (typeof d.framed === "boolean") frame(d.framed);
    apply(d.scheme, d.mode, d.direction);
    if (!host && typeof event.origin === "string" && ORIGIN.test(event.origin)) {
      host = event.origin;
      // The first size now, measured after this message's changes.
      report();
    }
  }

  // First load: the query, else what this tab last had, else the default.
  var query = new URLSearchParams(win.location.search);
  var saved = recall() || {};
  var framedQuery = query.get("om-framed");
  frame(framedQuery !== null ? framedQuery === "1" : saved.framed === true);
  apply(
    query.get("om-scheme") || saved.scheme || "default",
    query.get("om-mode") || saved.mode || "system",
    query.get("om-direction") || saved.direction || "green-up"
  );
  win.addEventListener("message", onMessage);
  if (inFrame && win.ResizeObserver) new win.ResizeObserver(schedule).observe(root);

  // A system change matters to anything drawing with the resolved mode.
  if (win.matchMedia) {
    var mq = win.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (current.mode === "system") announce(); });
  }

  win.Meridian = win.Meridian || {};
  win.Meridian.kit = { version: "__KIT_VERSION__", base: base };
  win.Meridian.theme = {
    apply: apply,
    current: function () {
      return { scheme: current.scheme, mode: current.mode, resolved: resolved(current.mode), direction: current.direction };
    },
  };
  win.Meridian.frame = {
    /** Whether the host frames this page seamlessly (data-om-framed). */
    framed: function () { return framed; },
  };

  // The components, as modules beside this file. Custom elements upgrade in
  // place when they arrive, so the page may use them before they load.
  if (!(script && script.hasAttribute("data-no-components"))) {
    var s = doc.createElement("script");
    s.type = "module";
    s.src = new URL("components/index.js", base).href;
    doc.head.appendChild(s);
  }
})(typeof window !== "undefined" ? window : undefined);
