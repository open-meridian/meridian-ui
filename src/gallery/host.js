// The gallery's stand-in for the dashboard's side of a seamless frame: all a
// host does, and nothing more (the README's "The frame: seamless").
//
// - It frames the plugin's page with the person's theme and om-framed=1 on
//   its address, so the first paint is already framed.
// - On every load of the frame, and whenever the theme changes, it sends the
//   theme message with framed: true, to the plugin's origin alone. That
//   message is what teaches the page where to send its size.
// - It takes meridian:size only from that frame's window and the plugin's
//   origin, and sets the frame's height from it: no inner scrollbar, and the
//   frame grows and shrinks with the page.
// - It takes meridian:actions under the same guards, and a valid shape: at
//   most four actions, each an id, a short label drawn as text (never HTML),
//   a tone it knows and a disabled flag. It draws them as buttons in its own
//   header, and a click posts meridian:action to the plugin's origin alone;
//   the page presses its own button, which posts its own form. A new load of
//   the frame is a new page, so its buttons go until it offers its own.
//
// Here the plugin's page is beside this one, so its origin is this one's; on
// the dashboard it is the plugin's own host.

// The page it frames, a sample beside it named by ?page= (only these), and its tab.
const PAGES = { "sample.html": "Positions", "accounts.html": "Account links", "accounts-many.html": "Account links" };
const asked = new URLSearchParams(location.search).get("page");
const chosen = Object.hasOwn(PAGES, asked) ? asked : "sample.html";
const PAGE = new URL(chosen, import.meta.url);
document.querySelector(".tabs .tab.on").textContent = PAGES[chosen];
const ORIGIN = PAGE.origin;
// However tall a page says it is, the frame stops here.
const TALLEST = 20000;

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
  tell();
});
// This page follows its own frame's theme (the gallery's); the plugin's page follows this one.
window.addEventListener("om-theme", tell);

// The page's header actions, drawn in this header.
const ACTIONS = document.getElementById("actions");
const offeredLine = document.getElementById("offered");
const ACTION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TONES = new Set(["primary", "danger"]);

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
    button.disabled = a.disabled === true;
    button.addEventListener("click", () => {
      if (!frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: "meridian:action", version: 1, id: a.id }, ORIGIN);
      offeredLine.textContent = `Sent { type: "meridian:action", version: 1, id: "${a.id}" } to ${ORIGIN}.`;
    });
    return button;
  }));
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
  if (d.type !== "meridian:size") return;
  if (!Number.isInteger(d.height) || d.height < 0) return;
  const height = Math.min(d.height, TALLEST);
  frame.style.height = `${height}px`;
  said.textContent = `Received { type: "meridian:size", version: 1, height: ${d.height} } from ${event.origin}; the frame is ${height}px tall.`;
});
