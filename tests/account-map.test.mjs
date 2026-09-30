// om-account-map: a plugin's external accounts in a dense table, each linked
// (naming the account) or not; searched, filtered, grouped and paged so
// thousands stay quick; one row's choices opened at a time, an open account
// found by typing; suggestions where a name or a number matches exactly one
// open account, taken one by one or reviewed and sent in one form; every
// action a plain form, with om-link for a page that has script.

import "./dom.mjs";
import "../src/components/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { put, read, settle } from "./helpers.mjs";

// What SnapTrade's Account links page passes: its accounts, the deployment's
// read for the admin, and its links from the account-scope stream.
const DATA = {
  external_accounts: [
    { external_account_id: "st-1", name: "Individual brokerage", detail: "Interactive Brokers · Margin", custodian: "Interactive Brokers", account_type: "Margin", connection: "IBKR", connection_id: "c-1" },
    { external_account_id: "st-2", name: "Roth IRA", detail: "Fidelity · IRA", custodian: "Fidelity", account_type: "IRA", note: "SnapTrade gives no stable ID for this account.", connection: "Fidelity", connection_id: "c-2" },
    { external_account_id: "st-3", name: "", detail: "", custodian: "", account_type: "", connection: "Fidelity", connection_id: "c-2" },
  ],
  accounts: [
    { account_id: "ACC-1", name: "Main", custodian: "Interactive Brokers", account_type: "Margin", open: true },
    { account_id: "ACC-2", name: "Retirement", custodian: "", account_type: "", open: true },
    { account_id: "ACC-9", name: "Old", open: false },
  ],
  links: [{ external_account_id: "st-1", account_id: "ACC-1", account_name: "Main" }],
};

const json = (data) => `<script type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
const ATTRS = 'action="/admin/accounts/link" token-name="csrf" token="t0ken"';

async function map(data = DATA, attrs = ATTRS) {
  put(`<om-account-map ${attrs}>${json(data)}<p id="fallback">Without the kit.</p></om-account-map>`);
  await settle();
  return document.querySelector("om-account-map");
}

const rows = (m) => [...m.querySelectorAll("tr.om-account-map-row")];
const ids = (m) => rows(m).map((r) => r.dataset.external);
const row = (m, id) => m.querySelector(`tr.om-account-map-row[data-external="${id}"]`);
const fields = (form) => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));
const show = (m, filter) => m.querySelector(`.om-account-map-filters [data-filter="${filter}"]`).click();
const counts = (m) => Object.fromEntries([...m.querySelectorAll(".om-account-map-filters button")].map((b) => [b.dataset.filter, b.querySelector(".count").textContent]));
const pressed = (m) => m.querySelector('.om-account-map-filters [aria-pressed="true"]').dataset.filter;
const editor = (m) => m.querySelector("tr.om-account-map-editor");
const edit = (m, id) => row(m, id).querySelector("[data-edit]").click();
function search(m, q) {
  const box = m.querySelector(".om-account-map-search");
  box.value = q;
  box.dispatchEvent(new Event("input", { bubbles: true }));
}
function submit(form) {
  const e = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(e);
  return e.defaultPrevented;
}

/** `n` external accounts and as many deployment accounts, every third linked. */
function many(n, extra = {}) {
  const external_accounts = [];
  const accounts = [];
  const links = [];
  for (let i = 0; i < n; i++) {
    const id = String(i).padStart(4, "0");
    external_accounts.push({ external_account_id: `x-${id}`, name: `Brokerage ${id}`, custodian: i % 2 ? "Fidelity" : "Schwab", account_type: "Cash", connection: `Conn ${i % 4}`, connection_id: `c-${i % 4}` });
    accounts.push({ account_id: `A-${id}`, name: `Book ${id}`, custodian: "", account_type: "", open: true });
    if (i % 3 === 0) links.push({ external_account_id: `x-${id}`, account_id: `A-${id}`, account_name: `Book ${id}` });
  }
  return { external_accounts, accounts, links, ...extra };
}

// ── The table ────────────────────────────────────────────────────────────────

test("a dense table: each external account with its link, linked naming the account or not linked", async () => {
  const m = await map();
  assert.equal(m.querySelector("#fallback"), null, "what the page showed without the kit is replaced");
  assert.equal(m.querySelector('script[type="application/json"]'), null);
  assert.deepEqual([...m.querySelectorAll("thead th")].map((th) => th.textContent), ["External account", "Deployment account", "Actions"]);
  assert.equal(pressed(m), "unlinked", "Unlinked first, because there are some: that is the work");
  assert.deepEqual(ids(m), ["st-2", "st-3"]);
  assert.deepEqual(counts(m), { unlinked: "2", linked: "1", all: "3" });
  show(m, "all");
  assert.deepEqual(ids(m), ["st-1", "st-2", "st-3"]);
  const linked = row(m, "st-1");
  assert.equal(linked.querySelector(".badge").textContent, "Linked");
  assert.ok(linked.querySelector(".badge").classList.contains("good"));
  assert.match(linked.querySelector(".om-account-map-link").textContent, /Linked Main/);
  assert.match(linked.querySelector(".om-account-map-link .meta").textContent, /^Interactive Brokers · Margin · ACC-1$/);
  for (const id of ["st-2", "st-3"]) {
    const b = row(m, id).querySelector(".om-account-map-link .badge");
    assert.equal(b.textContent, "Not linked");
    assert.ok(b.classList.contains("warn"));
  }
  assert.doesNotMatch(m.textContent, /not known/i, "there is no third state");
  assert.equal(row(m, "st-3").querySelector(".title").textContent, "st-3", "an account without a name is named by its ID");
  assert.equal(row(m, "st-2").querySelector(".hint").textContent, "SnapTrade gives no stable ID for this account.");
  assert.equal(m.linkOf("st-1").account_name, "Main");
  assert.equal(m.linkOf("st-2"), null);
  assert.equal(m.querySelectorAll("select[name], form select").length, 0, "no picker of every account on any row");
  assert.equal(m.querySelectorAll("tr.om-account-map-row form").length, 0, "no forms on the rows until one is edited (none is suggested here)");
});

test("with nothing unlinked it shows every account; with none at all it says so", async () => {
  const done = await map({ ...DATA, links: DATA.external_accounts.map((x, i) => ({ external_account_id: x.external_account_id, account_id: `ACC-${i}` })) });
  assert.equal(pressed(done), "all");
  assert.equal(rows(done).length, 3);
  show(done, "unlinked");
  assert.equal(done.querySelector("tr.om-account-map-none").textContent, "Every account is linked.");

  const empty = await map({ external_accounts: [], accounts: [], links: [] }, 'empty="They appear once SnapTrade is read."');
  assert.equal(empty.textContent, "They appear once SnapTrade is read.");
});

// ── Search, filters, groups and pages ────────────────────────────────────────

test("the search finds external and deployment accounts by name, ID, number, custodian and type, once a frame", async () => {
  const data = structuredClone(DATA);
  data.external_accounts[1].number = "U-7781";
  const m = await map(data);
  show(m, "all");
  const before = row(m, "st-2");
  search(m, "fid");
  search(m, "fideli");
  assert.equal(rows(m).length, 3, "typing is applied on the next frame, not per keystroke");
  m.flush();
  assert.deepEqual(ids(m), ["st-2", "st-3"], "by custodian, or by connection");
  assert.equal(row(m, "st-2"), before, "a row is kept and moved, not drawn again");
  const cases = [
    ["main", ["st-1"], "the linked account's name"],
    ["ACC-1", ["st-1"], "the linked account's ID"],
    ["st-3", ["st-3"], "the external account's ID"],
    ["u-7781", ["st-2"], "its number"],
    ["margin", ["st-1"], "its type"],
    ["roth ira", ["st-2"], "every word"],
    ["  ROTH   ira ", ["st-2"], "case and spacing aside"],
    ["roth main", [], "every word, not any"],
  ];
  for (const [q, want, why] of cases) {
    search(m, q);
    m.flush();
    assert.deepEqual(ids(m), want, `${q}: ${why}`);
  }
  assert.equal(m.querySelector("tr.om-account-map-none").textContent, "No account matches “roth main”.");
  assert.match(m.querySelector(".om-account-map-said").textContent, /^0 accounts matching “roth main”$/);
  const box = m.querySelector(".om-account-map-search");
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(box.value, "");
  assert.equal(rows(m).length, 3, "Escape clears it");
});

test("the filters count what the search finds, and say what they show", async () => {
  const m = await map(many(30));
  assert.deepEqual(counts(m), { unlinked: "20", linked: "10", all: "30" });
  search(m, "schwab");
  m.flush();
  assert.deepEqual(counts(m), { unlinked: "10", linked: "5", all: "15" });
  assert.equal(m.querySelector(".om-account-map-said").textContent, "10 unlinked accounts matching “schwab”");
  show(m, "linked");
  assert.equal(pressed(m), "linked");
  assert.ok(rows(m).every((r) => r.querySelector(".badge").textContent === "Linked"));
  assert.equal(rows(m).length, 5);
});

test("groups by connection or custodian, each with its count, folded and unfolded", async () => {
  const m = await map(many(12), `${ATTRS} group-by="connection"`);
  const group = m.querySelector(".om-account-map-grouping select");
  assert.deepEqual([...group.options].map((o) => o.value), ["", "connection", "custodian"]);
  assert.equal(group.value, "connection", "group-by chooses the grouping to start");
  show(m, "all");
  const heads = () => [...m.querySelectorAll("tr.om-account-map-group button")];
  assert.deepEqual(heads().map((b) => [b.querySelector(".om-account-map-name").textContent, b.querySelector(".count").textContent]), [
    ["Conn 0", "3"], ["Conn 1", "3"], ["Conn 2", "3"], ["Conn 3", "3"],
  ]);
  assert.match(heads()[0].textContent, /2 not linked/, "under All, a group says how many are not linked");
  assert.equal(heads()[0].closest("th").getAttribute("scope"), "rowgroup");
  heads()[1].click();
  assert.equal(heads()[1].getAttribute("aria-expanded"), "false");
  assert.equal(rows(m).length, 9, "a folded group's rows go");
  heads()[1].click();
  assert.equal(rows(m).length, 12);

  group.value = "custodian";
  group.dispatchEvent(new Event("change"));
  assert.deepEqual(heads().map((b) => b.querySelector(".om-account-map-name").textContent), ["Schwab", "Fidelity"]);

  // Without anything to group by, no grouping is offered.
  const plain = await map({ ...DATA, external_accounts: DATA.external_accounts.map(({ connection, connection_id, custodian, ...x }) => x) });
  assert.equal(plain.querySelector(".om-account-map-grouping"), null);
});

test("pages keep a page of rows in the document, however many there are", async () => {
  const m = await map(many(2000), `${ATTRS} page-size="50"`);
  show(m, "all");
  assert.equal(rows(m).length, 50);
  assert.equal(m.querySelector(".om-account-map-said").textContent, "2,000 accounts; showing 1–50");
  const [top] = m.querySelectorAll(".om-account-map-pager");
  assert.equal(top.querySelector(".om-account-map-page").textContent, "Page 1 of 40");
  assert.ok(top.querySelector("button").disabled, "no Previous on the first page");
  top.querySelectorAll("button")[1].click();
  assert.equal(ids(m)[0], "x-0050");
  assert.equal(m.querySelector(".om-account-map-said").textContent, "2,000 accounts; showing 51–100");
  const bottom = m.querySelectorAll(".om-account-map-pager")[1];
  bottom.querySelector("button").click();
  assert.equal(ids(m)[0], "x-0000");
  // A search starts again at the first page; a page opening inside a group opens with its head.
  top.querySelectorAll("button")[1].click();
  search(m, "brokerage");
  m.flush();
  assert.equal(ids(m)[0], "x-0000");
  const grouped = await map(many(120), `${ATTRS} page-size="50" group-by="custodian"`);
  show(grouped, "all");
  grouped.querySelectorAll(".om-account-map-pager")[0].querySelectorAll("button")[1].click();
  const first = grouped.querySelector("tbody tr");
  assert.ok(first.classList.contains("om-account-map-group"));
  assert.match(first.textContent, /Schwab.*continued/);
  // One page: no pager.
  const small = await map();
  assert.ok([...small.querySelectorAll(".om-account-map-pager")].every((p) => p.hidden));
});

// ── One row's choices ────────────────────────────────────────────────────────

test("a row's choices open under it alone: an open account found by typing, a new one, or Unlink", async () => {
  const m = await map();
  edit(m, "st-2");
  const ed = editor(m);
  assert.equal(ed.previousElementSibling, row(m, "st-2"), "under the row being edited");
  assert.ok(row(m, "st-2").classList.contains("selected"));
  assert.equal(row(m, "st-2").querySelector("[data-edit]").getAttribute("aria-expanded"), "true");
  const [pick, create] = ed.querySelectorAll("form");
  for (const f of [pick, create]) {
    assert.equal(f.getAttribute("method"), "post");
    assert.equal(f.getAttribute("action"), "/admin/accounts/link");
  }
  assert.deepEqual(fields(pick), { csrf: "t0ken", intent: "link", external_account_id: "st-2", account_id: "" });
  const box = pick.querySelector("[role=combobox]");
  assert.equal(document.activeElement, box, "the keyboard goes to the chooser");
  assert.equal(document.querySelector(`label[for="${box.id}"]`)?.contains(box), true, "the chooser is labelled");
  assert.deepEqual(fields(create), {
    csrf: "t0ken",
    intent: "create",
    external_account_id: "st-2",
    new_account_name: "Roth IRA",
    new_account_custodian: "Fidelity",
    new_account_type: "IRA",
  }, "the new account is named from the external one, its custodian and type prefilled");
  assert.ok(create.querySelector('[name="new_account_name"]').required);
  for (const input of create.querySelectorAll("input:not([type=hidden])")) {
    assert.equal(document.querySelector(`label[for="${input.id}"]`)?.contains(input), true, `${input.name} is labelled`);
  }
  // Another row's choices replace these: one open at a time.
  edit(m, "st-3");
  assert.equal(m.querySelectorAll("tr.om-account-map-editor").length, 1);
  assert.equal(editor(m).previousElementSibling, row(m, "st-3"));
  assert.equal(fields(editor(m).querySelectorAll("form")[1]).new_account_name, "st-3");
  edit(m, "st-3");
  assert.equal(editor(m), null, "pressed again, they close");

  show(m, "all");
  edit(m, "st-1");
  const unlink = [...editor(m).querySelectorAll("form")].find((f) => fields(f).intent === "unlink");
  assert.deepEqual(fields(unlink), { csrf: "t0ken", intent: "unlink", external_account_id: "st-1" });
  assert.ok(unlink.querySelector("button").classList.contains("danger"));
  assert.match(editor(m).textContent, /Linked to Main\./);
  const everyId = [...m.querySelectorAll("[id]")].map((e) => e.id);
  assert.equal(new Set(everyId).size, everyId.length, "every id is unique");
  editor(m).querySelector(".om-account-map-edit").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(editor(m), null, "Escape closes them");
  assert.equal(document.activeElement, row(m, "st-1").querySelector("[data-edit]"), "and the keyboard goes back to the row");
});

test("the chooser lists the open accounts that match what is typed, never a closed one or the current one", async () => {
  const data = many(200);
  data.accounts.push({ account_id: "A-CLOSED", name: "Book closed", open: false });
  const m = await map(data);
  show(m, "all");
  edit(m, "x-0000"); // linked to A-0000
  const box = editor(m).querySelector("[role=combobox]");
  const list = editor(m).querySelector("[role=listbox]");
  assert.ok(list.hidden);
  box.dispatchEvent(new Event("click"));
  const options = () => [...list.querySelectorAll("[role=option]")].map((li) => li.querySelector("code").textContent);
  assert.equal(options().length, 50, "a page of them at once");
  assert.equal(list.querySelector(".om-account-map-more").textContent, "Showing 50 of 199: type to narrow.");
  assert.ok(!options().includes("A-0000"), "not the account it is linked to");
  box.value = "a-015";
  box.dispatchEvent(new Event("input"));
  await settle();
  assert.deepEqual(options(), Array.from({ length: 10 }, (_, i) => `A-015${i}`));
  box.value = "closed";
  box.dispatchEvent(new Event("input"));
  await settle();
  assert.deepEqual(options(), [], "a closed account is never offered");
  assert.equal(list.querySelector(".om-account-map-more").textContent, "No open account matches.");

  // Chosen by the keyboard: the form carries its ID.
  box.value = "A-0150";
  box.dispatchEvent(new Event("input"));
  await settle();
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const form = box.closest("form");
  assert.equal(fields(form).account_id, "A-0150");
  assert.equal(box.value, "Book 0150");
  assert.ok(list.hidden);
  box.value = "Book 015";
  box.dispatchEvent(new Event("input"));
  assert.equal(fields(form).account_id, "", "typed over, the choice goes");
});

test("a link without a chosen account is not sent, and says so", async () => {
  const m = await map();
  const seen = [];
  m.addEventListener("om-link", (e) => seen.push(e.detail));
  edit(m, "st-2");
  const form = editor(m).querySelector("form");
  assert.equal(submit(form), true, "stopped");
  assert.equal(seen.length, 0);
  assert.equal(form.querySelector("[role=combobox]").getAttribute("aria-invalid"), "true");
  assert.equal(form.querySelector(".om-account-map-chosen").textContent, "Choose an account from the list.");
  // Clicked from the list: sent, as the plain form it is.
  const box = form.querySelector("[role=combobox]");
  box.dispatchEvent(new Event("click"));
  [...form.querySelectorAll("[role=option]")].find((li) => li.querySelector("code").textContent === "ACC-2").dispatchEvent(new Event("click", { bubbles: true }));
  assert.equal(fields(form).account_id, "ACC-2");
  assert.equal(submit(form), false);
  assert.deepEqual({ ...seen[0], form: undefined }, { intent: "link", external_account_id: "st-2", account_id: "ACC-2", new_account_name: "", new_account_custodian: "", new_account_type: "", form: undefined });
});

test("the deployment's accounts unread, or none open: said, and a new account still offered", async () => {
  const unread = await map({ ...DATA, accounts: null });
  edit(unread, "st-2");
  assert.equal(editor(unread).querySelector("[role=combobox]"), null);
  assert.match(editor(unread).textContent, /could not be read/);
  assert.equal(editor(unread).querySelectorAll("form").length, 1);
  show(unread, "all");
  assert.match(row(unread, "st-1").querySelector(".om-account-map-link").textContent, /Linked Main/, "the link's own name");

  const none = await map({ ...DATA, accounts: [{ account_id: "ACC-9", name: "Old", open: false }] });
  edit(none, "st-2");
  assert.match(editor(none).textContent, /no open accounts yet: create one/);
  assert.equal(editor(none).querySelector('[name="new_account_name"]').value, "Roth IRA");
});

test("with no token field named, no token is sent; with no action, the form posts to the page", async () => {
  const m = await map(DATA, "");
  edit(m, "st-2");
  const f = editor(m).querySelector("form");
  assert.equal(f.hasAttribute("action"), false);
  assert.deepEqual(Object.keys(fields(f)), ["intent", "external_account_id", "account_id"]);
});

// ── Suggestions ──────────────────────────────────────────────────────────────

const SUGGESTING = {
  external_accounts: [
    { external_account_id: "e-name", name: "Roth IRA" },
    { external_account_id: "e-number", name: "Individual", number: "U123" },
    { external_account_id: "e-by-name", name: "Joint", number: "5550199" },
    { external_account_id: "e-two", name: "Trust" },
    { external_account_id: "e-twin-1", name: "Cash" },
    { external_account_id: "e-twin-2", name: "  CASH " },
    { external_account_id: "e-taken", name: "Main" },
    { external_account_id: "e-closed", name: "Old" },
    { external_account_id: "e-both", name: "Family", number: "F-9" },
    { external_account_id: "e-linked", name: "Roth IRA" },
  ],
  accounts: [
    { account_id: "A-roth", name: "roth  ira", custodian: "Fidelity", account_type: "IRA" },
    { account_id: "A-u123", name: "Brokerage", number: "u123" },
    { account_id: "A-joint", name: "5550199" },
    { account_id: "A-trust-1", name: "Trust" },
    { account_id: "A-trust-2", name: "Trust" },
    { account_id: "A-cash", name: "Cash" },
    { account_id: "A-main", name: "Main" },
    { account_id: "A-old", name: "Old", open: false },
    { account_id: "A-family", name: "Family" },
    { account_id: "A-f9", name: "Other", number: "F-9" },
    { account_id: "A-held", name: "Held" },
  ],
  links: [
    { external_account_id: "e-linked", account_id: "A-held", account_name: "Held" },
    { external_account_id: "x-elsewhere", account_id: "A-main", account_name: "Main" },
  ],
};

test("a suggestion where a name or a number matches exactly one open account nothing else claims", async () => {
  const m = await map(SUGGESTING);
  assert.deepEqual(m.suggestions, [
    { external_account_id: "e-name", account_id: "A-roth", why: "same name" },
    { external_account_id: "e-number", account_id: "A-u123", why: "same number" },
    { external_account_id: "e-by-name", account_id: "A-joint", why: "named by its number" },
  ]);
  for (const [id, why] of [
    ["e-two", "two open accounts have its name"],
    ["e-twin-1", "two unlinked accounts would claim the one account"],
    ["e-taken", "the account is linked to another already"],
    ["e-closed", "a closed account is never suggested"],
    ["e-both", "its name and its number name different accounts"],
    ["e-linked", "a linked account needs none"],
  ]) {
    assert.equal(m.suggestionOf(id), null, `${id}: ${why}`);
  }
  const r = row(m, "e-name");
  assert.match(r.querySelector(".om-account-map-suggestion").textContent, /^Suggested: roth  ira \(Fidelity, IRA\)same name · A-roth$/);
  const take = r.querySelector("form");
  assert.deepEqual(fields(take), { csrf: "t0ken", intent: "link", external_account_id: "e-name", account_id: "A-roth" });
  assert.equal(take.querySelector("button").getAttribute("aria-label"), "Link Roth IRA to roth  ira");
  assert.equal(r.querySelector("[data-edit]").textContent, "Other…");
  // Opened, the suggestion is chosen to start.
  edit(m, "e-name");
  assert.equal(fields(editor(m).querySelector("form")).account_id, "A-roth");
  const none = await map({ ...SUGGESTING, accounts: null });
  assert.deepEqual(none.suggestions, [], "none where the deployment's accounts are unread");
});

test("several suggestions are reviewed, then sent as one form of pairs, where the page's handler takes it", async () => {
  const without = await map(SUGGESTING);
  assert.ok(without.querySelector(".om-account-map-several").hidden, "not offered unless the page says its handler takes several");

  const m = await map(SUGGESTING, `${ATTRS} link-several`);
  const several = m.querySelector(".om-account-map-several");
  assert.ok(!several.hidden);
  assert.equal(several.textContent, "Link 3 suggested…");
  search(m, "roth");
  m.flush();
  assert.equal(several.textContent, "Link 1 suggested…", "those the search finds");
  search(m, "");
  m.flush();
  several.click();
  assert.equal(several.getAttribute("aria-expanded"), "true");
  const form = m.querySelector(".om-account-map-review form");
  assert.equal(form.getAttribute("method"), "post");
  assert.equal(form.getAttribute("action"), "/admin/accounts/link");
  assert.deepEqual([...new FormData(form)].map(([k, v]) => `${k}=${v}`), [
    "csrf=t0ken", "intent=link-several",
    "external_account_id=e-name", "account_id=A-roth",
    "external_account_id=e-number", "account_id=A-u123",
    "external_account_id=e-by-name", "account_id=A-joint",
  ], "one pair per link, in order");
  assert.deepEqual([...form.querySelectorAll("li")].map((li) => li.querySelector("label").textContent.split("same")[0].split("named")[0]), [
    "Roth IRA to roth  ira (Fidelity, IRA)",
    "Individual to Brokerage",
    "Joint to 5550199",
  ], "the review says what will be linked to what");
  const submitButton = form.querySelector("button[type=submit]");
  assert.equal(submitButton.textContent, "Link 3 accounts");
  const second = form.querySelectorAll("input[type=checkbox]")[1];
  second.checked = false;
  second.dispatchEvent(new Event("change"));
  assert.equal(submitButton.textContent, "Link 2 accounts");
  assert.deepEqual(new FormData(form).getAll("external_account_id"), ["e-name", "e-by-name"], "a cleared pair is not sent");
  assert.deepEqual(new FormData(form).getAll("account_id"), ["A-roth", "A-joint"]);

  const seen = [];
  m.addEventListener("om-link", (e) => seen.push(e.detail));
  assert.equal(submit(form), false, "not cancelled: the browser posts it");
  assert.equal(seen[0].intent, "link-several");
  assert.equal(seen[0].external_account_id, "");
  assert.deepEqual(seen[0].pairs, [
    { external_account_id: "e-name", account_id: "A-roth" },
    { external_account_id: "e-by-name", account_id: "A-joint" },
  ]);
  form.querySelector("button[type=button]").click();
  assert.ok(m.querySelector(".om-account-map-review").hidden, "Cancel folds the review");
});

// ── Sending and data ─────────────────────────────────────────────────────────

test("om-link is heard before the form is sent, and a page may send the link itself", async () => {
  const m = await map();
  const seen = [];
  m.addEventListener("om-link", (e) => seen.push(e.detail));
  edit(m, "st-2");
  const create = editor(m).querySelectorAll("form")[1];
  create.querySelector('[name="new_account_name"]').value = "Retirement (Fidelity)";
  assert.equal(submit(create), false, "not cancelled: the browser posts the form");
  assert.equal(seen[0].intent, "create");
  assert.equal(seen[0].external_account_id, "st-2");
  assert.equal(seen[0].new_account_name, "Retirement (Fidelity)");
  assert.equal(seen[0].new_account_custodian, "Fidelity");
  assert.equal(seen[0].account_id, "");
  assert.equal(seen[0].form, create);
  assert.equal("csrf" in seen[0], false, "the token is the form's, not the event's");
  assert.equal("pairs" in seen[0], false);

  m.addEventListener("om-link", (e) => e.preventDefault());
  assert.equal(submit(create), true, "cancelled: the page sends it");
});

test("data set by script is drawn, and held to its shape", async () => {
  document.body.innerHTML = "<om-account-map></om-account-map>";
  await settle();
  const m = document.querySelector("om-account-map");
  m.data = {
    external_accounts: [{ external_account_id: "x", name: "<b>not markup</b>" }, { external_account_id: "x", name: "twice" }, { name: "no ID" }, null],
    accounts: [{ account_id: "A", name: "A" }, { name: "no ID" }],
    links: [{ external_account_id: "x", account_id: "" }],
  };
  assert.equal(rows(m).length, 1, "an account without an ID is left out, and one ID is one account");
  assert.equal(m.querySelector(".title").textContent, "<b>not markup</b>");
  assert.equal(m.querySelector("tbody b"), null, "text, never markup");
  assert.equal(m.querySelector(".om-account-map-link .badge").textContent, "Not linked", "a link naming no account is none");
  assert.deepEqual(m.data.accounts, [{ account_id: "A", name: "A", custodian: "", account_type: "", open: true, number: "" }]);
});

test("script's data wins over the declared JSON; JSON that does not parse is reported", async () => {
  document.body.innerHTML = "";
  const m = document.createElement("om-account-map");
  m.data = { external_accounts: [{ external_account_id: "from-script" }] };
  m.innerHTML = json(DATA);
  document.body.append(m);
  await settle();
  assert.deepEqual(ids(m), ["from-script"]);

  let error = null;
  document.body.addEventListener("om-error", (e) => (error = e.detail.error), { once: true });
  put('<om-account-map><script type="application/json">{ nope</script></om-account-map>');
  await settle();
  assert.match(error, /does not parse/);
  assert.match(document.querySelector("om-account-map").textContent, /No external accounts yet/);
});

test("upgraded before the page is parsed, it waits for its JSON", async () => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  try {
    const m = document.createElement("om-account-map");
    document.body.append(m);
    await settle();
    assert.equal(m.children.length, 0, "nothing drawn while the page is parsed");
    m.innerHTML = json(DATA);
  } finally {
    delete document.readyState;
  }
  document.dispatchEvent(new Event("DOMContentLoaded"));
  const m = document.querySelector("om-account-map");
  assert.equal(rows(m).length, 2, "the two unlinked");
});

test("new data keeps what the person asked to see: the search, the filter, the grouping", async () => {
  const m = await map(many(30), `${ATTRS} group-by="custodian"`);
  show(m, "linked");
  search(m, "schwab");
  m.flush();
  const data = m.data;
  data.links.push({ external_account_id: "x-0002", account_id: "A-0002", account_name: "Book 0002" });
  m.data = data;
  assert.equal(m.querySelector(".om-account-map-search").value, "schwab");
  assert.equal(pressed(m), "linked");
  assert.equal(m.querySelector(".om-account-map-grouping select").value, "custodian");
  assert.deepEqual(counts(m), { unlinked: "9", linked: "6", all: "15" }, "counted afresh");
});

test("a changed token or action is carried by every form drawn after it", async () => {
  const m = await map(SUGGESTING);
  m.setAttribute("token", "fresh");
  assert.equal(fields(row(m, "e-name").querySelector("form")).csrf, "fresh");
});

// ── One column on a phone ────────────────────────────────────────────────────

const CSS = read("src/css/base.css") + read("src/css/components.css");
const SETTINGS = { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true };

/** The kit's CSS at `width`, its container queries read as the map's width
 * (happy-dom has no container queries: the map is as wide as the window). */
function at(width, body) {
  const win = new Window({ url: "https://plugin.example/admin", width, height: 900, settings: SETTINGS });
  const style = win.document.createElement("style");
  style.textContent = CSS.replace(/@container\s+[a-z-]+\s*\(/g, "@media (");
  win.document.head.append(style);
  win.document.body.innerHTML = body;
  return (sel) => win.getComputedStyle(win.document.querySelector(sel));
}

test("the map is a table where it is wide, and each row stacks where it is narrow", () => {
  const body = '<om-account-map><table class="om-account-map-table"><thead><tr><th>E</th></tr></thead><tbody><tr class="om-account-map-row"><td class="a">a</td><td>b</td></tr></tbody></table></om-account-map>';
  const wide = at(1200, body);
  assert.equal(wide(".om-account-map-row").display, "table-row");
  assert.notEqual(wide("thead").position, "absolute");
  const phone = at(390, body);
  assert.equal(phone(".om-account-map-row").display, "block");
  assert.equal(phone("td.a").display, "block");
  assert.equal(phone("thead").position, "absolute", "the head is for a screen reader only");
  assert.match(CSS, /om-account-map \{ display: block; container: om-account-map \/ inline-size; \}/, "by the map's own width");
});
