// <om-account-map>: a plugin links each external account it reads to one of
// the deployment's accounts (meridian-design W6.4), on its admin page.
//
//   <om-account-map action="/admin/accounts/link" token-name="csrf" token="…"
//                   group-by="connection" link-several>
//     <script type="application/json">
//       { "external_accounts": [{ "external_account_id": "…", "name": "…", "detail": "…",
//                                 "custodian": "…", "account_type": "…", "note": "…",
//                                 "number": "…", "connection": "…", "connection_id": "…",
//                                 "status": { "state": "ok|busy|warn|error", "label": "…",
//                                             "detail": "…", "at": "…ISO…", "at_label": "…" },
//                                 "values": [{ "label": "…", "value": "…", "tone": "good|warn|bad" }] }],
//         "accounts": [{ "account_id": "…", "name": "…", "custodian": "…", "account_type": "…",
//                        "open": true, "number": "…" }],
//         "links":    [{ "external_account_id": "…", "account_id": "…", "account_name": "…" }] }
//     </script>
//   </om-account-map>
//
// A dense table, one row per external account: its name and detail, its link
// (the deployment's account it is linked to, from `links`, the SDK's
// AccountScope.links as they are, or Not linked; there is no third state),
// and its actions. Built for hundreds or thousands of accounts:
//
// - a search over the external and the deployment's accounts' names, IDs,
//   custodians, types and numbers, applied at most once a frame;
// - Unlinked, Linked and All, with counts; Unlinked first where there are any,
//   because that is the work;
// - grouping by connection or custodian, each group collapsible, with counts;
// - where an account carries a `status` (0.6.0), a Status column: om-status's
//   dot, its label beside it and its detail and moment in the dot's note, and
//   the account's `values` under it; and a filter by state, with "Needs
//   attention" (warn or error) first, so the accounts to act on are found
//   among thousands;
// - pages (`page-size`, 50 by default), so the document holds a page of rows
//   however many accounts there are, and each row, once drawn, is kept and
//   moved rather than drawn again;
// - the choices for one row (an open account, found by typing; a new account,
//   unless the page says `no-new-account` (0.7.1), because the person viewing
//   it may not create one; Unlink) open under that row only, when asked for;
// - a suggestion where an unlinked account's name, or its number, matches
//   exactly one open account nothing else is linked to or suggested for:
//   Link takes it, and with `link-several`, "Link N suggested…" lists every
//   suggestion the search finds, to review, and sends them in one form.
//
// Every action is a plain form, posted to `action` with the page's token in
// the hidden field `token-name` names, and fields named as the SDK's
// link_external_account takes them: `external_account_id`, and `account_id`
// to link an existing account, or `new_account_name`, `new_account_custodian`
// and `new_account_type` to create one, or neither to unlink; `intent` says
// which (`link`, `create`, `unlink`); with `no-new-account`, no `create` form
// is drawn anywhere. The several-link form (`link-several`, only where the
// page says its handler takes it) carries `intent` `link-several` and one
// `external_account_id` and one `account_id` per link, in pairs, in order. A page with script hears `om-link` first, and may
// cancel it to send the link itself.

import { declaredJson, whenParsed } from "../lib/declared.js";
import { STATES } from "./om-status.js";

let instances = 0;

// Rows on a page, unless `page-size` says otherwise.
const PAGE_SIZE = 50;
// Open accounts a row's chooser lists at once: typing narrows it.
const CHOICES = 50;
const FILTERS = [
  ["unlinked", "Unlinked"],
  ["linked", "Linked"],
  ["all", "All"],
];
// A state's order in the state filter: what needs acting on first.
const SEVERITY = { error: 0, warn: 1, busy: 2, ok: 3, "": 4 };
const TONES = new Set(["good", "warn", "bad"]);
const GROUPINGS = [
  ["", "None"],
  ["connection", "Connection"],
  ["custodian", "Custodian"],
];

const text = (v) => (v === undefined || v === null ? "" : String(v));
/** A value as a search and a match compare it: case, spacing and width set aside. */
const fold = (v) => text(v).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const count = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function hidden(name, value) {
  const input = el("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

function button(label, className = "", type = "button") {
  const b = el("button", className, label);
  b.type = type;
  return b;
}

/** An account's status, held to om-status's shape, or null. */
function statusOf(v) {
  if (!v || typeof v !== "object") return null;
  const state = Object.hasOwn(STATES, text(v.state)) ? text(v.state) : "";
  const label = text(v.label).trim() || STATES[state] || "";
  if (!label) return null;
  return { state, label, detail: text(v.detail), at: text(v.at), at_label: text(v.at_label) };
}

/** An account's values to show under its status: a label, a value and a status tone. */
function valuesOf(v) {
  return (Array.isArray(v) ? v : [])
    .filter((x) => x && typeof x === "object" && (text(x.label) || text(x.value)))
    .map((x) => ({ label: text(x.label), value: text(x.value), tone: TONES.has(text(x.tone)) ? text(x.tone) : "" }));
}

/** The page's data, held to its shape: anything else is left out, never guessed. */
function normalise(data) {
  const d = data && typeof data === "object" ? data : {};
  const seen = new Set();
  const externals = (Array.isArray(d.external_accounts) ? d.external_accounts : [])
    .filter((x) => x && typeof x === "object" && text(x.external_account_id))
    .filter((x) => !seen.has(text(x.external_account_id)) && seen.add(text(x.external_account_id)))
    .map((x) => ({
      external_account_id: text(x.external_account_id),
      name: text(x.name),
      detail: text(x.detail),
      custodian: text(x.custodian),
      account_type: text(x.account_type),
      note: text(x.note),
      number: text(x.number),
      connection: text(x.connection),
      connection_id: text(x.connection_id),
      status: statusOf(x.status),
      values: valuesOf(x.values),
    }));
  const accounts = Array.isArray(d.accounts)
    ? d.accounts
        .filter((a) => a && typeof a === "object" && text(a.account_id))
        .map((a) => ({
          account_id: text(a.account_id),
          name: text(a.name),
          custodian: text(a.custodian),
          account_type: text(a.account_type),
          open: a.open !== false,
          number: text(a.number),
        }))
    : null;
  const links = (Array.isArray(d.links) ? d.links : [])
    .filter((l) => l && typeof l === "object" && text(l.external_account_id) && text(l.account_id))
    .map((l) => ({ external_account_id: text(l.external_account_id), account_id: text(l.account_id), account_name: text(l.account_name) }));
  return { external_accounts: externals, accounts, links };
}

/** An account as a person tells one from another: its name, and where it is held and what it is. */
function described(account) {
  const more = [account.custodian, account.account_type].filter(Boolean).join(", ");
  const name = account.name || account.account_id;
  return more ? `${name} (${more})` : name;
}

/**
 * Suggestions: for each unlinked external account, the one open account its
 * name, or its number, matches (a name to a name, a number to a number or to
 * a name), where exactly one does, nothing is linked to it already, and no
 * other unlinked account is suggested it too. Matching is exact but for case,
 * spacing and character width.
 */
function suggest(externals, open, links) {
  const index = new Map();
  const put = (key, account) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(account);
  };
  for (const a of open) {
    put(`n:${fold(a.name)}`, a);
    if (fold(a.number)) put(`#:${fold(a.number)}`, a);
  }
  const taken = new Set([...links.values()].map((l) => l.account_id));
  const proposed = new Map();
  const claims = new Map();
  for (const x of externals) {
    if (links.has(x.external_account_id)) continue;
    const found = new Map();
    const look = (key, why) => {
      for (const a of index.get(key) || []) if (!found.has(a)) found.set(a, why);
    };
    if (fold(x.name)) look(`n:${fold(x.name)}`, "same name");
    if (fold(x.number)) {
      look(`#:${fold(x.number)}`, "same number");
      look(`n:${fold(x.number)}`, "named by its number");
    }
    if (found.size !== 1) continue;
    const [[account, why]] = found;
    if (taken.has(account.account_id)) continue;
    proposed.set(x.external_account_id, { account, why });
    claims.set(account.account_id, (claims.get(account.account_id) || 0) + 1);
  }
  for (const [id, s] of proposed) if (claims.get(s.account.account_id) > 1) proposed.delete(id);
  return proposed;
}

/** What the map shows, worked out once when its data is set. */
function model(data) {
  const accounts = data.accounts;
  const byAccount = new Map((accounts || []).map((a) => [a.account_id, a]));
  const links = new Map();
  for (const l of data.links) if (!links.has(l.external_account_id)) links.set(l.external_account_id, l);
  const open = (accounts || []).filter((a) => a.open);
  const suggestions = accounts === null ? new Map() : suggest(data.external_accounts, open, links);
  const hayOf = (...values) => values.map(fold).filter(Boolean).join("\n");
  const rows = data.external_accounts.map((x, i) => {
    const link = links.get(x.external_account_id) || null;
    const account = link ? byAccount.get(link.account_id) || null : null;
    const suggestion = suggestions.get(x.external_account_id) || null;
    const s = suggestion?.account;
    return {
      i,
      x,
      link,
      account,
      suggestion,
      attention: x.status?.state === "warn" || x.status?.state === "error",
      hay: hayOf(
        x.name, x.external_account_id, x.custodian, x.account_type, x.detail, x.number, x.connection,
        link?.account_name, link?.account_id, account?.name, account?.custodian, account?.account_type, account?.number,
        s?.name, s?.account_id, s?.custodian, s?.account_type,
        x.status?.label, x.status?.detail, ...x.values.map((v) => `${v.label} ${v.value}`),
      ),
    };
  });
  // Each status the accounts are in, by its label, what needs acting on first.
  const states = new Map();
  for (const r of rows) {
    const st = r.x.status;
    if (st && !states.has(st.label)) states.set(st.label, st.state);
  }
  return {
    rows,
    shows: rows.some((r) => r.x.status || r.x.values.length),
    states: [...states].sort((a, b) => SEVERITY[a[1]] - SEVERITY[b[1]]).map(([label]) => label),
    attention: rows.some((r) => r.attention),
    byId: new Map(rows.map((r) => [r.x.external_account_id, r])),
    accounts,
    open: open.map((a) => ({ a, hay: hayOf(a.name, a.account_id, a.custodian, a.account_type, a.number), label: described(a) })),
    groupings: GROUPINGS.filter(([by]) => !by || rows.some((r) => groupOf(r, by).label !== groupOf(rows[0], by).label)),
  };
}

/** A row's group under a grouping: worked out once per row. */
function groupOf(row, by) {
  row.groups ??= {};
  if (row.groups[by]) return row.groups[by];
  const x = row.x;
  row.groups[by] =
    by === "connection"
      ? { key: `c:${x.connection_id || x.connection}`, label: x.connection || x.connection_id || "No connection" }
      : { key: `k:${fold(x.custodian)}`, label: x.custodian || "No custodian" };
  return row.groups[by];
}

const tokensOf = (q) => fold(q).split(" ").filter(Boolean);

export class OmAccountMap extends HTMLElement {
  static get observedAttributes() {
    return ["action", "token", "token-name", "empty", "link-several", "no-new-account", "page-size", "status-heading"];
  }

  #data = normalise(null);
  #model = model(this.#data);
  #dataSet = false;
  #built = false;
  #waiting = false;
  #id = `om-account-map-${++instances}`;

  // What the person has asked to see.
  #q = "";
  #filter = "all";
  #state = "";
  #groupBy = "";
  #page = 0;
  #collapsed = new Set();
  #editing = null;
  #reviewing = false;
  #viewed = false;
  #memo = null;

  // The parts drawn once per data, and each row once drawn.
  #parts = null;
  #rowEls = new Map();
  #editor = null;
  #frame = null;

  connectedCallback() {
    if (this.#built || this.#waiting) return;
    this.#waiting = true;
    whenParsed(() => {
      this.#waiting = false;
      if (this.#built || !this.isConnected) return;
      if (!this.#dataSet) {
        const declared = declaredJson(this);
        if (declared) this.#setData(declared);
      }
      this.#built = true;
      this.addEventListener("submit", (e) => this.#submitted(e));
      this.#start();
    });
  }

  attributeChangedCallback(name) {
    if (!this.#built) return;
    if (name === "page-size") this.#page = 0;
    this.#start();
  }

  /** `{ external_accounts, accounts, links }`, as the declared JSON carries it. */
  get data() {
    return structuredClone(this.#data);
  }

  set data(value) {
    this.#dataSet = true;
    this.#setData(value);
    if (this.#built) this.#start();
  }

  /** The link standing for an external account, or null: linked or not, never unknown. */
  linkOf(externalAccountId) {
    const link = this.#model.byId.get(String(externalAccountId))?.link;
    return link ? { ...link } : null;
  }

  /** The account suggested for an unlinked external account, and why, or null. */
  suggestionOf(externalAccountId) {
    const s = this.#model.byId.get(String(externalAccountId))?.suggestion;
    return s ? { account_id: s.account.account_id, name: s.account.name, why: s.why } : null;
  }

  /** Every suggestion, in the order of the external accounts. */
  get suggestions() {
    return this.#model.rows
      .filter((r) => r.suggestion)
      .map((r) => ({ external_account_id: r.x.external_account_id, account_id: r.suggestion.account.account_id, why: r.suggestion.why }));
  }

  /** Apply a search typed but not yet drawn now, rather than on the next frame. */
  flush() {
    if (this.#frame !== null) {
      (globalThis.cancelAnimationFrame || clearTimeout)(this.#frame);
      this.#frame = null;
    }
    if (this.#parts) this.#draw();
  }

  #setData(value) {
    this.#data = normalise(value);
    this.#model = model(this.#data);
  }

  #pageSize() {
    const n = Math.floor(Number(this.getAttribute("page-size")));
    return n > 0 ? n : PAGE_SIZE;
  }

  // ── The frame: drawn once per data ───────────────────────────────────────

  /** Draw the map afresh. The first data it draws sets the view to start
   * with; data set after that keeps what the person has asked to see (the
   * search, the filter, the grouping, the page), as far as it still can. */
  #start() {
    this.#rowEls.clear();
    this.#editor = null;
    const m = this.#model;
    if (!this.#viewed && m.rows.length) {
      this.#viewed = true;
      this.#filter = m.rows.some((r) => !r.link) ? "unlinked" : "all";
      const by = this.getAttribute("group-by") || "";
      this.#groupBy = m.groupings.some(([g]) => g === by) ? by : "";
    } else if (!m.groupings.some(([g]) => g === this.#groupBy)) {
      this.#groupBy = "";
    }
    if (this.#state && !(this.#state === "attention" ? m.attention : m.states.includes(this.#state.slice(1)))) this.#state = "";
    if (!m.rows.length) {
      this.#parts = null;
      this.replaceChildren(el("div", "om-account-map-empty", this.getAttribute("empty") || "No external accounts yet."));
      return;
    }
    const id = this.#id;
    const bar = el("div", "om-account-map-bar");
    const search = el("input", "om-account-map-search");
    search.type = "search";
    search.id = `${id}-search`;
    search.autocomplete = "off";
    search.spellcheck = false;
    search.placeholder = "Search by name, ID, number or type";
    search.setAttribute("aria-label", "Search the accounts");
    search.setAttribute("aria-controls", `${id}-table`);
    search.value = this.#q;
    search.addEventListener("input", () => {
      this.#q = search.value;
      this.#page = 0;
      this.#schedule();
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && search.value) {
        e.preventDefault();
        search.value = "";
        this.#q = "";
        this.#page = 0;
        this.flush();
      }
    });

    const filters = el("div", "om-account-map-filters");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Show");
    const filterButtons = FILTERS.map(([key, label]) => {
      const b = button("", "", "button");
      b.dataset.filter = key;
      b.append(el("span", "", label), " ", el("span", "count", ""));
      b.addEventListener("click", () => {
        this.#filter = key;
        this.#page = 0;
        this.#draw();
      });
      return b;
    });
    filters.append(...filterButtons);
    bar.append(search, filters);

    // By state, where the accounts carry one: "Needs attention" first.
    let state = null;
    if (m.states.length) {
      const wrap = el("label", "om-account-map-grouping om-account-map-by-state");
      state = el("select");
      state.id = `${id}-state`;
      const options = [["", "All states"]];
      if (m.attention) options.push(["attention", "Needs attention"]);
      for (const label of m.states) options.push([`=${label}`, label]);
      for (const [value, label] of options) {
        const o = el("option", "", label);
        o.value = value;
        o.dataset.label = label;
        state.append(o);
      }
      state.value = this.#state;
      state.addEventListener("change", () => {
        this.#state = state.value;
        this.#page = 0;
        this.#draw();
      });
      wrap.append(el("span", "", "State"), state);
      bar.append(wrap);
    }

    let grouping = null;
    if (m.groupings.length > 1) {
      const wrap = el("label", "om-account-map-grouping");
      grouping = el("select");
      grouping.id = `${id}-group`;
      for (const [by, label] of m.groupings) {
        const o = el("option", "", label);
        o.value = by;
        grouping.append(o);
      }
      grouping.value = this.#groupBy;
      grouping.addEventListener("change", () => {
        this.#groupBy = grouping.value;
        this.#page = 0;
        this.#collapsed.clear();
        this.#draw();
      });
      wrap.append(el("span", "", "Group by"), grouping);
      bar.append(wrap);
    }

    const several = button("", "om-account-map-several");
    several.setAttribute("aria-controls", `${id}-review`);
    several.addEventListener("click", () => {
      this.#reviewing = !this.#reviewing;
      this.#draw();
      if (this.#reviewing) this.#parts.review.querySelector("button[type=submit]")?.focus();
    });
    bar.append(several);

    const review = el("div", "om-account-map-review");
    review.id = `${id}-review`;
    review.hidden = true;

    const status = el("div", "om-account-map-status");
    const said = el("span", "om-account-map-said");
    said.setAttribute("role", "status");
    said.setAttribute("aria-live", "polite");
    const pagerTop = this.#pager();
    status.append(said, pagerTop.nav);

    const table = el("table", `om-account-map-table${m.shows ? " om-account-map-with-state" : ""}`);
    table.id = `${id}-table`;
    const caption = el("caption", "visually-hidden", "External accounts, each with the deployment's account it is linked to");
    const head = el("thead");
    const tr = el("tr");
    const columns = [["External account", ""], ["Deployment account", ""], ["Actions", "om-account-map-actions"]];
    if (m.shows) columns.splice(1, 0, [this.getAttribute("status-heading") || "Status", "om-account-map-state"]);
    for (const [label, cls] of columns) {
      const th = el("th", cls, label);
      th.scope = "col";
      tr.append(th);
    }
    head.append(tr);
    const body = el("tbody");
    table.append(caption, head, body);
    table.addEventListener("click", (e) => this.#clicked(e));

    const foot = el("div", "om-account-map-foot");
    const pagerBottom = this.#pager();
    foot.append(pagerBottom.nav);

    this.#parts = { search, filterButtons, state, grouping, several, review, said, pagers: [pagerTop, pagerBottom], foot, body, span: columns.length };
    this.replaceChildren(bar, review, status, table, foot);
    this.#draw();
  }

  #pager() {
    const nav = el("nav", "om-account-map-pager");
    nav.setAttribute("aria-label", "Pages");
    const prev = button("Previous", "small");
    const where = el("span", "om-account-map-page");
    const next = button("Next", "small");
    prev.addEventListener("click", () => this.#turn(-1));
    next.addEventListener("click", () => this.#turn(1));
    nav.append(prev, where, next);
    return { nav, prev, next, where };
  }

  #turn(by) {
    this.#page += by;
    this.#draw();
  }

  #schedule() {
    if (this.#frame !== null) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    this.#frame = raf(() => {
      this.#frame = null;
      if (this.#parts) this.#draw();
    });
  }

  // ── The view: what the search, the filter and the grouping leave ─────────

  /** What the search, the filter and the grouping leave, worked out again
   * only when one of them (or the data) changes: turning a page only slices it. */
  #matched() {
    const m = this.#model;
    const key = [this.#q, this.#filter, this.#state, this.#groupBy, ...this.#collapsed].join("\u0000");
    if (this.#memo && this.#memo.model === m && this.#memo.key === key) return this.#memo;
    const tokens = tokensOf(this.#q);
    const searched = tokens.length ? m.rows.filter((r) => tokens.every((t) => r.hay.includes(t))) : m.rows;
    // How many of what the search leaves are in each state, then those in the one chosen.
    const states = new Map([["", searched.length], ["attention", 0]]);
    for (const r of searched) {
      if (r.attention) states.set("attention", states.get("attention") + 1);
      if (r.x.status) states.set(`=${r.x.status.label}`, (states.get(`=${r.x.status.label}`) || 0) + 1);
    }
    const st = this.#state;
    const matched = !st ? searched : st === "attention" ? searched.filter((r) => r.attention) : searched.filter((r) => r.x.status && `=${r.x.status.label}` === st);
    const counts = { unlinked: 0, linked: 0, all: matched.length };
    const suggested = [];
    for (const r of matched) {
      if (r.link) counts.linked++;
      else counts.unlinked++;
      if (r.suggestion) suggested.push(r);
    }
    const f = this.#filter;
    const rows = f === "all" ? matched : matched.filter((r) => (f === "linked") === Boolean(r.link));
    // Entries: a group's head, then its rows unless it is folded.
    let entries = rows;
    const groups = new Map();
    if (this.#groupBy) {
      for (const r of rows) {
        const g = groupOf(r, this.#groupBy);
        let group = groups.get(g.key);
        if (!group) groups.set(g.key, (group = { ...g, rows: [], unlinked: 0 }));
        group.rows.push(r);
        if (!r.link) group.unlinked++;
      }
      entries = [];
      for (const g of groups.values()) {
        entries.push({ group: g });
        if (!this.#collapsed.has(g.key)) for (const r of g.rows) entries.push(r);
      }
    }
    // How many rows come before each entry, for "showing 51–100".
    const before = new Int32Array(entries.length + 1);
    for (let i = 0; i < entries.length; i++) before[i + 1] = before[i] + (entries[i].group ? 0 : 1);
    this.#memo = { model: m, key, tokens, counts, states, rows, suggested, entries, groups, before };
    return this.#memo;
  }

  #view() {
    const { tokens, counts, states, rows, suggested, entries, groups, before } = this.#matched();
    const size = this.#pageSize();
    const pages = Math.max(1, Math.ceil(entries.length / size));
    this.#page = Math.min(Math.max(0, this.#page), pages - 1);
    const start = this.#page * size;
    const page = entries.slice(start, start + size);
    // A page opening inside a group opens with that group's head.
    if (this.#groupBy && page.length && !page[0].group) {
      const g = groups.get(groupOf(page[0], this.#groupBy).key);
      page.unshift({ group: g, continued: true });
    }
    return { tokens, counts, states, rows, page, pages, before: before[start], suggested };
  }

  #draw() {
    const p = this.#parts;
    const v = this.#view();
    const f = this.#filter;

    for (const b of p.filterButtons) {
      b.setAttribute("aria-pressed", String(b.dataset.filter === f));
      b.querySelector(".count").textContent = count(v.counts[b.dataset.filter]);
    }
    if (p.grouping) p.grouping.value = this.#groupBy;
    if (p.state) {
      for (const o of p.state.options) o.textContent = `${o.dataset.label} (${count(v.states.get(o.value) || 0)})`;
      p.state.value = this.#state;
    }

    // Several links: offered only where the page's handler takes them.
    const offerSeveral = this.hasAttribute("link-several") && v.suggested.length > 0;
    if (!offerSeveral) this.#reviewing = false;
    p.several.hidden = !offerSeveral;
    p.several.textContent = `Link ${count(v.suggested.length)} suggested…`;
    p.several.setAttribute("aria-expanded", String(this.#reviewing));
    p.several.className = `om-account-map-several${this.#reviewing ? "" : " primary"}`;
    if (this.#reviewing) this.#drawReview(v.suggested);
    else if (!p.review.hidden) {
      p.review.hidden = true;
      p.review.replaceChildren();
    }

    // Where the row being edited is no longer shown, its choices close.
    if (this.#editing !== null && !v.page.some((e) => e.x && e.x.external_account_id === this.#editing)) this.#close(false);

    const noun = f === "all" ? "account" : `${f} account`;
    const matching = (v.tokens.length ? ` matching “${this.#q.trim()}”` : "") + this.#inState();
    const rowsHere = v.page.filter((e) => !e.group).length;
    let said = `${plural(v.rows.length, noun)}${matching}`;
    if (v.pages > 1 && rowsHere) said += `; showing ${count(v.before + 1)}–${count(v.before + rowsHere)}`;
    p.said.textContent = said;
    for (const pager of p.pagers) {
      pager.nav.hidden = v.pages < 2;
      pager.where.textContent = `Page ${count(this.#page + 1)} of ${count(v.pages)}`;
      pager.prev.disabled = this.#page === 0;
      pager.next.disabled = this.#page >= v.pages - 1;
    }
    p.foot.hidden = v.pages < 2;

    const nodes = [];
    for (const entry of v.page) {
      if (entry.group) {
        nodes.push(this.#groupEl(entry.group, entry.continued));
        continue;
      }
      nodes.push(this.#rowEl(entry));
      if (this.#editing === entry.x.external_account_id) nodes.push(this.#editorEl(entry));
    }
    if (!nodes.length) {
      const tr = el("tr", "om-account-map-none");
      const td = el("td", "", this.#emptyText(v));
      td.colSpan = p.span;
      tr.append(td);
      nodes.push(tr);
    }
    // The rows already there, in order, are left as they are.
    const now = p.body.children;
    if (now.length !== nodes.length || nodes.some((node, i) => now[i] !== node)) p.body.replaceChildren(...nodes);
  }

  /** The state chosen, as the count of accounts says it: "", or " needing attention", or " in Stale". */
  #inState() {
    const st = this.#state;
    return !st ? "" : st === "attention" ? " needing attention" : ` in ${st.slice(1)}`;
  }

  #emptyText(v) {
    if (this.#state && !v.tokens.length) return `No ${this.#filter === "all" ? "" : `${this.#filter} `}account${this.#inState()}.`;
    if (v.tokens.length) return `No ${this.#filter === "all" ? "" : `${this.#filter} `}account${this.#inState()} matches “${this.#q.trim()}”.`;
    if (this.#filter === "unlinked") return "Every account is linked.";
    if (this.#filter === "linked") return "No account is linked yet.";
    return "No accounts.";
  }

  // ── Rows ─────────────────────────────────────────────────────────────────

  #groupEl(g, continued) {
    const tr = el("tr", "om-account-map-group");
    const th = el("th");
    th.colSpan = this.#parts.span;
    th.scope = "rowgroup";
    const folded = this.#collapsed.has(g.key);
    const toggle = button("", "om-account-map-fold");
    toggle.dataset.group = g.key;
    toggle.setAttribute("aria-expanded", String(!folded));
    toggle.append(el("span", "om-account-map-name", g.label), " ", el("span", "count", count(g.rows.length)));
    if (this.#filter === "all" && g.unlinked) toggle.append(" ", el("span", "badge warn", `${count(g.unlinked)} not linked`));
    if (continued) toggle.append(" ", el("span", "faint", "continued"));
    th.append(toggle);
    tr.append(th);
    return tr;
  }

  #rowEl(r) {
    const key = r.x.external_account_id;
    let tr = this.#rowEls.get(key);
    const editing = this.#editing === key;
    if (!tr) {
      tr = this.#makeRow(r);
      this.#rowEls.set(key, tr);
    }
    tr.classList.toggle("selected", editing);
    tr.querySelector("[data-edit]").setAttribute("aria-expanded", String(editing));
    return tr;
  }

  #makeRow(r) {
    const { x, link, account, suggestion } = r;
    const id = `${this.#id}-${r.i}`;
    const tr = el("tr", "om-account-map-row");
    tr.dataset.external = x.external_account_id;

    const ext = el("td", "om-account-map-external");
    const title = el("div", "title", x.name || x.external_account_id);
    title.id = `${id}-title`;
    ext.append(title);
    const meta = el("div", "meta");
    for (const part of [x.detail, x.number && `No. ${x.number}`]) if (part) meta.append(`${part} · `);
    meta.append(el("code", "", x.external_account_id));
    ext.append(meta);
    if (x.note) ext.append(el("span", "hint", x.note));

    const to = el("td", "om-account-map-link");
    if (link) {
      const said = el("div", "om-account-map-linked");
      said.append(el("span", "badge good", "Linked"), " ", el("span", "title", link.account_name || account?.name || link.account_id));
      to.append(said);
      const where = el("div", "meta");
      const more = account ? [account.custodian, account.account_type].filter(Boolean).join(" · ") : "";
      if (more) where.append(`${more} · `);
      where.append(el("code", "", link.account_id));
      to.append(where);
    } else {
      to.append(el("span", "badge warn", "Not linked"));
      if (suggestion) {
        const s = el("div", "om-account-map-suggestion");
        s.append(el("span", "muted", "Suggested: "), el("span", "title", described(suggestion.account)));
        s.append(el("span", "hint", `${suggestion.why} · ${suggestion.account.account_id}`));
        to.append(s);
      }
    }

    const state = this.#model.shows ? this.#stateCell(x) : null;

    const actions = el("td", "om-account-map-actions");
    const wrap = el("div", "om-account-map-buttons");
    if (suggestion) {
      const take = button("Link", "small primary", "submit");
      take.setAttribute("aria-label", `Link ${x.name || x.external_account_id} to ${suggestion.account.name || suggestion.account.account_id}`);
      wrap.append(this.#form(x, "link", [hidden("account_id", suggestion.account.account_id)], take, "inline"));
    }
    const edit = button(link ? "Change…" : suggestion ? "Other…" : "Link…", "small");
    edit.dataset.edit = x.external_account_id;
    edit.setAttribute("aria-expanded", "false");
    edit.setAttribute("aria-controls", `${this.#id}-editor`);
    edit.setAttribute("aria-describedby", `${id}-title`);
    wrap.append(edit);
    actions.append(wrap);

    tr.append(...[ext, state, to, actions].filter(Boolean));
    return tr;
  }

  /** The account's status (om-status's dot, its label beside it) and its values under it. */
  #stateCell(x) {
    const td = el("td", "om-account-map-state");
    const st = x.status;
    if (st) {
      const line = el("div", "om-account-map-state-line");
      const dot = document.createElement("om-status");
      dot.setAttribute("state", st.state);
      dot.setAttribute("label", st.label);
      if (st.detail) dot.setAttribute("detail", st.detail);
      if (st.at) dot.setAttribute("at", st.at);
      if (st.at_label) dot.setAttribute("at-label", st.at_label);
      // The dot's own name is the label: shown again beside it, for the eye alone.
      const said = el("span", "om-account-map-state-label", st.label);
      said.setAttribute("aria-hidden", "true");
      line.append(dot, said);
      td.append(line);
    }
    for (const v of x.values) {
      const line = el("div", "hint");
      if (v.label) line.append(el("span", "om-account-map-value-label", `${v.label}: `));
      line.append(el("span", v.tone ? `${v.tone}-ink` : "", v.value));
      td.append(line);
    }
    return td;
  }

  #clicked(e) {
    const edit = e.target.closest?.("[data-edit]");
    if (edit && this.contains(edit)) {
      const key = edit.dataset.edit;
      if (this.#editing === key) this.#close();
      else this.#open(key);
      return;
    }
    const head = e.target.closest?.("[data-group]");
    if (head && this.contains(head)) {
      const key = head.dataset.group;
      if (this.#collapsed.has(key)) this.#collapsed.delete(key);
      else this.#collapsed.add(key);
      this.#draw();
      [...this.#parts.body.querySelectorAll("[data-group]")].find((b) => b.dataset.group === key)?.focus();
    }
  }

  // ── One row's choices ────────────────────────────────────────────────────

  #open(key) {
    this.#editing = key;
    this.#editor = null;
    this.#draw();
    const tr = this.#editor?.tr;
    (tr?.querySelector("[role=combobox]") || tr?.querySelector("input[type=text]"))?.focus();
  }

  #close(redraw = true) {
    const key = this.#editing;
    this.#editing = null;
    this.#editor = null;
    if (!redraw) return;
    this.#draw();
    this.#rowEls.get(key)?.querySelector("[data-edit]")?.focus();
  }

  #editorEl(r) {
    if (this.#editor && this.#editor.key === r.x.external_account_id) return this.#editor.tr;
    const { x, link } = r;
    const id = `${this.#id}-${r.i}`;
    const tr = el("tr", "om-account-map-editor");
    tr.id = `${this.#id}-editor`;
    const td = el("td");
    td.colSpan = this.#parts.span;
    const box = el("div", "om-account-map-edit");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `Link ${x.name || x.external_account_id}`);

    if (link) {
      const unlink = button("Unlink", "danger", "submit");
      const head = el("div", "om-account-map-edit-head");
      const said = el("p", "", "");
      said.append(el("span", "muted", "Linked to "), el("span", "title", link.account_name || r.account?.name || link.account_id), ".");
      head.append(said, this.#form(x, "unlink", [], unlink, "inline"));
      box.append(head, el("h3", "", "Link to another account"));
    }

    const m = this.#model;
    const current = link ? link.account_id : "";
    const open = m.open.filter((o) => o.a.account_id !== current);
    // A new account, unless the page says the person viewing it may not create one.
    const creates = !this.hasAttribute("no-new-account");
    if (m.accounts === null) {
      box.append(el("p", "hint", "The deployment's accounts could not be read, so none is offered here."));
    } else if (!open.length) {
      const none = current ? "The deployment has no other open account" : "The deployment has no open accounts yet";
      box.append(el("p", "hint", `${none}${creates ? ": create one" : ""}.`));
    } else {
      box.append(this.#chooser(r, id, open));
      if (creates) box.append(el("div", "om-account-map-or", "or"));
    }
    if (creates) box.append(this.#createForm(x, id));

    const cancel = button("Close", "link om-account-map-close");
    cancel.addEventListener("click", () => this.#close());
    box.append(cancel);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        this.#close();
      }
    });
    td.append(box);
    tr.append(td);
    this.#editor = { key: x.external_account_id, tr };
    return tr;
  }

  /** A new account named from the external one, its custodian and type prefilled, and Create and link. */
  #createForm(x, id) {
    const field = (name, label, value, required) => {
      const input = el("input");
      input.type = "text";
      input.name = name;
      input.value = value;
      input.required = required;
      input.id = `${id}-${name}`;
      input.autocomplete = "off";
      return this.#field(input, label, name === "new_account_name" ? "om-account-map-name" : "");
    };
    return this.#form(
      x,
      "create",
      [
        field("new_account_name", "A new account", x.name || x.external_account_id, true),
        field("new_account_custodian", "Custodian", x.custodian, false),
        field("new_account_type", "Type", x.account_type, false),
      ],
      button("Create and link", "primary", "submit"),
    );
  }

  /** The open accounts, found by typing: a combobox over them, and the one chosen. */
  #chooser(r, id, open) {
    const input = el("input");
    input.type = "search";
    input.id = `${id}-pick`;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = `Type to find one of ${plural(open.length, "open account")}`;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", `${id}-choices`);
    const chosen = hidden("account_id", "");
    const list = el("ul", "om-account-map-choices");
    list.id = `${id}-choices`;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Open accounts");
    list.hidden = true;
    const say = el("p", "hint om-account-map-chosen");
    say.id = `${id}-chosen`;
    input.setAttribute("aria-describedby", say.id);

    let found = [];
    let active = -1;
    let label = "";
    let frame = null;
    const suggested = r.suggestion?.account.account_id;
    const choose = (o) => {
      chosen.value = o.a.account_id;
      label = o.label;
      input.value = o.label;
      input.removeAttribute("aria-invalid");
      say.textContent = `Chosen: ${o.label}, ${o.a.account_id}.`;
      hide();
    };
    const hide = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    };
    const draw = () => {
      const tokens = tokensOf(input.value === label ? "" : input.value);
      const all = tokens.length ? open.filter((o) => tokens.every((t) => o.hay.includes(t))) : open;
      // The suggestion first, then the plugin's order.
      found = suggested ? [...all.filter((o) => o.a.account_id === suggested), ...all.filter((o) => o.a.account_id !== suggested)] : all;
      const items = found.slice(0, CHOICES).map((o, i) => {
        const li = el("li", "om-account-map-choice");
        li.id = `${id}-choice-${i}`;
        li.setAttribute("role", "option");
        li.dataset.index = String(i);
        li.setAttribute("aria-selected", String(i === active));
        li.append(el("span", "om-account-map-name", o.label), el("code", "", o.a.account_id));
        if (o.a.account_id === suggested) li.append(el("span", "badge accent", "Suggested"));
        return li;
      });
      const more = !found.length ? "No open account matches." : found.length > CHOICES ? `Showing ${count(CHOICES)} of ${count(found.length)}: type to narrow.` : "";
      if (more) {
        const li = el("li", "om-account-map-more", more);
        li.setAttribute("role", "presentation");
        items.push(li);
      }
      list.replaceChildren(...items);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (active >= 0) input.setAttribute("aria-activedescendant", `${id}-choice-${active}`);
      else input.removeAttribute("aria-activedescendant");
    };
    const redraw = () => {
      if (frame !== null) return;
      const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
      frame = raf(() => {
        frame = null;
        draw();
      });
    };
    input.addEventListener("input", () => {
      if (input.value !== label) {
        chosen.value = "";
        say.textContent = "";
        label = "";
      }
      active = 0;
      redraw();
    });
    input.addEventListener("click", () => {
      active = -1;
      draw();
    });
    input.addEventListener("blur", () => hide());
    input.addEventListener("keydown", (e) => {
      const n = Math.min(found.length, CHOICES);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) draw();
        if (n) active = (active + 1) % n;
        draw();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (n) active = (active - 1 + n) % n;
        draw();
      } else if (e.key === "Enter" && !list.hidden && active >= 0 && active < n) {
        e.preventDefault();
        choose(found[active]);
      } else if (e.key === "Escape" && !list.hidden) {
        e.preventDefault();
        hide();
      }
    });
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const li = e.target.closest?.("[data-index]");
      if (li) choose(found[Number(li.dataset.index)]);
    });
    // Opened from a suggestion, the suggestion is chosen to start.
    const start = open.find((o) => o.a.account_id === suggested);
    if (start) {
      chosen.value = start.a.account_id;
      label = start.label;
      input.value = start.label;
      say.textContent = `Chosen: ${start.label}, ${start.a.account_id} (suggested: ${r.suggestion.why}).`;
    }

    const labelled = el("label", "field om-account-map-chooser");
    labelled.htmlFor = input.id;
    labelled.append(el("span", "", "An existing account"), input);
    // The list and what is chosen go under the field and its button, so the button stays level with the field.
    const form = this.#form(r.x, "link", [labelled, chosen], button("Link", "", "submit"));
    form.append(list, say);
    return form;
  }

  #field(control, label, extra = "") {
    const wrap = el("label", `field${extra ? ` ${extra}` : ""}`);
    wrap.htmlFor = control.id;
    wrap.append(el("span", "", label), control);
    return wrap;
  }

  /** A plain form: the page's token, what is meant, the external account, and its fields. */
  #form(external, intent, fields, submit, kind = "") {
    const form = el("form", kind);
    form.method = "post";
    const action = this.getAttribute("action");
    if (action) form.setAttribute("action", action);
    const tokenName = this.getAttribute("token-name");
    if (tokenName) form.append(hidden(tokenName, this.getAttribute("token") || ""));
    form.append(hidden("intent", intent), hidden("external_account_id", external.external_account_id));
    const shown = fields.filter((f) => !(f instanceof HTMLInputElement && f.type === "hidden"));
    form.append(...fields.filter((f) => !shown.includes(f)));
    if (shown.length) {
      const row = el("div", "field-row");
      row.append(...shown, submit);
      form.append(row);
    } else {
      form.append(submit);
    }
    return form;
  }

  // ── Several links, reviewed ──────────────────────────────────────────────

  #drawReview(suggested) {
    const p = this.#parts;
    const key = suggested.map((r) => r.x.external_account_id).join("\n");
    if (!p.review.hidden && p.review.dataset.key === key) return;
    p.review.dataset.key = key;
    p.review.hidden = false;

    const form = el("form", "om-account-map-several-form");
    form.method = "post";
    const action = this.getAttribute("action");
    if (action) form.setAttribute("action", action);
    const tokenName = this.getAttribute("token-name");
    if (tokenName) form.append(hidden(tokenName, this.getAttribute("token") || ""));
    form.append(hidden("intent", "link-several"));

    const heading = el("h3", "", `Link ${plural(suggested.length, "account")}, each to the account suggested for it`);
    heading.id = `${this.#id}-review-title`;
    form.setAttribute("aria-labelledby", heading.id);
    const intro = el("p", "muted", "Clear any you do not want linked. Each is sent as its own link, and the answer says how each went.");
    const list = el("ul", "om-account-map-pairs");
    const submit = button("", "primary", "submit");
    const recount = () => {
      const n = list.querySelectorAll("input[type=checkbox]:checked").length;
      submit.textContent = `Link ${plural(n, "account")}`;
      submit.disabled = n === 0;
    };
    for (const r of suggested) {
      const li = el("li");
      const check = el("input");
      check.type = "checkbox";
      check.checked = true;
      const pair = [hidden("external_account_id", r.x.external_account_id), hidden("account_id", r.suggestion.account.account_id)];
      check.addEventListener("change", () => {
        for (const h of pair) h.disabled = !check.checked;
        recount();
      });
      const label = el("label", "check");
      const what = el("span");
      what.append(
        el("span", "title", r.x.name || r.x.external_account_id),
        el("span", "muted", " to "),
        el("span", "title", described(r.suggestion.account)),
        el("span", "hint", `${r.suggestion.why} · ${r.x.external_account_id} to ${r.suggestion.account.account_id}`),
      );
      label.append(check, what);
      li.append(label, ...pair);
      list.append(li);
    }
    const cancel = button("Cancel");
    cancel.addEventListener("click", () => {
      this.#reviewing = false;
      this.#draw();
      p.several.focus();
    });
    const actions = el("div", "row");
    actions.append(submit, cancel);
    form.append(heading, intro, list, actions);
    recount();
    p.review.replaceChildren(form);
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  #submitted(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !this.contains(form)) return;
    const sent = new FormData(form);
    const field = (name) => text(sent.get(name));
    const intent = field("intent");
    // A link needs its account: the chooser's is chosen from the list, not typed.
    if (intent === "link" && !field("account_id")) {
      event.preventDefault();
      const pick = form.querySelector("[role=combobox]");
      if (pick) {
        pick.setAttribute("aria-invalid", "true");
        const say = form.querySelector(".om-account-map-chosen");
        if (say) say.textContent = "Choose an account from the list.";
        pick.focus();
      }
      return;
    }
    const detail = {
      intent,
      external_account_id: intent === "link-several" ? "" : field("external_account_id"),
      account_id: intent === "link-several" ? "" : field("account_id"),
      new_account_name: field("new_account_name"),
      new_account_custodian: field("new_account_custodian"),
      new_account_type: field("new_account_type"),
      form,
    };
    if (intent === "link-several") {
      const externals = sent.getAll("external_account_id").map(text);
      const accounts = sent.getAll("account_id").map(text);
      detail.pairs = externals.map((external_account_id, i) => ({ external_account_id, account_id: accounts[i] || "" }));
    }
    const go = this.dispatchEvent(new CustomEvent("om-link", { bubbles: true, cancelable: true, detail }));
    if (!go) event.preventDefault();
  }
}

if (!customElements.get("om-account-map")) customElements.define("om-account-map", OmAccountMap);
