// Finding instruments on the page's own server: what om-instrument-picker
// and om-entry-grid's instrument column (0.12.0) both ask, and how both name
// what comes back. The request and the answer are the README's
// (om-instrument-picker):
//
//   GET <src>?q=<text>&limit=<n>[&as_of=YYYY-MM-DD]      Accept: application/json
//   200 { "results": [ { "instrument_id": "INS-…", "description": "…", "identifiers": [ … ], … } ] }
//
// It never lists every record: it asks for the few that match what was typed.
//
// 0.14.0: a page that can bring in an instrument it does not hold yet marks
// such a result `"candidate": true`, with an empty `instrument_id`; only a
// picker with a bring-in hook asks for them (`candidates`), and
// bringInstrumentIn is the hook's default, a POST to the page's own server.

import { sameOrigin } from "./url.js";

/** The matches for `q` at `src` (on the page's origin, or this throws), at
 * most `limit`, each with an `instrument_id` -- or, with `candidates`, marked
 * `candidate: true` instead (0.14.0). Throws an Error saying what went wrong:
 * another origin, a status other than 200, an answer without a results list.
 * An aborted `signal` throws its AbortError. */
export async function findInstruments(src, q, { limit = 10, asOf = "", signal, candidates = false } = {}) {
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
  return body.results.filter((r) => r && (isHeld(r) || (candidates && isCandidate(r))));
}

function isHeld(r) {
  return typeof r.instrument_id === "string" && r.instrument_id !== "";
}

/** Whether a search's result is one the page does not hold yet (0.14.0). */
export function isCandidate(r) {
  return !!r && r.candidate === true && !isHeld(r);
}

/** Bring a candidate in at `url` (on the page's origin, or this throws): the
 * picker's default bring-in hook (0.14.0). It POSTs `{ "candidate": … }` as
 * the search answered it and resolves to the instrument the page now holds,
 * `{ "instrument": { "instrument_id": …, … } }`'s. Throws an Error saying
 * why not: the answer's `error`, or its status; an answer naming no held
 * instrument. An aborted `signal` throws its AbortError. */
export async function bringInstrumentIn(url, candidate, { signal } = {}) {
  const to = sameOrigin(url || "");
  const res = await globalThis.fetch(to.href, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ candidate }),
    signal,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error((body && typeof body.error === "string" && body.error) || `bringing it in answered ${res.status}`);
  const held = body && body.instrument;
  if (!held || !isHeld(held)) throw new Error("bringing it in answered no instrument");
  return held;
}

/** An instrument's identifiers on one line (`ticker:AAPL  isin:…`) and what
 * it is (`equity · USD · XNAS`). */
export function describeInstrument(inst) {
  const ids = (inst.identifiers || []).map((i) => `${i.scheme}:${i.value}`).join("  ");
  const meta = [inst.asset_class, inst.currency, inst.exchange_mic].filter(Boolean).join(" · ");
  return { ids, meta };
}

/** What a person reads for a chosen instrument (0.15.0): its name, and in
 * brackets its ticker -- else its first identifier's value -- with its
 * exchange's MIC where known (`Apple Inc. (AAPL · XNAS)`,
 * `SPDR S&P 500 ETF Trust (SPY)`). Never the record's ID: a record with no
 * name is named by its ticker. */
export function instrumentLabel(inst) {
  const ids = (inst && inst.identifiers) || [];
  const ticker = ids.find((i) => i && i.scheme === "ticker" && i.value);
  const code = (ticker || ids.find((i) => i && i.value) || {}).value || "";
  const mic = /^[A-Z0-9]{4}$/.test(inst.exchange_mic || "") ? inst.exchange_mic : ticker && /^[A-Z0-9]{4}$/.test(ticker.source || "") ? ticker.source : "";
  const name = (inst.description || "").trim() || code || "An instrument";
  const bracket = [name === code ? "" : code, mic].filter(Boolean).join(" · ");
  return bracket ? `${name} (${bracket})` : name;
}

/** One option of a list of matches, as both components draw it: the name,
 * what it is, and the ID with its identifiers. Without `ids` (a picker that
 * brings candidates in, 0.14.0) the record's ID is left out, so a record the
 * page holds and one it does not read alike. */
export function instrumentOption(inst, id, selected, { ids: showId = true } = {}) {
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
  idl.textContent = showId ? `${inst.instrument_id}${ids ? `  ${ids}` : ""}` : ids;
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
