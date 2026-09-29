/* Open Meridian's plugin UI kit __KIT_VERSION__: the theme applier, and the loader
 * for the components.
 *
 * Link it as a classic script in <head>, before first paint, beside the
 * stylesheet:
 *
 *   <link rel="stylesheet" href="/.meridian/ui/__KIT_VERSION__/meridian.css">
 *   <script src="/.meridian/ui/__KIT_VERSION__/meridian.js"></script>
 *
 * The dashboard's frame hands the page the person's colour scheme and mode:
 *
 * - on first load, as query parameters on the page's URL:
 *     ?om-scheme=<id>&om-mode=<light|dark|system>
 * - on change, as a message from the parent window (the dashboard's frame):
 *     { "type": "meridian:theme", "version": 1, "scheme": "<id>", "mode": "<light|dark|system>" }
 *
 * A message is accepted only when its source is this window's parent, and
 * never when the page is not framed. The scheme's stylesheet is loaded from
 * the kit's own base path (schemes/<id>.css beside this file); the brand
 * default is always underneath it, so an unknown or unloadable scheme falls
 * back to it. The last theme is kept for the tab (sessionStorage), so a
 * navigation inside the frame that drops the query keeps the person's theme.
 *
 * No plugin code is needed: the page follows the theme by linking this file.
 */
(function (win) {
  "use strict";
  if (!win || !win.document) return;
  var doc = win.document;
  var root = doc.documentElement;
  var MODES = { light: 1, dark: 1, system: 1 };
  var SCHEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var STORE = "om-theme";
  var LINK_ID = "om-scheme";

  // The kit's base: the directory this script was served from.
  var script = doc.currentScript;
  var base = (script && script.src) ? new URL(".", script.src).href : new URL("./", win.location.href).href;

  var current = { scheme: "default", mode: "system" };

  function valid(scheme, mode) {
    return {
      scheme: typeof scheme === "string" && SCHEME_ID.test(scheme) ? scheme : null,
      mode: typeof mode === "string" && MODES[mode] ? mode : null,
    };
  }

  function resolved(mode) {
    if (mode !== "system") return mode;
    var mq = win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)");
    return mq && mq.matches ? "dark" : "light";
  }

  function remember() {
    try { win.sessionStorage.setItem(STORE, JSON.stringify(current)); } catch (e) { /* storage refused: fine */ }
  }

  function recall() {
    try { return JSON.parse(win.sessionStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }

  function announce() {
    var detail = { scheme: current.scheme, mode: current.mode, resolved: resolved(current.mode) };
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

  /** Apply a scheme and a mode; an invalid part is ignored, not guessed. */
  function apply(scheme, mode) {
    var v = valid(scheme, mode);
    if (v.scheme) current.scheme = v.scheme;
    if (v.mode) current.mode = v.mode;
    root.setAttribute("data-om-mode", current.mode);
    root.setAttribute("data-om-scheme", current.scheme);
    setScheme(current.scheme);
    remember();
    announce();
    return { scheme: current.scheme, mode: current.mode };
  }

  function onMessage(event) {
    var parent = win.parent;
    // Only the frame this page is in: never itself, never another window.
    if (!parent || parent === win || event.source !== parent) return;
    var d = event.data;
    if (!d || typeof d !== "object" || d.type !== "meridian:theme") return;
    apply(d.scheme, d.mode);
  }

  // First load: the query, else what this tab last had, else the default.
  var query = new URLSearchParams(win.location.search);
  var saved = recall() || {};
  apply(
    query.get("om-scheme") || saved.scheme || "default",
    query.get("om-mode") || saved.mode || "system"
  );
  win.addEventListener("message", onMessage);

  // A system change matters to anything drawing with the resolved mode.
  if (win.matchMedia) {
    var mq = win.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (current.mode === "system") announce(); });
  }

  win.Meridian = win.Meridian || {};
  win.Meridian.kit = { version: "__KIT_VERSION__", base: base };
  win.Meridian.theme = {
    apply: apply,
    current: function () { return { scheme: current.scheme, mode: current.mode, resolved: resolved(current.mode) }; },
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
