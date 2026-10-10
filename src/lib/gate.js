// Fields gated on a choice (0.11.0; meridian-design tasks/design/every-page-
// fits-one-screen.md, the product owner's preferences of 2026-10-10:
// "conditional field display gated on selection to guide user behavior").
// A form shows the fields its current choice needs: choose the kind, and the
// kind's fields appear.
//
//   <label class="field" data-om-applies-when="key_type" data-om-one-of='["commercial"]'>
//     <span>Client ID</span><input name="client_id" required>
//   </label>
//
// An element marked `data-om-applies-when` names a choice, a control's
// `name` in the same form (a select, a set of radios, a checkbox, any
// input), and `data-om-one-of` the values it applies at: a JSON list of
// strings, or one value as it is. It is shown while the choice holds one of
// them, and otherwise hidden with every control inside it disabled, so a
// field gated off is neither required nor sent. A checkbox holds its value
// (`on` when it gives none) while checked, and nothing while not. A choice
// that is itself gated off holds nothing, so what hangs on it goes too.
//
// The idea is core's Settings form's (crates/dashboard/src/admin/settings.rs,
// a declared setting's `applies_when`), taken into the kit so every form can
// use it. Without the kit's script every field shows and posts, so the server
// ignores a field its choice does not need. It runs on the kit's script
// loading, on a choice's input, on every change, and after a form's reset; a
// page that sets a choice from script, or draws a form later, dispatches a
// `change` event on it.

export const GATE = "data-om-applies-when";
export const VALUES = "data-om-one-of";
const CONTROLS = "input, select, textarea, button, fieldset";

// Controls this gating disabled, apart from those the page disabled itself.
const gatedOff = new WeakSet();

/** The values a gate applies at: a JSON list of strings, or the attribute as one value. */
export function valuesOf(gate) {
  const raw = gate.getAttribute(VALUES) ?? "";
  if (raw.trim().startsWith("[")) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.map(String);
    } catch {
      // Not JSON after all: the attribute is the one value.
    }
  }
  return [raw];
}

/** What the choice named `name` holds, in the gate's form (or its document). */
export function chosen(gate, name) {
  const form = gate.closest("form");
  const controls = form
    ? [...form.elements].filter((c) => c.name === name)
    : [...gate.ownerDocument.querySelectorAll("[name]")].filter((c) => c.getAttribute("name") === name);
  const held = [];
  for (const c of controls) {
    // A choice inside the gate it governs would hold it open: never counted.
    if (c.disabled || gate.contains(c)) continue;
    if (c.type === "checkbox" || c.type === "radio") {
      if (c.checked) held.push(c.value || "on");
    } else if (c.localName === "select") {
      for (const o of c.options) if (o.selected) held.push(o.value);
    } else if (c.type !== "button" && c.type !== "submit" && c.type !== "reset") {
      held.push(c.value);
    }
  }
  return held;
}

function show(gate, on) {
  gate.hidden = !on;
  const inside = gate.matches(CONTROLS) ? [gate, ...gate.querySelectorAll(CONTROLS)] : [...gate.querySelectorAll(CONTROLS)];
  for (const c of inside) {
    if (!on) {
      if (!c.disabled) {
        c.disabled = true;
        gatedOff.add(c);
      }
    } else if (gatedOff.has(c)) {
      // Another gate around it, still shut, keeps it off.
      if (c.parentElement && c.parentElement.closest(`[${GATE}][hidden]`)) continue;
      c.disabled = false;
      gatedOff.delete(c);
    }
  }
}

/** Show each gated element whose choice holds one of its values, and hide
 * the rest, until nothing changes (a gate may hang on a gated choice). */
export function applyGates(root = document) {
  const gates = [...root.querySelectorAll(`[${GATE}]`)];
  for (let pass = 0; pass <= gates.length; pass++) {
    let changed = false;
    for (const gate of gates) {
      const name = gate.getAttribute(GATE);
      if (!name) continue;
      const want = valuesOf(gate);
      const on = chosen(gate, name).some((v) => want.includes(v));
      if (gate.hidden === on) {
        show(gate, on);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return new Set(gates.map((g) => g.getAttribute(GATE)));
}

/** Gate the document's forms. Idempotent: a document is wired once. */
export function wireGates(doc = document) {
  if (!doc || doc.__omGates) return;
  doc.__omGates = true;
  // The choices a gate names, as of the last look: a key typed into any
  // other field (an entry grid's thousand rows) costs nothing more.
  let names = new Set();
  const look = () => {
    names = applyGates(doc);
  };
  doc.addEventListener("input", (e) => {
    if (names.has(e.target && e.target.name)) look();
  });
  // A value committed, or a form drawn later and told so: look again.
  doc.addEventListener("change", look);
  // A form's reset puts its values back after the event: gate them then.
  doc.addEventListener("reset", () => setTimeout(look, 0));
  const first = look;
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", first, { once: true });
  else first();
}

if (typeof document !== "undefined") wireGates(document);
