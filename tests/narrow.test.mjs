// The kit fits a phone, and a grid's cells say more without hand-built DOM:
// a list row's actions drop below its text; a grid is cards, or drops its
// least wanted columns, where it is narrow; a column's hint, tone, blank and
// strong are plain JSON, and so are a grid's columns and rows; om-moment;
// options, a field and its button, and a select as tall as an input.

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { formatMoment } from "../src/components/om-moment.js";
import { put, read, settle } from "./helpers.mjs";

const cells = (g, key) => [...g.querySelector(`tr[data-key="${key}"]`).cells];

// SnapTrade's sync-state grid, as plain JSON: nothing in it is a function.
const COLUMNS = [
  { key: "account", label: "Account", hint: "where", strong: true },
  { key: "link", label: "Link", type: "badge", tone: { field: "link_tone" } },
  { key: "state", label: "Sync state", type: "badge", tone: { field: "tone" }, hint: "todo", priority: 2 },
  { key: "holdings_as_of", label: "Holdings as of", blank: "not reported", priority: 3 },
  { key: "recorded", label: "Last statement", tone: { field: "recorded_tone" }, hint: "recorded_note", priority: 3 },
  { key: "id", label: "Account ID", type: "code", hint: "id_note", priority: 3 },
];
const ROWS = [
  { id: "st-1", account: "Individual brokerage", where: "Interactive Brokers · Margin", link: "Linked", link_tone: "good", state: "Current", tone: "good", todo: "", holdings_as_of: "2026-09-29 12:04 UTC", recorded: "12 rows", recorded_tone: "", recorded_note: "", id_note: "" },
  { id: "st-2", account: "Roth IRA", where: "Fidelity · IRA", link: "Not linked", link_tone: "warn", state: "Stale", tone: "warn", todo: "Reconnect it.", holdings_as_of: "", recorded: "Stopped at 3 of 9 rows", recorded_tone: "bad", recorded_note: "The sidecar refused a row.", id_note: "No stable ID." },
];

async function declared(attrs = "", data = { columns: COLUMNS, rows: ROWS }) {
  put(`<om-grid row-key="id" ${attrs}><script type="application/json">${JSON.stringify(data)}</script><div class="table-wrap"><table id="fallback"><tr><td>Without the kit</td></tr></table></div></om-grid>`);
  await settle();
  return document.querySelector("om-grid");
}

// ── Rich cells, as plain JSON ────────────────────────────────────────────────

test("a grid's columns and rows are declared as JSON, and the page writes no script", async () => {
  const g = await declared();
  assert.equal(g.querySelector("#fallback"), null, "the table shown without the kit is replaced, not joined");
  assert.equal(g.querySelectorAll("table").length, 1);
  assert.deepEqual([...g.querySelectorAll("thead th")].map((th) => th.textContent), COLUMNS.map((c) => c.label));
  assert.deepEqual([...g.querySelectorAll("tbody tr[data-key]")].map((tr) => tr.dataset.key), ["st-1", "st-2"]);
  assert.equal(g.size, 2);
});

test("a hint under the value, strong text, and a badge's tone from a field of the row", async () => {
  const g = await declared();
  const [account, link, state] = cells(g, "st-2");
  assert.equal(account.querySelector("strong").textContent, "Roth IRA");
  assert.equal(account.querySelector(".hint").textContent, "Fidelity · IRA");
  assert.equal(link.querySelector(".badge").className, "badge warn");
  assert.equal(state.querySelector(".badge").className, "badge warn");
  assert.equal(state.querySelector(".hint").textContent, "Reconnect it.");
  assert.equal(cells(g, "st-1")[2].querySelector(".hint"), null, "an empty hint is not drawn");
  assert.equal(cells(g, "st-1")[1].querySelector(".badge").className, "badge good");
});

test("a blank value says the column's blank text; a tone colours text; code keeps its hint", async () => {
  const g = await declared();
  const [, , , asOf, recorded, id] = cells(g, "st-2");
  assert.equal(asOf.querySelector(".faint").textContent, "not reported");
  assert.equal(cells(g, "st-1")[3].textContent, "2026-09-29 12:04 UTC");
  assert.equal(recorded.firstChild.className, "bad-ink");
  assert.equal(recorded.querySelector(".hint").textContent, "The sidecar refused a row.");
  assert.equal(cells(g, "st-1")[4].firstChild.nodeType, 3, "no tone: plain text");
  assert.ok(id.classList.contains("mono"));
  assert.equal(id.firstChild.textContent, "st-2");
  assert.equal(id.querySelector(".hint").textContent, "No stable ID.");
});

test("a tone from a row's field is one of the kit's, never a class the row makes up", async () => {
  const g = await declared("", {
    columns: [{ key: "s", type: "badge", tone: { field: "t" } }, { key: "v", tone: { field: "t" } }],
    rows: [{ id: "a", s: "Odd", v: "Odd", t: "badge bad onclick" }, { id: "b", s: "Fine", v: "Fine", t: "accent" }],
  });
  assert.equal(cells(g, "a")[0].querySelector("span").className, "badge");
  assert.equal(cells(g, "a")[1].firstChild.nodeType, 3);
  assert.equal(cells(g, "b")[0].querySelector("span").className, "badge accent");
  assert.equal(cells(g, "b")[1].firstChild.nodeType, 3, "accent is a badge's tone, not a text colour");
});

test("a badge column takes a format: text, or a node inside the badge", () => {
  document.body.innerHTML = "<om-grid></om-grid>";
  const g = document.querySelector("om-grid");
  g.columns = [
    { key: "s", type: "badge", tone: () => "good", format: (v) => v.toUpperCase() },
    { key: "d", type: "badge", format: (v) => { const b = document.createElement("b"); b.textContent = v; return b; } },
    { key: "h", type: "badge", hint: "why", format: (v) => `${v}!` },
  ];
  g.setRows([{ id: "a", s: "current", d: "dot", h: "Stale", why: "A day old." }]);
  const [s, d, h] = cells(g, "a");
  assert.equal(s.innerHTML, '<span class="badge good">CURRENT</span>');
  assert.equal(d.innerHTML, '<span class="badge"><b>dot</b></span>');
  assert.equal(h.querySelector(".badge").textContent, "Stale!");
  assert.equal(h.querySelector(".hint").textContent, "A day old.");
});

test("columns and rows set by script win over the declared JSON", async () => {
  document.body.innerHTML = "";
  const g = document.createElement("om-grid");
  g.columns = [{ key: "account", label: "From script" }];
  g.innerHTML = `<script type="application/json">${JSON.stringify({ columns: COLUMNS, rows: ROWS })}</script>`;
  document.body.append(g);
  await settle();
  assert.deepEqual([...g.querySelectorAll("thead th")].map((th) => th.textContent), ["From script"]);
  assert.equal(g.size, 2, "the rows script did not set are the JSON's");
});

test("a grid upgraded before the page is parsed waits for its children: no second table", async () => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  let g;
  try {
    g = document.createElement("om-grid");
    g.setAttribute("row-key", "id");
    document.body.append(g);
    await settle();
    // The parser reaches the grid's children after it was upgraded.
    g.innerHTML = `<script type="application/json">${JSON.stringify({ columns: COLUMNS, rows: ROWS })}</script><div class="table-wrap"><table id="fallback"></table></div>`;
    assert.ok(g.querySelector("#fallback"), "shown until the page is parsed");
  } finally {
    delete document.readyState;
  }
  document.dispatchEvent(new Event("DOMContentLoaded"));
  assert.equal(g.querySelectorAll("table").length, 1);
  assert.equal(g.querySelector("#fallback"), null);
  assert.equal(g.querySelectorAll("tbody tr[data-key]").length, 2);
});

test("a high-rate grid redraws a cell when its hint or tone field changes", () => {
  document.body.innerHTML = '<om-grid high-rate row-key="id" no-flash></om-grid>';
  const g = document.querySelector("om-grid");
  g.columns = [{ key: "state", type: "badge", tone: { field: "tone" }, hint: "todo" }];
  g.setRows([{ id: "a", state: "Stale", tone: "warn", todo: "Reconnect." }]);
  g.upsert({ id: "a", state: "Stale", tone: "bad", todo: "Sign in again." });
  g.flush();
  const [td] = cells(g, "a");
  assert.equal(td.querySelector(".badge").className, "badge bad");
  assert.equal(td.querySelector(".hint").textContent, "Sign in again.");
  assert.deepEqual(g.columns[0].watch, undefined, "the column the page gave is as it gave it");
});

test("each cell carries its column's name and priority, for the narrow layouts", async () => {
  const g = await declared('narrow="priority"');
  const [account, , state, asOf] = cells(g, "st-1");
  assert.equal(account.dataset.label, "Account");
  assert.equal(account.dataset.priority, undefined, "no priority: never hidden");
  assert.equal(state.dataset.priority, "2");
  assert.equal(asOf.dataset.priority, "3");
  assert.equal(g.querySelectorAll("thead th")[3].dataset.priority, "3");
});

// ── Narrow layouts: the CSS ──────────────────────────────────────────────────

const CSS = read("src/css/base.css") + read("src/css/components.css");
const SETTINGS = { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true };

/** The kit's CSS at `width`, its container queries read as media queries (happy-dom has none:
 * the grid is as wide as the window), over `body`, with the grid given its columns and rows. */
async function at(width, narrow) {
  const win = new Window({ url: "https://plugin.example/admin", width, height: 900, settings: SETTINGS });
  const doc = win.document;
  const style = doc.createElement("style");
  style.textContent = CSS.replace(/@container\s+[a-z-]+\s*\(/g, "@media (");
  doc.head.append(style);
  doc.body.innerHTML = `<section class="panel"><om-grid row-key="id" ${narrow ? `narrow="${narrow}"` : ""}></om-grid></section>
    <div class="list-row" id="lr"><div class="grow">Interactive Brokers</div><form class="inline"><button>Reconnect</button></form></div>`;
  // The grid's own drawing, copied in: this window has no custom elements of ours.
  document.body.innerHTML = '<om-grid row-key="id"></om-grid>';
  const g = document.querySelector("om-grid");
  g.columns = COLUMNS;
  g.setRows(ROWS);
  doc.querySelector("om-grid").innerHTML = g.innerHTML;
  return (sel) => win.getComputedStyle(doc.querySelector(sel));
}

test("cards: under 40rem each row is a card, each value under its column's name", async () => {
  const phone = await at(390, "cards");
  assert.equal(phone("table").display, "block");
  assert.equal(phone('tr[data-key="st-1"]').display, "block");
  assert.equal(phone('tr[data-key="st-1"] td:nth-child(3)').display, "grid", "the name beside the value");
  assert.equal(phone('tr[data-key="st-1"] td:first-child').display, "block", "the first column is the card's title");
  assert.equal(phone("thead").position, "absolute", "the head is kept for a screen reader, out of sight");
  const desk = await at(1200, "cards");
  assert.notEqual(desk("table").display, "block");
  assert.notEqual(desk('tr[data-key="st-1"] td:nth-child(3)').display, "grid");
});

test("priority: the least wanted columns hide first as the grid narrows", async () => {
  const widths = { 1200: [], 600: ["3"], 390: ["3", "2"] };
  for (const [width, hidden] of Object.entries(widths)) {
    const s = await at(Number(width), "priority");
    for (const p of ["2", "3"]) {
      const gone = hidden.includes(p);
      assert.equal(s(`td[data-priority="${p}"]`).display === "none", gone, `${width}px, priority ${p}`);
      assert.equal(s(`th[data-priority="${p}"]`).display === "none", gone, `${width}px, priority ${p} head`);
    }
    assert.notEqual(s('tr[data-key="st-1"] td:first-child').display, "none", `${width}px: no priority is never hidden`);
  }
});

test("without narrow, a grid at a phone's width is the table it always was", async () => {
  const phone = await at(390, "");
  assert.notEqual(phone("table").display, "block");
  assert.notEqual(phone('td[data-priority="3"]').display, "none");
  assert.notEqual(phone('td[data-priority="3"]').display, "grid");
  assert.equal(phone(".table-wrap").overflowX, "auto");
});

test("a list row's actions drop below its text where both do not fit", async () => {
  const s = await at(390, "");
  assert.equal(s("#lr").flexWrap, "wrap");
  assert.equal(s("#lr .grow").flexBasis, "16rem", "the text is never squeezed under 16rem");
  assert.equal(s("#lr .grow").flexGrow, "1");
});

// ── Forms ────────────────────────────────────────────────────────────────────

function styled(body) {
  const win = new Window({ url: "https://plugin.example/admin", width: 1200, height: 900, settings: SETTINGS });
  const style = win.document.createElement("style");
  style.textContent = read("generated/schemes/default.css") + CSS;
  win.document.head.append(style);
  win.document.body.innerHTML = body;
  return (sel) => win.getComputedStyle(win.document.querySelector(sel));
}

test("a field and its button: level, the button as tall as the field", () => {
  const s = styled(`<form><div class="field-row"><label class="field"><span>Account</span><select id="sel"><option>Main</option></select></label><button id="b">Link</button></div>
    <label class="field"><span>Name</span><input id="in" type="text"></label></form>`);
  assert.equal(s(".field-row").display, "flex");
  assert.equal(s(".field-row").alignItems, "flex-end");
  assert.equal(s(".field-row .field").marginBottom, "0px");
  // The same box as an input: its padding, border and line height (measured
  // in a browser too; happy-dom does not resolve the inherited line height).
  assert.match(CSS, /\.field-row > :is\(button, \.button\) \{ flex: none; line-height: inherit; padding-top: \.5rem; padding-bottom: \.5rem; \}/);
  assert.match(CSS, /select \{ min-height: calc\(1lh \+ 1rem \+ 2px\); \}/, "a select as tall as a text input");
});

test("options: radio buttons drawn as the dashboard's settings draw them", () => {
  const s = styled(`<fieldset class="choice"><legend>Key</legend><div class="options">
    <label class="option" id="on"><input type="radio" name="k" value="p" checked><span><span class="option-label">Personal</span><span class="hint">One person's.</span></span></label>
    <label class="option" id="off"><input type="radio" name="k" value="c"><span><span class="option-label">Commercial</span><span class="hint">A firm's.</span></span></label>
    </div></fieldset>`);
  assert.equal(s(".options").display, "grid");
  assert.equal(s("#off").display, "flex");
  assert.notEqual(s("#on").borderTopColor, s("#off").borderTopColor, "the chosen option is marked");
  assert.ok(s("#on").borderTopColor, "in the scheme's colour");
  assert.notEqual(s("#on .hint").color, s("#off .hint").color, "its hint reads on the wash");
  assert.equal(s("#on .option-label").fontWeight, "600");
});

// ── om-moment ────────────────────────────────────────────────────────────────

test("om-moment shows a moment to the minute in UTC, a date as it is, and nothing it cannot read", async () => {
  assert.deepEqual(formatMoment("2026-09-29T12:04:31Z"), { datetime: "2026-09-29T12:04:31.000Z", text: "2026-09-29 12:04 UTC" });
  assert.equal(formatMoment("2026-09-29T08:04:00-04:00").text, "2026-09-29 12:04 UTC");
  assert.deepEqual(formatMoment("2026-09-28"), { datetime: "2026-09-28", text: "2026-09-28" });
  for (const bad of ["", "2026-09-29T12:04", "2026-02-30", "yesterday", "2026-09-29T25:00Z"]) assert.equal(formatMoment(bad), null, bad);
  assert.match(formatMoment("2026-09-29T12:04:00Z", "local").text, /^2026-09-29 \d{2}:\d{2}/);

  put('<p><om-moment label="Last read" value="2026-09-29T12:04:00Z">2026-09-29 12:04 UTC</om-moment></p>');
  await settle();
  const m = document.querySelector("om-moment");
  assert.equal(m.textContent, "Last read 2026-09-29 12:04 UTC", "the page's words replaced, not joined");
  const time = m.querySelector("time");
  assert.equal(time.getAttribute("datetime"), "2026-09-29T12:04:00.000Z");
  m.value = "";
  assert.equal(m.textContent, "Last read Not yet");
  m.setAttribute("empty", "not reported");
  assert.equal(m.querySelector(".om-moment-empty").textContent, "not reported");
});

test("every new component is defined", () => {
  for (const name of ["om-account-map", "om-moment"]) assert.ok(customElements.get(name), name);
});
