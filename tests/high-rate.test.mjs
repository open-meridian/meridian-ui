// om-grid's high-rate mode, in a headless DOM (happy-dom): what is in the
// document, what an update touches, the flash, the order, the keyboard. The
// frame-time budget is held in a real browser by the benchmark (tests/bench/).

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDecimal } from "../src/lib/decimal.js";

const COLUMNS = [
  { key: "id", label: "ID", type: "code" },
  { key: "px", label: "Price", type: "decimal" },
  { key: "name", label: "Name" },
];

function big(n, attrs = "") {
  document.body.innerHTML = `<om-grid high-rate ${attrs}></om-grid>`;
  const g = document.body.firstElementChild;
  g.columns = COLUMNS;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ id: `r${i}`, px: `${100 + i}.25`, name: `n${i}` });
  g.setRows(rows);
  return g;
}

const drawn = (g) => [...g.querySelectorAll("tbody tr[data-key]")];
const keys = (g) => drawn(g).map((tr) => tr.dataset.key);
const viewport = (g) => g.querySelector(".om-grid-viewport");
const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));

test("high-rate: only the rows in view (and a few either side) are in the document", () => {
  const g = big(10000);
  const rows = drawn(g);
  assert.ok(rows.length > 10 && rows.length <= 60, `${rows.length} rows drawn of 10,000`);
  assert.equal(g.size, 10000);
  assert.equal(g.rows.length, 10000);
  const table = g.querySelector("table");
  assert.equal(table.getAttribute("aria-rowcount"), "10001", "every row, and the head, counted for a screen reader");
  assert.equal(g.querySelector("thead tr").getAttribute("aria-rowindex"), "1");
  assert.equal(rows[0].getAttribute("aria-rowindex"), "2");
  assert.equal(rows[0].dataset.key, "r0");
  assert.equal(rows[0].tabIndex, -1, "a row takes focus from the arrow keys, not from Tab");
  assert.equal(viewport(g).tabIndex, 0, "the grid is one tab stop");
  const spacers = g.querySelectorAll("tr.om-grid-spacer");
  assert.equal(spacers.length, 2);
  assert.equal(spacers[0].getAttribute("aria-hidden"), "true");
  assert.equal(spacers[0].firstChild.style.height, "0px");
  assert.equal(spacers[1].firstChild.style.height, `${(10000 - rows.length) * 36}px`, "the rest of the rows' height");
  assert.equal(g.style.getPropertyValue("--om-grid-row-height"), "36px");
});

test("high-rate: scrolling draws the rows then in view, and their place", () => {
  const g = big(10000);
  const vp = viewport(g);
  vp.scrollTop = 36 * 5000;
  vp.dispatchEvent(new Event("scroll"));
  g.flush();
  const rows = drawn(g);
  assert.equal(rows[0].dataset.key, "r4994", "six rows of overscan above");
  assert.equal(rows[0].getAttribute("aria-rowindex"), "4996");
  assert.ok(keys(g).includes("r5000"));
  assert.ok(!keys(g).includes("r0"), "the rows scrolled past have left the document");
  assert.equal(g.querySelector("tr.om-grid-spacer").firstChild.style.height, `${4994 * 36}px`);
});

test("high-rate: row-height and dense set the fixed row height", () => {
  const g = big(100, 'row-height="24"');
  assert.equal(g.style.getPropertyValue("--om-grid-row-height"), "24px");
  const d = big(100, "dense");
  assert.equal(d.style.getPropertyValue("--om-grid-row-height"), "28px");
});

test("high-rate: an update touches only the cells whose value changed, and flashes them by direction", () => {
  const g = big(1000);
  const tr = g.querySelector('tr[data-key="r3"]');
  const [idCell, pxCell, nameCell] = tr.cells;
  const nameText = nameCell.firstChild;
  const seen = new MutationObserver(() => {});
  seen.observe(g.querySelector("tbody"), { subtree: true, childList: true, characterData: true, attributes: true });

  g.upsert({ id: "r3", px: "103.26", name: "n3" });
  g.upsert({ id: "r3", px: "103.27", name: "n3" }); // conflated: the last state wins
  assert.equal(pxCell.textContent, "103.25", "nothing before the frame");
  g.flush();
  const touched = new Set(seen.takeRecords().map((r) => (r.target.nodeType === 3 ? r.target.parentNode : r.target)));
  assert.equal(g.querySelector('tr[data-key="r3"]'), tr, "the same row");
  assert.equal(pxCell.textContent, "103.27");
  assert.equal(pxCell.dataset.flash, "up-1", "a rise flashes up");
  assert.equal(nameCell.firstChild, nameText, "an unchanged cell is not touched");
  assert.ok(!nameCell.dataset.flash && !idCell.dataset.flash);
  assert.deepEqual([...touched].every((n) => n === pxCell || pxCell.contains(n)), true, "only the price cell was written");

  // Beyond a double's precision: a float would call this no change.
  g.upsert({ id: "r3", px: "103.2699999999999999999", name: "n3" });
  g.flush();
  assert.equal(pxCell.dataset.flash, "down-1", "a fall flashes down, exactly");
  g.upsert({ id: "r3", px: "103.2", name: "n3" });
  g.flush();
  assert.equal(pxCell.dataset.flash, "down-2", "a repeat alternates, so the animation restarts");
  g.upsert({ id: "r3", px: "103.2", name: "renamed" });
  g.flush();
  assert.equal(nameCell.textContent, "renamed");
  assert.equal(nameCell.dataset.flash, "same-1", "a change with no direction flashes neutral");
  assert.equal(pxCell.dataset.flash, "down-2", "the price did not change, so did not flash again");
  seen.disconnect();
});

test("high-rate: a watched field redraws a cell whose format reads it", () => {
  document.body.innerHTML = "<om-grid high-rate></om-grid>";
  const g = document.body.firstElementChild;
  g.columns = [
    { key: "id", label: "ID" },
    { key: "qty", label: "Held", format: (v, row) => `${v} ${row.unit}`, watch: ["unit"] },
  ];
  g.setRows([{ id: "a", qty: "5", unit: "shares" }]);
  g.upsert({ id: "a", qty: "5", unit: "lots" });
  g.flush();
  assert.equal(g.querySelector('tr[data-key="a"]').cells[1].textContent, "5 lots");
});

test("high-rate: no flash under reduced motion, or with no-flash", () => {
  const real = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  try {
    const g = big(100);
    g.upsert({ id: "r1", px: "999", name: "n1" });
    g.flush();
    const cell = g.querySelector('tr[data-key="r1"]').cells[1];
    assert.equal(cell.textContent, "999");
    assert.equal(cell.dataset.flash, undefined);
  } finally {
    globalThis.matchMedia = real;
  }
  const g = big(100, "no-flash");
  g.upsert({ id: "r1", px: "999", name: "n1" });
  g.flush();
  assert.equal(g.querySelector('tr[data-key="r1"]').cells[1].dataset.flash, undefined);
});

test("high-rate: an update to a row out of view touches no document", () => {
  const g = big(10000);
  const before = drawn(g);
  g.upsert({ id: "r9000", px: "1", name: "far" });
  g.flush();
  assert.deepEqual(drawn(g), before);
  assert.equal(g.getRow("r9000").name, "far");
  assert.equal(g.querySelector('tr[data-key="r9000"]'), null);
});

test("high-rate: inserts, removals and an empty grid", () => {
  const g = big(50);
  g.upsert({ id: "new", px: "1", name: "new" });
  g.remove(["r0", "r1"]);
  g.flush();
  assert.equal(g.size, 49);
  assert.equal(g.querySelector("table").getAttribute("aria-rowcount"), "50");
  assert.ok(!keys(g).includes("r0"));
  assert.equal(g.rows.at(-1).id, "new", "arrival order: a new row goes last");
  g.setRows([]);
  assert.match(g.querySelector("tr.om-grid-empty").textContent, /Nothing to show/);
});

test("high-rate: sorted by a streaming column, the order is exact and stable", () => {
  document.body.innerHTML = '<om-grid high-rate sort="px:desc"></om-grid>';
  const g = document.body.firstElementChild;
  g.columns = COLUMNS;
  g.setRows([
    { id: "a", px: "9007199254740993.01" },
    { id: "b", px: "9007199254740993.02" },
    { id: "c", px: "5" },
    { id: "d", px: "5" },
    { id: "e", px: "" },
  ]);
  assert.deepEqual(g.rows.map((r) => r.id), ["b", "a", "c", "d", "e"], "exact past a double; ties by arrival; blanks last");
  g.upsert({ id: "a", px: "9007199254740993.03" });
  g.flush();
  assert.deepEqual(g.rows.map((r) => r.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(keys(g), ["a", "b", "c", "d", "e"], "and drawn in that order");
  g.sortBy("px", "ascending");
  assert.deepEqual(g.rows.map((r) => r.id), ["c", "d", "b", "a", "e"], "ties keep arrival order both ways; blanks still last");
});

test("high-rate: the incremental order always equals a full sort", () => {
  document.body.innerHTML = '<om-grid high-rate sort="px:desc"></om-grid>';
  const g = document.body.firstElementChild;
  g.columns = COLUMNS;
  let s = 7;
  const rnd = (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
  const value = () => (rnd(10) === 0 ? "" : `${rnd(3) ? "" : "-"}${rnd(50)}.${String(rnd(100)).padStart(2, "0")}`);
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({ id: `k${i}`, px: value() });
  g.setRows(rows);
  for (let round = 0; round < 40; round++) {
    for (let j = 0; j < 25; j++) {
      const i = rnd(360);
      if (i >= 300 && rnd(2)) g.remove(`k${rnd(300)}`);
      else g.upsert({ id: `k${i}`, px: value() });
    }
    g.flush();
    const want = [...g.rows]
      .map((r) => r.id)
      .sort((x, y) => {
        const a = g.getRow(x).px;
        const b = g.getRow(y).px;
        if (a === "" || b === "") return a === b ? 0 : a === "" ? 1 : -1;
        return -compareDecimal(a, b);
      });
    // Ties go by arrival, which a re-added key renews: compare values only.
    assert.deepEqual(g.rows.map((r) => r.px), want.map((k) => g.getRow(k).px), `round ${round}`);
  }
});

test("high-rate: freeze-sort holds the order while streaming, and lets go when removed", () => {
  const g = big(20, 'sort="px:desc" freeze-sort');
  assert.equal(g.freezeSort, true);
  assert.equal(g.rows[0].id, "r19");
  g.upsert({ id: "r0", px: "100000", name: "n0" });
  g.upsert({ id: "new", px: "999999", name: "new" });
  g.flush();
  assert.equal(g.rows[0].id, "r19", "a changed row does not jump");
  assert.equal(g.rows.at(-2).id, "r0");
  assert.equal(g.rows.at(-1).id, "new", "a new row goes last while frozen");
  assert.equal(g.querySelector('tr[data-key="r0"]').cells[1].textContent, "100000", "but its cells change");
  g.freezeSort = false;
  assert.deepEqual(g.rows.slice(0, 2).map((r) => r.id), ["new", "r0"], "unfrozen, the sort applies");
  // A header click is the person asking, so it sorts even while frozen.
  g.freezeSort = true;
  g.upsert({ id: "r5", px: "0", name: "n5" });
  g.flush();
  g.querySelectorAll("th")[1].querySelector("button").click();
  assert.equal(g.rows[0].id, "r5", "ascending, now");
});

test("high-rate: the arrow keys move from row to row, bringing each into view", () => {
  const g = big(10000);
  const vp = viewport(g);
  let chosen = null;
  g.addEventListener("om-row", (e) => (chosen = e.detail.key));
  vp.focus();
  key(vp, "ArrowDown");
  assert.equal(document.activeElement?.dataset.key, "r0", "the first row in view");
  key(document.activeElement, "ArrowDown");
  assert.equal(document.activeElement?.dataset.key, "r1");
  key(document.activeElement, "End");
  const last = document.activeElement;
  assert.equal(last?.dataset.key, "r9999", "the last row, drawn to be focused");
  assert.equal(last.getAttribute("aria-rowindex"), "10001");
  key(last, "Enter");
  assert.equal(chosen, "r9999");
  key(document.activeElement, "Home");
  assert.equal(document.activeElement?.dataset.key, "r0");
  key(document.activeElement, "PageDown");
  assert.ok(Number(document.activeElement.dataset.key.slice(1)) > 10, "a page down");
  assert.equal(g.scrollToRow("r7000", { focus: true }), true);
  assert.equal(document.activeElement?.dataset.key, "r7000");
  assert.equal(g.scrollToRow("nope"), false);
});

test("high-rate: the existing API is unchanged, and the mode can be switched", () => {
  const g = big(30, 'sort="px:asc"');
  const events = [];
  g.addEventListener("om-sort", (e) => events.push(e.detail));
  g.querySelectorAll("th")[1].querySelector("button").click();
  assert.deepEqual(events, [{ key: "px", direction: "descending" }]);
  assert.equal(g.rows[0].id, "r29");
  g.highRate = false;
  assert.equal(g.querySelector(".om-grid-viewport"), null);
  assert.equal(drawn(g).length, 30, "every row, as before");
  assert.equal(drawn(g)[0].dataset.key, "r29");
  g.highRate = true;
  assert.ok(g.querySelector(".om-grid-viewport"));
});
