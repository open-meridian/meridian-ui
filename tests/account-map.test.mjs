// om-account-map: a plugin's external accounts beside the deployment's, each
// linked (naming the account) or not, linked, created or unlinked by plain
// forms the page needs no script for, with om-link for a page that has some.

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
    { external_account_id: "st-1", name: "Individual brokerage", detail: "Interactive Brokers · Margin", custodian: "Interactive Brokers", account_type: "Margin" },
    { external_account_id: "st-2", name: "Roth IRA", detail: "Fidelity · IRA", custodian: "Fidelity", account_type: "IRA", note: "SnapTrade gives no stable ID for this account." },
    { external_account_id: "st-3", name: "", detail: "", custodian: "", account_type: "" },
  ],
  accounts: [
    { account_id: "ACC-1", name: "Main", custodian: "Interactive Brokers", account_type: "Margin", open: true },
    { account_id: "ACC-2", name: "Retirement", custodian: "", account_type: "", open: true },
    { account_id: "ACC-9", name: "Old", open: false },
  ],
  links: [{ external_account_id: "st-1", account_id: "ACC-1", account_name: "Main" }],
};

const json = (data) => `<script type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

async function map(data = DATA, attrs = 'action="/admin/accounts/link" token-name="csrf" token="t0ken"') {
  put(`<om-account-map ${attrs}>${json(data)}<p id="fallback">Without the kit.</p></om-account-map>`);
  await settle();
  return document.querySelector("om-account-map");
}

const row = (m, id) => m.querySelector(`.om-account-map-row[data-external="${id}"]`);
const fields = (form) => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));

test("each external account is shown with its link state: linked, naming the account, or not linked", async () => {
  const m = await map();
  assert.equal(m.querySelector("#fallback"), null, "what the page showed without the kit is replaced");
  assert.equal(m.querySelector('script[type="application/json"]'), null);
  assert.equal(m.querySelectorAll(".om-account-map-row").length, 3);
  const linked = row(m, "st-1");
  assert.equal(linked.querySelector(".badge").textContent, "Linked");
  assert.ok(linked.querySelector(".badge").classList.contains("good"));
  assert.match(linked.querySelector(".om-account-map-linked").textContent, /Linked to Main/);
  assert.match(linked.querySelector(".om-account-map-linked").textContent, /Interactive Brokers · Margin · ACC-1/);
  for (const id of ["st-2", "st-3"]) {
    const b = row(m, id).querySelector(".badge");
    assert.equal(b.textContent, "Not linked");
    assert.ok(b.classList.contains("warn"));
  }
  assert.doesNotMatch(m.textContent, /not known/i, "there is no third state");
  assert.equal(row(m, "st-3").querySelector(".title").textContent, "st-3", "an account without a name is named by its ID");
  assert.equal(row(m, "st-2").querySelector(".hint").textContent, "SnapTrade gives no stable ID for this account.");
  assert.equal(row(m, "st-2").getAttribute("role"), "group");
  assert.equal(document.getElementById(row(m, "st-2").getAttribute("aria-labelledby")).textContent, "Roth IRA");
  assert.equal(m.linkOf("st-1").account_name, "Main");
  assert.equal(m.linkOf("st-2"), null);
});

test("an unlinked account is linked by plain forms: an open account, or a new one named from it", async () => {
  const m = await map();
  const forms = row(m, "st-2").querySelectorAll("form");
  assert.equal(forms.length, 2);
  const [pick, create] = forms;
  for (const f of forms) {
    assert.equal(f.getAttribute("method"), "post");
    assert.equal(f.getAttribute("action"), "/admin/accounts/link");
  }
  const select = pick.querySelector("select");
  assert.equal(select.name, "account_id");
  assert.ok(select.required);
  assert.deepEqual([...select.options].map((o) => [o.value, o.textContent]), [
    ["", "Choose an account"],
    ["ACC-1", "Main (Interactive Brokers, Margin)"],
    ["ACC-2", "Retirement"],
  ], "only open accounts, told apart by custodian and type");
  assert.equal(pick.querySelector('label[for]').textContent.startsWith("An existing account"), true);
  select.value = "ACC-2";
  assert.deepEqual(fields(pick), { csrf: "t0ken", intent: "link", external_account_id: "st-2", account_id: "ACC-2" });

  assert.deepEqual(fields(create), {
    csrf: "t0ken",
    intent: "create",
    external_account_id: "st-2",
    new_account_name: "Roth IRA",
    new_account_custodian: "Fidelity",
    new_account_type: "IRA",
  }, "the new account is named from the external one, its custodian and type prefilled");
  assert.ok(create.querySelector('[name="new_account_name"]').required);
  assert.ok(!create.querySelector('[name="new_account_custodian"]').required);
  assert.equal(create.querySelector("button").className, "primary");
  for (const input of create.querySelectorAll("input:not([type=hidden])")) {
    assert.equal(document.querySelector(`label[for="${input.id}"]`)?.contains(input), true, `${input.name} is labelled`);
  }
  assert.equal(fields(row(m, "st-3").querySelectorAll("form")[1]).new_account_name, "st-3");
});

test("a linked account is unlinked, or linked to another, by plain forms", async () => {
  const m = await map();
  const r = row(m, "st-1");
  const unlink = r.querySelector(".om-account-map-linked form");
  assert.deepEqual(fields(unlink), { csrf: "t0ken", intent: "unlink", external_account_id: "st-1" });
  assert.equal(unlink.querySelector("button").textContent, "Unlink");
  assert.ok(unlink.querySelector("button").classList.contains("danger"));
  const change = r.querySelector("details.om-account-map-change");
  assert.ok(change && !change.open, "linking elsewhere is folded away");
  const again = change.querySelectorAll("form");
  assert.equal(again.length, 2);
  assert.deepEqual([...again[0].querySelectorAll("option")].map((o) => o.value), ["", "ACC-2"], "not the account it is linked to");
  const ids = [...m.querySelectorAll("[id]")].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "every id is unique");
});

test("with no token field named, no token is sent; with no action, the form posts to the page", async () => {
  const m = await map(DATA, "");
  const f = row(m, "st-2").querySelector("form");
  assert.equal(f.hasAttribute("action"), false);
  assert.deepEqual(Object.keys(fields(f)), ["intent", "external_account_id", "account_id"]);
});

test("the deployment's accounts unread, or none open: said, and a new account still offered", async () => {
  const unread = await map({ ...DATA, accounts: null });
  let r = row(unread, "st-2");
  assert.equal(r.querySelector("select"), null);
  assert.match(r.textContent, /could not be read/);
  assert.equal(r.querySelectorAll("form").length, 1);
  assert.match(row(unread, "st-1").querySelector(".om-account-map-linked").textContent, /Linked to Main/, "the link's own name");

  const none = await map({ ...DATA, accounts: [{ account_id: "ACC-9", name: "Old", open: false }] });
  r = row(none, "st-2");
  assert.match(r.textContent, /no open accounts yet: create one/);
  assert.equal(r.querySelector('[name="new_account_name"]').value, "Roth IRA");

  const empty = await map({ external_accounts: [], accounts: [], links: [] }, 'empty="They appear once SnapTrade is read."');
  assert.equal(empty.textContent, "They appear once SnapTrade is read.");
});

test("om-link is heard before the form is sent, and a page may send the link itself", async () => {
  const m = await map();
  const seen = [];
  m.addEventListener("om-link", (e) => seen.push(e.detail));
  const create = row(m, "st-2").querySelectorAll("form")[1];
  create.querySelector('[name="new_account_name"]').value = "Retirement (Fidelity)";
  const submit = () => {
    const e = new Event("submit", { bubbles: true, cancelable: true });
    create.dispatchEvent(e);
    return e.defaultPrevented;
  };
  assert.equal(submit(), false, "not cancelled: the browser posts the form");
  assert.equal(seen[0].intent, "create");
  assert.equal(seen[0].external_account_id, "st-2");
  assert.equal(seen[0].new_account_name, "Retirement (Fidelity)");
  assert.equal(seen[0].new_account_custodian, "Fidelity");
  assert.equal(seen[0].account_id, "");
  assert.equal(seen[0].form, create);
  assert.equal("csrf" in seen[0], false, "the token is the form's, not the event's");

  m.addEventListener("om-link", (e) => e.preventDefault());
  assert.equal(submit(), true, "cancelled: the page sends it");
});

test("data set by script is drawn, and held to its shape", async () => {
  document.body.innerHTML = "<om-account-map></om-account-map>";
  await settle();
  const m = document.querySelector("om-account-map");
  m.data = {
    external_accounts: [{ external_account_id: "x", name: "<b>not markup</b>" }, { name: "no ID" }, null],
    accounts: [{ account_id: "A", name: "A" }, { name: "no ID" }],
    links: [{ external_account_id: "x", account_id: "" }],
  };
  assert.equal(m.querySelectorAll(".om-account-map-row").length, 1, "an account without an ID is left out");
  assert.equal(m.querySelector(".title").textContent, "<b>not markup</b>");
  assert.equal(m.querySelector("b"), null, "text, never markup");
  assert.equal(m.querySelector(".badge").textContent, "Not linked", "a link naming no account is none");
  assert.deepEqual(m.data.accounts, [{ account_id: "A", name: "A", custodian: "", account_type: "", open: true }]);
});

test("script's data wins over the declared JSON; JSON that does not parse is reported", async () => {
  document.body.innerHTML = "";
  const m = document.createElement("om-account-map");
  m.data = { external_accounts: [{ external_account_id: "from-script" }] };
  m.innerHTML = json(DATA);
  document.body.append(m);
  await settle();
  assert.deepEqual([...m.querySelectorAll(".om-account-map-row")].map((r) => r.dataset.external), ["from-script"]);

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
  assert.equal(m.querySelectorAll(".om-account-map-row").length, 3);
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

test("the map is two columns where it is wide and one where it is narrow", () => {
  const body = '<om-account-map><div class="om-account-map-head"><span>E</span><span>D</span></div><div class="om-account-map-row"><div>a</div><div>b</div></div></om-account-map>';
  const wide = at(1200, body);
  assert.equal(wide(".om-account-map-row").display, "grid");
  assert.match(wide(".om-account-map-row").gridTemplateColumns, /2fr.*3fr/);
  assert.equal(wide(".om-account-map-head").display, "grid");
  const phone = at(390, body);
  assert.doesNotMatch(phone(".om-account-map-row").gridTemplateColumns, /3fr/);
  assert.equal(phone(".om-account-map-head").display, "none");
  assert.match(CSS, /om-account-map \{ display: block; container: om-account-map \/ inline-size; \}/, "by the map's own width");
});
