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
 * Header actions. A button (or a form's submit button) in the page head's
 * .actions marked data-om-action="<id>" is one the host may draw in its own
 * header, labelled with the button's text. Framed, the kit's CSS hides it in
 * the page, and the kit posts the set to the learned host origin alone: with
 * the host's first theme message, then whenever the set, a label, a tone or a
 * disabled state changes (a MutationObserver, at most once a frame):
 *     { "type": "meridian:actions", "version": 1,
 *       "actions": [{ "id", "label", "tone"?: "primary"|"danger", "disabled"?: true }] }
 * The host answers a click with { "type": "meridian:action", "version": 1, "id" },
 * taken only from the parent window and the learned origin while framed; the
 * kit then clicks the page's own button, so its form posts with its own
 * token. On its own, a page's buttons stay where they are.
 *
 * Header status. An <om-status> in the page head marked data-om-header is
 * one the host may draw beside the plugin's name (an unmarked one stays in
 * the page). Framed, the kit's CSS hides it in the page, and the kit posts it
 * to the learned host origin alone, with the host's first theme message and
 * then whenever its attributes change (at most once a frame):
 *     { "type": "meridian:status", "version": 1, "state": "ok"|"busy"|"warn"|"error",
 *       "label", "detail"?, "at"?: ISO moment, "at_label"? }
 * and { "type": "meridian:status", "version": 1, "state": null } when there is
 * none (removed, or the page no longer framed).
 *
 * A head left with nothing to show once its heading, its tab row, its header
 * actions and its status are the host's is marked data-om-empty, and the
 * kit's CSS drops it whole, framed only.
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

  // Header actions: buttons in the head's .actions the host draws for the
  // page when it is framed. One the kit cannot offer (an id that is not one,
  // a repeat, past the fourth, no label or a long one) is marked kept, and
  // stays in the page.
  var ACTION = "data-om-action";
  var KEPT = "data-om-kept";
  var ACTION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
  var MAX_ACTIONS = 4;
  var MAX_LABEL = 40;
  var ACTION_SELECTOR = [".page-head", ".pagehead"].map(function (head) {
    return ["button", "input[type=submit]", "input[type=button]"].map(function (el) {
      return head + " .actions " + el + "[" + ACTION + "]";
    }).join(", ");
  }).join(", ");
  var offered = null;
  var offerPending = false;

  /** Disabled, by its own attribute or a disabled fieldset around it. */
  function inert(el) {
    if (el.disabled || el.closest("fieldset[disabled]")) return true;
    try { return el.matches(":disabled"); } catch (e) { return false; }
  }

  /** The header actions the page declares, as the host is told them, and
   * the button behind each id. */
  function declared() {
    var list = [];
    var buttons = Object.create(null);
    var found = doc.querySelectorAll(ACTION_SELECTOR);
    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      var id = el.getAttribute(ACTION);
      var text = el.localName === "input" ? el.value : el.textContent;
      var label = String(text || "").replace(/\s+/g, " ").trim();
      var ok = list.length < MAX_ACTIONS && ACTION_ID.test(id) && !buttons[id] && label !== "" && label.length <= MAX_LABEL;
      if (!ok) {
        if (!el.hasAttribute(KEPT)) el.setAttribute(KEPT, "");
        continue;
      }
      if (el.hasAttribute(KEPT)) el.removeAttribute(KEPT);
      buttons[id] = el;
      var action = { id: id, label: label };
      if (el.classList.contains("danger")) action.tone = "danger";
      else if (el.classList.contains("primary")) action.tone = "primary";
      if (inert(el)) action.disabled = true;
      list.push(action);
    }
    return { list: list, buttons: buttons };
  }

  // The header status: the head's om-status marked data-om-header, the one
  // the host draws beside the plugin's name when the page is framed. Only the
  // first is offered; another, or one the kit cannot offer (a state that is
  // not one of the four, a label or an at-label too long), is marked kept and
  // stays in the page. A detail too long is cut, ending in an ellipsis.
  var HEADER = "data-om-header";
  var STATUS_ATTRIBUTES = ["state", "label", "detail", "at", "at-label", HEADER];
  var STATES = { ok: "Up to date", busy: "Updating", warn: "Needs attention", error: "Failed" };
  var MAX_STATUS_LABEL = 80;
  var MAX_DETAIL = 300;
  var MAX_AT_LABEL = 40;
  // om-moment's reading of a moment: an ISO 8601 date-time with its offset.
  var MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  var STATUS_SELECTOR = ".page-head om-status[" + HEADER + "], .pagehead om-status[" + HEADER + "]";
  var EMPTY = "data-om-empty";
  var told = null;

  function words(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function keep(el, kept) {
    if (kept && !el.hasAttribute(KEPT)) el.setAttribute(KEPT, "");
    else if (!kept && el.hasAttribute(KEPT)) el.removeAttribute(KEPT);
  }

  /** The header status the page declares, as the host is told it, or null. */
  function statusOf() {
    var found = doc.querySelectorAll(STATUS_SELECTOR);
    var status = null;
    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      var state = el.getAttribute("state") || "";
      var ok = status === null && Object.prototype.hasOwnProperty.call(STATES, state);
      var label = ok ? (words(el.getAttribute("label")) || STATES[state]) : "";
      var atLabel = words(el.getAttribute("at-label")) || "Updated";
      ok = ok && label.length <= MAX_STATUS_LABEL && atLabel.length <= MAX_AT_LABEL;
      keep(el, !ok);
      if (!ok) continue;
      status = { state: state, label: label };
      var detail = words(el.getAttribute("detail"));
      if (detail.length > MAX_DETAIL) detail = detail.slice(0, MAX_DETAIL - 1).trim() + "\u2026";
      if (detail) status.detail = detail;
      var at = words(el.getAttribute("at"));
      var moment = MOMENT.test(at) ? new Date(at) : null;
      if (moment && !isNaN(moment.getTime())) {
        status.at = moment.toISOString();
        status.at_label = atLabel;
      }
    }
    return status;
  }

  // What a head holds that the frame draws, or that draws nothing: gone when
  // the page is framed. Anything else it holds with a text or a box of its
  // own (a word, a control, an image, another component) keeps the head.
  var GONE = "h1, .om-page-title, .tabs, [hidden], input[type=hidden], script, style, template, noscript";
  var DRAWN = { img: 1, svg: 1, canvas: 1, video: 1, audio: 1, iframe: 1, object: 1, embed: 1, input: 1,
    button: 1, select: 1, textarea: 1, meter: 1, progress: 1, hr: 1, br: 1, picture: 1, math: 1 };

  function gone(el) {
    if (el.matches(GONE)) return true;
    if (el.hasAttribute(KEPT)) return false;
    if (el.matches(STATUS_SELECTOR) || el.matches(ACTION_SELECTOR)) return true;
    // The one-button form holding an offered action goes with it (the CSS's rule).
    return el.localName === "form" && el.classList.contains("inline") &&
      !!el.closest(".actions") && !!el.querySelector("[" + ACTION + "]:not([" + KEPT + "])");
  }

  /** Whether `node` shows anything once the host draws what it draws. */
  function shows(node) {
    for (var n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
      if (n.nodeType !== 1 || gone(n)) continue;
      if (DRAWN[n.localName] || n.localName.indexOf("-") > 0 || shows(n)) return true;
    }
    return false;
  }

  /** Mark each head left empty in the frame (data-om-empty), so the CSS
   * drops it whole; unframed, none is. */
  function settleHeads() {
    var heads = doc.querySelectorAll(".page-head, .pagehead");
    for (var i = 0; i < heads.length; i++) {
      var empty = framed && !shows(heads[i]);
      if (empty !== heads[i].hasAttribute(EMPTY)) {
        if (empty) heads[i].setAttribute(EMPTY, "");
        else heads[i].removeAttribute(EMPTY);
      }
    }
  }

  /** Tell the host the page's header status, when it differs from what it
   * was last told. Framed only; unframed, a host once told is told none. */
  function tellStatus() {
    if (!framed && told === null) return;
    var status = framed ? statusOf() : null;
    if (!host) return;
    var message = { type: "meridian:status", version: 1, state: null };
    if (status) {
      message.state = status.state;
      message.label = status.label;
      if (status.detail) message.detail = status.detail;
      if (status.at) { message.at = status.at; message.at_label = status.at_label; }
    }
    var said = JSON.stringify(message);
    if (said === told) return;
    try {
      win.parent.postMessage(message, host);
      told = said;
    } catch (e) { /* the parent went away: nobody to draw it */ }
  }

  /** Tell the host the page's header actions, when they differ from what it
   * was last told. Framed only; unframed, a host once told is told none. */
  function tellActions() {
    if (!framed && offered === null) return;
    var list = framed ? declared().list : [];
    if (!host) return;
    var said = JSON.stringify(list);
    if (said === offered) return;
    try {
      win.parent.postMessage({ type: "meridian:actions", version: 1, actions: list }, host);
      offered = said;
    } catch (e) { /* the parent went away: nobody to draw them */ }
  }

  /** What the host draws for the page: its header actions and its status,
   * each told only when it differs; and the heads that leaves empty. */
  function offer() {
    offerPending = false;
    tellActions();
    tellStatus();
    settleHeads();
  }

  function scheduleOffer() {
    if (offerPending || (!framed && offered === null && told === null)) return;
    offerPending = true;
    if (win.requestAnimationFrame) win.requestAnimationFrame(offer);
    else win.setTimeout(offer, 16);
  }

  /** The host's click on one of the page's header actions: the page's own
   * button is clicked, so its own form posts with its own token. */
  function act(event, d) {
    if (!host || event.origin !== host || !framed) return;
    if (d.version !== 1 || typeof d.id !== "string") return;
    var el = declared().buttons[d.id];
    if (!el || inert(el)) return;
    el.click();
  }

  function onMessage(event) {
    var parent = win.parent;
    // Only the frame this page is in: never itself, never another window.
    if (!parent || parent === win || event.source !== parent) return;
    var d = event.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "meridian:action") return act(event, d);
    if (d.type !== "meridian:theme") return;
    var was = framed;
    if (typeof d.framed === "boolean") frame(d.framed);
    apply(d.scheme, d.mode, d.direction);
    if (!host && typeof event.origin === "string" && ORIGIN.test(event.origin)) {
      host = event.origin;
      // What the host draws for the page (its header actions and status,
      // and the heads that leaves empty), then the first size, measured
      // after this message's changes.
      offer();
      report();
    } else if (framed !== was) {
      offer();
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
  // The header actions follow the page: a button added, removed, relabelled
  // or disabled is told again (only what differs is sent).
  if (inFrame && win.MutationObserver) {
    new win.MutationObserver(scheduleOffer).observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: [ACTION, "disabled", "class", "value", "hidden"].concat(STATUS_ATTRIBUTES),
    });
    // The heads are settled as soon as the page is parsed, before its first
    // frame where the browser allows; what the host is told follows.
    doc.addEventListener("DOMContentLoaded", function () {
      if (framed) { declared(); statusOf(); settleHeads(); }
      scheduleOffer();
    });
  }

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
    /** The header actions the page declares (data-om-action), as the host is told them. */
    actions: function () { return declared().list; },
    /** The header status the page declares (om-status data-om-header), as the host is told it, or null. */
    status: function () { return statusOf(); },
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
