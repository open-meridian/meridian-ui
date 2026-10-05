// The gallery's stand-in for the dashboard's side of a seamless frame: all a
// host does, and nothing more (the README's "The frame: seamless").
//
// - It frames the plugin's page with the person's theme and om-framed=1 on
//   its address, so the first paint is already framed.
// - On every load of the frame, and whenever the theme changes, it sends the
//   theme message with framed: true, to the plugin's origin alone. That
//   message is what teaches the page where to send its size.
// - The frame takes the viewport's height under this page's chrome, as the
//   dashboard's does (meridian-core, from kit 0.10.0's one-screen rule): the
//   page's height budget, which the kit gives the page as --om-page-height.
//   It takes meridian:size only from that frame's window and the plugin's
//   origin, and says what it heard, but no longer grows the frame to it: a
//   page taller than its budget scrolls in the frame, never this page.
// - It takes meridian:actions under the same guards, and a valid shape: at
//   most four actions, each an id, a short label drawn as text (never HTML),
//   a tone it knows, a disabled flag and an icon's name. It draws them as
//   buttons in its own header, immediately left of the level switch, which
//   stays the rightmost (actions grow leftward): an icon it knows as that
//   icon, the label the button's name and tooltip, any other as its label. A click
//   posts meridian:action to the plugin's origin alone;
//   the page presses its own button, which posts its own form. A new load of
//   the frame is a new page, so its buttons go until it offers its own.
// - It takes meridian:status under the same guards, and a valid shape: a
//   state it knows, a short label, a detail, a moment and its label, each set
//   as text. It draws the dot right after the plugin's name with the kit's own
//   om-status, so its look and its note are the page's; state null, or a new
//   load of the frame, takes it away.
//
// Here the plugin's page is beside this one, so its origin is this one's; on
// the dashboard it is the plugin's own host.

import "../components/om-status.js";

// The page it frames, a sample beside it named by ?page= (only these), and its tab.
const PAGES = { "sample.html": "Positions", "accounts.html": "Account links", "accounts-many.html": "Account links", "patterns.html": "Statements" };
const asked = new URLSearchParams(location.search).get("page");
const chosen = Object.hasOwn(PAGES, asked) ? asked : "sample.html";
const PAGE = new URL(chosen, import.meta.url);
document.querySelector(".tabs .tab.on").textContent = PAGES[chosen];
const ORIGIN = PAGE.origin;

const theme = () => window.Meridian.theme.current();
const said = document.getElementById("said");

const first = theme();
const src = new URL(PAGE);
src.search = new URLSearchParams({ "om-scheme": first.scheme, "om-mode": first.mode, "om-direction": first.direction, "om-framed": "1" }).toString();
const frame = document.createElement("iframe");
frame.id = "plugin";
frame.title = "Sample plugin page, framed seamlessly";
frame.src = src.href;
document.getElementById("slot").replaceWith(frame);

function tell() {
  if (!frame.contentWindow) return;
  const { scheme, mode, direction } = theme();
  frame.contentWindow.postMessage({ type: "meridian:theme", version: 3, scheme, mode, direction, framed: true }, ORIGIN);
}
frame.addEventListener("load", () => {
  draw([]);
  show(null);
  tell();
});
// This page follows its own frame's theme (the gallery's); the plugin's page follows this one.
window.addEventListener("om-theme", tell);

// The page's header actions, drawn in this header.
const ACTIONS = document.getElementById("actions");
const offeredLine = document.getElementById("offered");
const ACTION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TONES = new Set(["primary", "danger"]);
// The icons this host draws: the kit's, by its CSS for data-om-icon.
const ICONS = new Set(["refresh"]);

/** The actions a meridian:actions message carries, or null when it is not
 * exactly the shape the kit sends: then nothing it says is drawn. */
function validActions(list) {
  if (!Array.isArray(list) || list.length > 4) return null;
  const ids = new Set();
  for (const a of list) {
    if (!a || typeof a !== "object" || Array.isArray(a)) return null;
    if (typeof a.id !== "string" || !ACTION_ID.test(a.id) || ids.has(a.id)) return null;
    if (typeof a.label !== "string" || a.label.trim() === "" || a.label.length > 40) return null;
    if (a.tone !== undefined && !TONES.has(a.tone)) return null;
    if (a.disabled !== undefined && typeof a.disabled !== "boolean") return null;
    if (a.icon !== undefined && (typeof a.icon !== "string" || !ACTION_ID.test(a.icon))) return null;
    ids.add(a.id);
  }
  return list;
}

function draw(list) {
  ACTIONS.replaceChildren(...list.map((a) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = a.label;
    if (a.tone) button.className = a.tone;
    // An icon this host knows: drawn by the kit's CSS, the label its name
    // and its tooltip. Another stays its label.
    if (ICONS.has(a.icon)) {
      button.setAttribute("data-om-icon", a.icon);
      button.setAttribute("aria-label", a.label);
      button.title = a.label;
    }
    button.disabled = a.disabled === true;
    button.addEventListener("click", () => {
      if (!frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: "meridian:action", version: 1, id: a.id }, ORIGIN);
      offeredLine.textContent = `Sent { type: "meridian:action", version: 1, id: "${a.id}" } to ${ORIGIN}.`;
    });
    return button;
  }));
}

// The page's status, drawn right after the plugin's name.
const DOT = document.getElementById("dot");
const toldLine = document.getElementById("told");
const STATES = new Set(["ok", "busy", "warn", "error"]);
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const text = (v, least, most) => typeof v === "string" && v.trim().length >= least && v.length <= most;

/** The status a meridian:status message carries, null for none, or
 * undefined when it is not exactly the shape the kit sends: then nothing it
 * says is drawn. */
function validStatus(d) {
  if (d.state === null) return null;
  if (!STATES.has(d.state) || !text(d.label, 1, 80)) return undefined;
  if (d.detail !== undefined && !text(d.detail, 0, 300)) return undefined;
  if (d.at !== undefined && !(text(d.at, 1, 40) && MOMENT.test(d.at) && !Number.isNaN(Date.parse(d.at)))) return undefined;
  if (d.at_label !== undefined && !text(d.at_label, 1, 40)) return undefined;
  return { state: d.state, label: d.label, detail: d.detail, at: d.at, at_label: d.at_label };
}

function show(status) {
  const drawn = DOT.querySelector("om-status");
  if (!status) {
    if (drawn) drawn.remove();
    return;
  }
  const dot = drawn || document.createElement("om-status");
  // Attributes only: om-status sets every word as text, never as markup.
  const set = (name, value) => (value ? dot.setAttribute(name, value) : dot.removeAttribute(name));
  set("state", status.state);
  set("label", status.label);
  set("detail", status.detail);
  set("at", status.at);
  set("at-label", status.at && status.at_label);
  if (!drawn) DOT.append(dot);
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== ORIGIN) return;
  const d = event.data;
  if (!d || typeof d !== "object" || d.version !== 1) return;
  if (d.type === "meridian:actions") {
    const list = validActions(d.actions);
    if (!list) return;
    draw(list);
    offeredLine.textContent = `Received meridian:actions from ${event.origin}: ${list.map((a) => a.label).join(", ") || "none"}.`;
    return;
  }
  if (d.type === "meridian:status") {
    const status = validStatus(d);
    if (status === undefined) return;
    show(status);
    toldLine.textContent = status
      ? `Received meridian:status from ${event.origin}: ${status.state}, ${status.label}.`
      : `Received meridian:status from ${event.origin}: none.`;
    return;
  }
  if (d.type !== "meridian:size") return;
  if (!Number.isInteger(d.height) || d.height < 0) return;
  const budget = Math.round(frame.getBoundingClientRect().height);
  said.textContent = `Received { type: "meridian:size", version: 1, height: ${d.height} } from ${event.origin}; the frame stays ${budget}px, the page's budget${d.height > budget ? ": the page does not fit it" : ""}.`;
});
