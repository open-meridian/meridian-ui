// Finding instruments on the page's own server: what om-instrument-picker
// and om-entry-grid's instrument column (0.12.0) both ask, and how both name
// what comes back. The request and the answer are the README's
// (om-instrument-picker):
//
//   GET <src>?q=<text>&limit=<n>[&as_of=YYYY-MM-DD]      Accept: application/json
//   200 { "results": [ { "instrument_id": "INS-…", "description": "…", "identifiers": [ … ], … } ] }
//
// It never lists every record: it asks for the few that match what was typed.

import { sameOrigin } from "./url.js";

/** The matches for `q` at `src` (on the page's origin, or this throws), at
 * most `limit`, each with an `instrument_id`. Throws an Error saying what
 * went wrong: another origin, a status other than 200, an answer without a
 * results list. An aborted `signal` throws its AbortError. */
export async function findInstruments(src, q, { limit = 10, asOf = "", signal } = {}) {
  const url = sameOrigin(src || "");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  if (asOf) url.searchParams.set("as_of", asOf);
  const res = await globalThis.fetch(url.href, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) throw new Error(`the search answered ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.results)) throw new Error("the search's answer has no results list");
  return body.results.filter((r) => r && typeof r.instrument_id === "string" && r.instrument_id);
}

/** An instrument's identifiers on one line (`ticker:AAPL  isin:…`) and what
 * it is (`equity · USD · XNAS`). */
export function describeInstrument(inst) {
  const ids = (inst.identifiers || []).map((i) => `${i.scheme}:${i.value}`).join("  ");
  const meta = [inst.asset_class, inst.currency, inst.exchange_mic].filter(Boolean).join(" · ");
  return { ids, meta };
}

/** What a person reads for a chosen instrument: its name, and its first
 * identifier's value in brackets (`Apple Inc. common stock (AAPL)`). */
export function instrumentLabel(inst) {
  const first = (inst.identifiers || [])[0];
  return `${inst.description || inst.instrument_id}${first ? ` (${first.value})` : ""}`;
}

/** One option of a list of matches, as both components draw it: the name,
 * what it is, and the ID with its identifiers. */
export function instrumentOption(inst, id, selected) {
  const li = document.createElement("li");
  li.id = id;
  li.className = "om-picker-option";
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", String(selected));
  const { ids, meta } = describeInstrument(inst);
  const name = document.createElement("span");
  name.className = "om-picker-name";
  name.textContent = inst.description || inst.instrument_id;
  const m = document.createElement("span");
  m.className = "om-picker-meta";
  m.textContent = meta;
  const idl = document.createElement("span");
  idl.className = "om-picker-ids";
  idl.textContent = `${inst.instrument_id}${ids ? `  ${ids}` : ""}`;
  li.append(name, m, idl);
  return li;
}

/** A status line in a list of matches ("Searching…", "No instrument matches."). */
export function instrumentStatus(text, bad = false) {
  const li = document.createElement("li");
  li.className = `om-picker-status${bad ? " bad" : ""}`;
  li.setAttribute("role", "presentation");
  li.textContent = text;
  return li;
}
