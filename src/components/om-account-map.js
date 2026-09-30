// <om-account-map>: a plugin links each external account it reads to one of
// the deployment's accounts (meridian-design W6.4), on its admin page.
//
//   <om-account-map action="/admin/accounts/link" token-name="csrf" token="…">
//     <script type="application/json">
//       { "external_accounts": [{ "external_account_id": "…", "name": "…", "detail": "…",
//                                 "custodian": "…", "account_type": "…", "note": "…" }],
//         "accounts": [{ "account_id": "…", "name": "…", "custodian": "…", "account_type": "…", "open": true }],
//         "links":    [{ "external_account_id": "…", "account_id": "…", "account_name": "…" }] }
//     </script>
//   </om-account-map>
//
// Each external account is shown beside the deployment's account it is
// linked to (from `links`, the SDK's AccountScope.links as they are), or as
// not linked; there is no third state. Each row offers a picker of the
// deployment's open accounts, a new account (named from the external one,
// with its custodian and type, each editable), and Unlink.
//
// Every action is a plain form, posted to `action` with the page's token in
// the hidden field `token-name` names, and fields named as the SDK's
// link_external_account takes them: `external_account_id`, and `account_id`
// to link an existing account, or `new_account_name`, `new_account_custodian`
// and `new_account_type` to create one, or neither to unlink; `intent` says
// which (`link`, `create`, `unlink`). A page with script hears `om-link`
// first, and may cancel it to send the link itself.

import { declaredJson, whenParsed } from "../lib/declared.js";

let instances = 0;

const text = (v) => (v === undefined || v === null ? "" : String(v));

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function option(value, label) {
  const o = el("option", "", label);
  o.value = value;
  return o;
}

function hidden(name, value) {
  const input = el("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

/** The page's data, held to its shape: anything else is left out, never guessed. */
function normalise(data) {
  const d = data && typeof data === "object" ? data : {};
  const externals = (Array.isArray(d.external_accounts) ? d.external_accounts : [])
    .filter((x) => x && typeof x === "object" && text(x.external_account_id))
    .map((x) => ({
      external_account_id: text(x.external_account_id),
      name: text(x.name),
      detail: text(x.detail),
      custodian: text(x.custodian),
      account_type: text(x.account_type),
      note: text(x.note),
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

export class OmAccountMap extends HTMLElement {
  static get observedAttributes() {
    return ["action", "token", "token-name", "empty"];
  }

  #data = normalise(null);
  #dataSet = false;
  #built = false;
  #waiting = false;
  #id = `om-account-map-${++instances}`;

  connectedCallback() {
    if (this.#built || this.#waiting) return;
    this.#waiting = true;
    whenParsed(() => {
      this.#waiting = false;
      if (this.#built || !this.isConnected) return;
      if (!this.#dataSet) {
        const declared = declaredJson(this);
        if (declared) this.#data = normalise(declared);
      }
      this.#built = true;
      this.addEventListener("submit", (e) => this.#submitted(e));
      this.#render();
    });
  }

  attributeChangedCallback() {
    if (this.#built) this.#render();
  }

  /** `{ external_accounts, accounts, links }`, as the declared JSON carries it. */
  get data() {
    return structuredClone(this.#data);
  }

  set data(value) {
    this.#dataSet = true;
    this.#data = normalise(value);
    if (this.#built) this.#render();
  }

  /** The link standing for an external account, or null: linked or not, never unknown. */
  linkOf(externalAccountId) {
    const link = this.#data.links.find((l) => l.external_account_id === String(externalAccountId));
    return link ? { ...link } : null;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  #render() {
    const { external_accounts: externals } = this.#data;
    if (!externals.length) {
      const empty = el("div", "om-account-map-empty", this.getAttribute("empty") || "No external accounts yet.");
      this.replaceChildren(empty);
      return;
    }
    const head = el("div", "om-account-map-head");
    head.setAttribute("aria-hidden", "true");
    head.append(el("span", "label", "External account"), el("span", "label", "Deployment account"));
    this.replaceChildren(head, ...externals.map((x, i) => this.#row(x, i)));
  }

  #row(external, index) {
    const id = `${this.#id}-${index}`;
    const link = this.linkOf(external.external_account_id);
    const row = el("div", "om-account-map-row");
    row.dataset.external = external.external_account_id;
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", `${id}-title`);

    const left = el("div", "om-account-map-external");
    const title = el("div", "row");
    const name = el("span", "title", external.name || external.external_account_id);
    name.id = `${id}-title`;
    const badge = el("span", link ? "badge good" : "badge warn", link ? "Linked" : "Not linked");
    title.append(name, badge);
    left.append(title);
    if (external.detail) left.append(el("div", "meta", external.detail));
    const code = el("div", "meta");
    code.append(el("code", "", external.external_account_id));
    left.append(code);
    if (external.note) left.append(el("span", "hint", external.note));

    const right = el("div", "om-account-map-link");
    if (link) {
      const linked = el("div", "om-account-map-linked");
      const to = el("div");
      const account = (this.#data.accounts || []).find((a) => a.account_id === link.account_id);
      const said = el("div");
      said.append(el("span", "muted", "Linked to "), el("span", "title", link.account_name || account?.name || link.account_id));
      to.append(said);
      const more = account ? [account.custodian, account.account_type].filter(Boolean).join(" · ") : "";
      const where = el("div", "meta");
      where.append(el("code", "", link.account_id));
      if (more) where.prepend(`${more} · `);
      to.append(where);
      linked.append(to, this.#form(external, id, "unlink", [], el("button", "danger", "Unlink")));
      const change = el("details", "om-account-map-change");
      change.append(el("summary", "", "Link to another account"), ...this.#linking(external, id, link.account_id));
      right.append(linked, change);
    } else {
      right.append(...this.#linking(external, id, ""));
    }
    row.append(left, right);
    return row;
  }

  /** The picker of open accounts, and the new account, for one external account. */
  #linking(external, id, current) {
    const accounts = this.#data.accounts;
    const open = (accounts || []).filter((a) => a.open && a.account_id !== current);
    const parts = [];
    if (accounts === null) {
      parts.push(el("p", "hint", "The deployment's accounts could not be read, so none is offered here."));
    } else if (!open.length) {
      parts.push(el("p", "hint", current ? "The deployment has no other open account: create one." : "The deployment has no open accounts yet: create one."));
    } else {
      const select = el("select");
      select.name = "account_id";
      select.required = true;
      select.id = `${id}-pick${current ? "-again" : ""}`;
      select.append(option("", "Choose an account"), ...open.map((a) => option(a.account_id, described(a))));
      const button = el("button", "", "Link");
      parts.push(this.#form(external, id, "link", [this.#field(select, "An existing account")], button));
      parts.push(el("div", "om-account-map-or", "or"));
    }
    const field = (name, label, value, required) => {
      const input = el("input");
      input.type = "text";
      input.name = name;
      input.value = value;
      input.required = required;
      input.id = `${id}-${name}${current ? "-again" : ""}`;
      input.autocomplete = "off";
      return this.#field(input, label, name === "new_account_name" ? "om-account-map-name" : "");
    };
    parts.push(
      this.#form(
        external,
        id,
        "create",
        [
          field("new_account_name", "A new account", external.name || external.external_account_id, true),
          field("new_account_custodian", "Custodian", external.custodian, false),
          field("new_account_type", "Type", external.account_type, false),
        ],
        el("button", "primary", "Create and link"),
      ),
    );
    return parts;
  }

  #field(control, label, extra = "") {
    const wrap = el("label", `field${extra ? ` ${extra}` : ""}`);
    wrap.htmlFor = control.id;
    wrap.append(el("span", "", label), control);
    return wrap;
  }

  /** A plain form: the page's token, what is meant, the external account, and its fields. */
  #form(external, id, intent, fields, button) {
    const form = el("form", intent === "unlink" ? "inline" : "");
    form.method = "post";
    const action = this.getAttribute("action");
    if (action) form.setAttribute("action", action);
    const tokenName = this.getAttribute("token-name");
    if (tokenName) form.append(hidden(tokenName, this.getAttribute("token") || ""));
    form.append(hidden("intent", intent), hidden("external_account_id", external.external_account_id));
    button.type = "submit";
    button.setAttribute("aria-describedby", `${id}-title`);
    if (fields.length) {
      const row = el("div", "field-row");
      row.append(...fields, button);
      form.append(row);
    } else {
      form.append(button);
    }
    return form;
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  #submitted(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !this.contains(form)) return;
    const sent = new FormData(form);
    const field = (name) => text(sent.get(name));
    const detail = {
      intent: field("intent"),
      external_account_id: field("external_account_id"),
      account_id: field("account_id"),
      new_account_name: field("new_account_name"),
      new_account_custodian: field("new_account_custodian"),
      new_account_type: field("new_account_type"),
      form,
    };
    const go = this.dispatchEvent(new CustomEvent("om-link", { bubbles: true, cancelable: true, detail }));
    if (!go) event.preventDefault();
  }
}

if (!customElements.get("om-account-map")) customElements.define("om-account-map", OmAccountMap);
