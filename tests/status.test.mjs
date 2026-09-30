// <om-status>: a dot for ok, busy, warn and error, never colour alone; its note on
// hover, focus or a press, announced as the dot's description; its words set
// as text; and without the kit's script, the page's own words beside the dot.

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { STATES } from "../src/components/om-status.js";
import { put, read, settle } from "./helpers.mjs";

async function status(attrs, inside = "") {
  put(`<p>SnapTrade <om-status ${attrs}>${inside}</om-status></p>`);
  await settle();
  return document.querySelector("om-status");
}

const described = (el) =>
  (el.querySelector(".om-status-dot").getAttribute("aria-describedby") || "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id).textContent);

test("ok: a dot named by its label, the note saying when it last read", async () => {
  const el = await status(
    'state="ok" label="Up to date" at="2026-09-30T13:12:00Z" at-label="Last read"',
    "Up to date. Last read 2026-09-30 13:12 UTC",
  );
  assert.equal(el.state, "ok");
  const dot = el.querySelector("button.om-status-dot");
  assert.equal(dot.type, "button", "a button: reached by the keyboard, pressed by a tap");
  assert.equal(dot.querySelector(".visually-hidden").textContent, "Up to date");
  assert.equal(dot.textContent, "Up to date", "its name is the label, with no mark read out");
  const note = el.querySelector(".om-status-note");
  assert.equal(note.getAttribute("role"), "tooltip");
  assert.equal(note.querySelector(".om-status-label").textContent, "Up to date");
  const time = note.querySelector(".om-status-at time");
  assert.equal(time.getAttribute("datetime"), "2026-09-30T13:12:00.000Z");
  assert.equal(note.querySelector(".om-status-at").textContent, "Last read 2026-09-30 13:12 UTC", "om-moment's format");
  assert.ok(note.querySelector(".om-status-detail").hidden, "no detail, none drawn");
  assert.deepEqual(described(el), ["Last read 2026-09-30 13:12 UTC"]);
  assert.equal(el.textContent.includes("Up to date. Last read"), false, "the page's words replaced, not joined");
});

test("busy and error: their own labels, the error's message as the detail", async () => {
  const busy = await status('state="busy" label="Reading SnapTrade" at="2026-09-30T09:12:00-04:00" at-label="Last read"');
  assert.equal(busy.querySelector(".visually-hidden").textContent, "Reading SnapTrade");
  assert.equal(busy.querySelector(".om-status-at").textContent, "Last read 2026-09-30 13:12 UTC");

  const error = await status('state="error" label="The last read failed" detail="SnapTrade answered 503."');
  assert.equal(error.querySelector(".visually-hidden").textContent, "The last read failed");
  assert.equal(error.querySelector(".om-status-detail").textContent, "SnapTrade answered 503.");
  assert.ok(error.querySelector(".om-status-at").hidden, "no moment, none drawn");
  assert.deepEqual(described(error), ["SnapTrade answered 503."]);
});

test("without a label, each state names itself; an unknown state is no state", async () => {
  for (const [state, name] of Object.entries(STATES)) {
    const el = await status(`state="${state}"`);
    assert.equal(el.querySelector(".visually-hidden").textContent, name, state);
    assert.equal(el.querySelector(".om-status-dot").getAttribute("aria-describedby"), null, `${state}: nothing to describe`);
  }
  const odd = await status('state="green"');
  assert.equal(odd.state, "");
  assert.equal(odd.querySelector(".visually-hidden").textContent, "Unknown");
  const unread = await status('state="ok" at="yesterday"');
  assert.ok(unread.querySelector(".om-status-at").hidden, "a moment it cannot read is not guessed");
});

test("its words are text, never markup", async () => {
  const el = await status(
    'state="error" label="&lt;b&gt;Failed&lt;/b&gt;" detail="&lt;img src=x onerror=alert(1)&gt; &amp; more"',
  );
  assert.equal(el.querySelector("img"), null);
  assert.equal(el.querySelector(".om-status-label b"), null);
  assert.equal(el.querySelector(".om-status-label").textContent, "<b>Failed</b>");
  assert.equal(el.querySelector(".om-status-detail").textContent, "<img src=x onerror=alert(1)> & more");
});

test("a change of state redraws it in place", async () => {
  const el = await status('state="busy" label="Reading SnapTrade"');
  const dot = el.querySelector(".om-status-dot");
  el.state = "ok";
  el.setAttribute("label", "Up to date");
  el.setAttribute("at", "2026-09-30T13:12:00Z");
  assert.equal(el.getAttribute("state"), "ok");
  assert.equal(el.querySelector(".om-status-dot"), dot, "the same dot, so focus stays on it");
  assert.equal(el.querySelector(".visually-hidden").textContent, "Up to date");
  assert.equal(el.querySelector(".om-status-at").textContent, "Updated 2026-09-30 13:12 UTC", "the default at-label");
  el.setAttribute("detail", "Three accounts read.");
  assert.deepEqual(described(el), ["Three accounts read.", "Updated 2026-09-30 13:12 UTC"]);
});

test("pressed, the note stays open; pressed again or Escape, it hides until focus leaves", async () => {
  const el = await status('state="ok" at="2026-09-30T13:12:00Z"');
  const dot = el.querySelector(".om-status-dot");
  dot.click();
  assert.ok(el.hasAttribute("open"));
  dot.click();
  assert.ok(!el.hasAttribute("open") && el.hasAttribute("dismissed"));
  dot.click();
  assert.ok(el.hasAttribute("open") && !el.hasAttribute("dismissed"));
  dot.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!el.hasAttribute("open") && el.hasAttribute("dismissed"));
  dot.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  assert.ok(!el.hasAttribute("dismissed"), "shown again on the next hover or focus");
});

// ── The CSS ──────────────────────────────────────────────────────────────────

const CSS = read("src/css/base.css") + read("src/css/components.css");
const SETTINGS = { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true };

test("each state's dot is a status colour and its own mark; busy turns, except under reduced motion", () => {
  const rule = (state) => {
    const m = CSS.match(new RegExp(`om-status\\[state="${state}"\\] \\.om-status-dot::before \\{([^}]*)\\}`));
    assert.ok(m, state);
    return m[1];
  };
  assert.match(rule("ok"), /background: var\(--good\); content: "\\2713"; content: "\\2713" \/ "";/, "a check, not read aloud");
  assert.match(rule("error"), /background: var\(--danger\); content: "!"; content: "!" \/ "";/);
  assert.match(rule("busy"), /border: 2px solid var\(--warn-ink\); border-top-color: transparent;/, "a ring, not a disc");
  assert.match(rule("warn"), /background: var\(--warn-ink\); content: "!"; content: "!" \/ "";/);
  assert.match(rule("warn"), /clip-path: polygon\(50% 0, 100% 100%, 0 100%\);/, "a triangle, not busy's ring or error's disc");
  assert.match(rule("busy"), /animation: om-status-turn/);
  assert.match(
    CSS,
    /@media \(prefers-reduced-motion: reduce\) \{\s*om-status\[state="busy"\]:not\(:defined\)::before,\s*om-status\[state="busy"\] \.om-status-dot::before \{ animation: none; \}/,
  );
  assert.match(CSS, /om-status \.om-status-dot::before \{[^}]*color: var\(--card\);/, "each mark in the card's colour on the status colour");
  // The same dot without the kit's script, before the page's words.
  for (const state of ["ok", "busy", "warn", "error"]) assert.match(CSS, new RegExp(`om-status\\[state="${state}"\\]:not\\(:defined\\)::before,`));
});

test("the note is hidden until hover, focus or a press, and fits a phone", () => {
  const win = new Window({ url: "https://plugin.example/admin", width: 390, height: 800, settings: SETTINGS });
  const style = win.document.createElement("style");
  style.textContent = read("generated/schemes/default.css") + CSS;
  win.document.head.append(style);
  win.document.body.innerHTML = `<p><om-status id="shut" state="ok"><button class="om-status-dot"></button><span class="om-status-note">Up to date</span></om-status>
    <om-status id="open" state="ok" open><button class="om-status-dot"></button><span class="om-status-note">Up to date</span></om-status>
    <om-status id="hushed" state="ok" open dismissed><button class="om-status-dot"></button><span class="om-status-note">Up to date</span></om-status></p>`;
  const s = (sel) => win.getComputedStyle(win.document.querySelector(sel));
  assert.equal(s("#shut .om-status-note").display, "none");
  assert.equal(s("#open .om-status-note").display, "block");
  assert.equal(s("#hushed .om-status-note").display, "none");
  assert.equal(s("#open .om-status-note").position, "absolute", "over the page, not pushing it");
  assert.match(CSS, /max-width: min\(22rem, calc\(100vw - 2rem\)\)/, "never wider than a phone");
  assert.match(CSS, /om-status:is\(:hover, :focus-within, \[open\]\):not\(\[dismissed\]\) \.om-status-note \{ display: block; \}/);
});

test("every new component is defined", () => {
  assert.ok(customElements.get("om-status"));
});
