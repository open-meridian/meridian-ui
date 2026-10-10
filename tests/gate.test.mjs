// Fields gated on a choice (0.11.0; the product owner's preferences of
// 2026-10-10, meridian-design tasks/design/every-page-fits-one-screen.md):
// an element marked data-om-applies-when shows while the choice it names
// holds one of data-om-one-of's values, and otherwise is hidden with its
// controls disabled, so it is neither required nor sent. Core's Settings
// form's applies_when, taken into the kit (lib/gate.js).

import "./dom.mjs";
import "../src/components/index.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { put, read, settle } from "./helpers.mjs";
import { applyGates, valuesOf } from "../src/lib/gate.js";

afterEach(() => document.body.replaceChildren());

const $ = (id) => document.getElementById(id);
const sent = (form) => [...new FormData(form)].map(([k, v]) => `${k}=${v}`);
const choose = (el) => {
  if (el.type === "radio" || el.type === "checkbox") el.checked = !el.checked || el.type === "radio";
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

const KEY_FORM = `<form id="f" method="post" action="/settings">
  <input type="hidden" name="csrf" value="t">
  <fieldset class="choice"><legend>Key</legend><div class="options">
    <label class="option"><input type="radio" name="key_type" value="personal" id="personal" checked><span>Personal</span></label>
    <label class="option"><input type="radio" name="key_type" value="commercial" id="commercial"><span>Commercial</span></label>
  </div></fieldset>
  <label class="field" id="gate" data-om-applies-when="key_type" data-om-one-of='["commercial"]'><span>Client ID</span><input name="client_id" id="client" required></label>
  <button class="primary">Save</button>
</form>`;

test("the values a gate applies at: a JSON list, or the attribute as one value", () => {
  put(`<div id="a" data-om-one-of='["a", "b"]'></div><div id="b" data-om-one-of="commercial"></div><div id="c" data-om-one-of="[not json"></div><div id="d"></div>`);
  assert.deepEqual(valuesOf($("a")), ["a", "b"]);
  assert.deepEqual(valuesOf($("b")), ["commercial"]);
  assert.deepEqual(valuesOf($("c")), ["[not json"]);
  assert.deepEqual(valuesOf($("d")), [""], "no values: it applies while nothing is chosen");
});

test("a field gated on a radio: hidden and not sent until its choice is made, then shown and required", () => {
  put(KEY_FORM);
  applyGates();
  const form = $("f");
  assert.equal($("gate").hidden, true, "Personal chosen: no client ID");
  assert.equal($("client").disabled, true);
  assert.equal(form.checkValidity(), true, "a field gated off is not required");
  assert.deepEqual(sent(form), ["csrf=t", "key_type=personal"], "nor sent");
  choose($("commercial"));
  assert.equal($("gate").hidden, false, "Commercial chosen: the client ID appears");
  assert.equal($("client").disabled, false);
  assert.equal(form.checkValidity(), false, "and is required");
  $("client").value = "abc";
  assert.deepEqual(sent(form), ["csrf=t", "key_type=commercial", "client_id=abc"]);
  choose($("personal"));
  assert.equal($("gate").hidden, true);
  assert.deepEqual(sent(form), ["csrf=t", "key_type=personal"]);
});

test("gated on a select, a checkbox, and a choice that is itself gated", () => {
  put(`<form id="f">
    <select name="kind" id="kind"><option value="">Choose…</option><option value="bank">Bank</option><option value="broker">Broker</option><option value="wallet">Wallet</option></select>
    <fieldset id="money" data-om-applies-when="kind" data-om-one-of='["bank", "broker"]'>
      <input name="routing" id="routing">
      <label><input type="checkbox" name="wire" id="wire"> Wires too</label>
      <label id="swift" data-om-applies-when="wire" data-om-one-of="on"><input name="swift" id="swift-in"></label>
    </fieldset>
    <label id="chain" data-om-applies-when="kind" data-om-one-of="wallet"><input name="chain" id="chain-in"></label>
    <label id="none" data-om-applies-when="kind" data-om-one-of='[""]'><span>Choose a kind first.</span></label>
  </form>`);
  applyGates();
  assert.deepEqual([$("money").hidden, $("chain").hidden, $("none").hidden, $("swift").hidden], [true, true, false, true], "nothing chosen");
  $("kind").value = "broker";
  choose($("kind"));
  assert.deepEqual([$("money").hidden, $("chain").hidden, $("none").hidden], [false, true, true]);
  assert.equal($("swift").hidden, true, "a checkbox not checked holds nothing");
  assert.equal($("swift-in").disabled, true);
  choose($("wire"));
  assert.equal($("swift").hidden, false, "checked, it holds its value: on");
  assert.equal($("swift-in").disabled, false);
  $("kind").value = "wallet";
  choose($("kind"));
  assert.deepEqual([$("money").hidden, $("chain").hidden], [true, false]);
  assert.equal($("wire").disabled, true, "the checkbox goes with its fieldset");
  assert.equal($("swift").hidden, true, "and what hangs on it goes too");
  assert.deepEqual(sent($("f")), ["kind=wallet", "chain="]);
  $("kind").value = "bank";
  choose($("kind"));
  assert.equal($("swift").hidden, false, "back again, as it was left");
  assert.equal($("swift-in").disabled, false);
});

test("a control the page disabled stays disabled when its gate opens", () => {
  put(`<form><select name="k" id="k"><option value="a">A</option><option value="b">B</option></select>
    <div id="g" data-om-applies-when="k" data-om-one-of="b"><input name="x" id="x"><input name="y" id="y" disabled></div></form>`);
  applyGates();
  assert.equal($("g").hidden, true);
  $("k").value = "b";
  choose($("k"));
  assert.equal($("x").disabled, false);
  assert.equal($("y").disabled, true, "the page's own disabled is the page's");
});

test("outside a form, the choice is found in the document; a reset gates again", async () => {
  put(`<select name="mode" id="mode"><option value="daily">Daily</option><option value="live">Live</option></select><p id="p" data-om-applies-when="mode" data-om-one-of="live">Streams.</p>
    <form id="f"><select name="m" id="m"><option value="a" selected>A</option><option value="b">B</option></select><p id="q" data-om-applies-when="m" data-om-one-of="b">B's</p></form>`);
  applyGates();
  assert.equal($("p").hidden, true);
  $("mode").value = "live";
  choose($("mode"));
  assert.equal($("p").hidden, false);
  $("m").value = "b";
  choose($("m"));
  assert.equal($("q").hidden, false);
  $("f").reset();
  $("f").dispatchEvent(new Event("reset", { bubbles: true }));
  await settle();
  assert.equal($("q").hidden, true, "reset to A, B's field goes");
});

test("a key typed into a field no gate names looks at nothing", () => {
  put(KEY_FORM);
  applyGates();
  document.dispatchEvent(new Event("change"));
  let looked = 0;
  const protos = [Element.prototype, Document.prototype];
  const originals = protos.map((p) => p.querySelectorAll);
  for (const [i, p] of protos.entries()) {
    p.querySelectorAll = function (...a) {
      looked++;
      return originals[i].apply(this, a);
    };
  }
  try {
    $("client").dispatchEvent(new Event("input", { bubbles: true }));
    assert.equal(looked, 0, "the client ID is no gate's choice");
    $("commercial").checked = true;
    $("commercial").dispatchEvent(new Event("input", { bubbles: true }));
    assert.ok(looked > 0, "key_type is");
  } finally {
    protos.forEach((p, i) => (p.querySelectorAll = originals[i]));
  }
  assert.equal($("gate").hidden, false);
});

test("the kit loads the gating with its components", () => {
  assert.match(read("src/components/index.js"), /import "\.\.\/lib\/gate\.js";/);
});
