// The gallery: frames the sample page as the dashboard would, and shows the
// scheme contract with each shipped scheme's ratios.

import { checkScheme } from "../lib/contrast.js";
import { parseSchemeCss } from "../lib/scheme.js";

await Promise.all(["om-grid"].map((n) => customElements.whenDefined(n)));

const contract = await (await fetch("scheme-contract.json")).json();
const schemes = contract.schemes;
const select = document.getElementById("scheme");
const layout = document.getElementById("layout");
const frames = document.getElementById("frames");
const sent = document.getElementById("sent");

for (const s of schemes) select.add(new Option(`${s.name} (${s.id})`, s.id));
const start = new URLSearchParams(location.search);
if (schemes.some((s) => s.id === start.get("scheme"))) select.value = start.get("scheme");
if (start.get("layout")) layout.value = start.get("layout");

function modes() {
  return layout.value === "both" ? ["light", "dark"] : [layout.value];
}

function build() {
  frames.replaceChildren();
  frames.classList.toggle("one", modes().length === 1);
  for (const mode of modes()) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.innerHTML = `<strong>${mode[0].toUpperCase()}${mode.slice(1)}</strong><span class="faint">?om-scheme=${select.value}&amp;om-mode=${mode}</span>`;
    const frame = document.createElement("iframe");
    frame.title = `Sample page, ${mode}`;
    frame.dataset.mode = mode;
    frame.src = `gallery/sample.html?om-scheme=${encodeURIComponent(select.value)}&om-mode=${mode}`;
    frame.addEventListener("load", () => fit(frame));
    fig.append(cap, frame);
    frames.append(fig);
  }
  sent.textContent = "Frames loaded with query parameters.";
}

function fit(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const size = () => {
    frame.style.height = `${doc.documentElement.scrollHeight + 4}px`;
  };
  size();
  new ResizeObserver(size).observe(doc.body);
}

// A scheme change is the frame's theme message, as the dashboard sends it.
select.addEventListener("change", () => {
  for (const frame of frames.querySelectorAll("iframe")) {
    frame.previousElementSibling.querySelector(".faint").textContent = `then the message: scheme "${select.value}", mode "${frame.dataset.mode}"`;
    frame.contentWindow.postMessage(
      { type: "meridian:theme", version: 1, scheme: select.value, mode: frame.dataset.mode },
      location.origin,
    );
  }
  sent.textContent = `Sent { type: "meridian:theme", scheme: "${select.value}" } to each frame.`;
});
layout.addEventListener("change", build);
build();

// The contract, with every shipped scheme's ratio for every pair.
const parsed = {};
for (const s of schemes) {
  const css = await (await fetch(`schemes/${s.id}.css`)).text();
  parsed[s.id] = parseSchemeCss(css).scheme;
}
const results = Object.fromEntries(schemes.map((s) => [s.id, checkScheme(parsed[s.id], contract).results]));

const pairColumns = [
  { key: "pair", label: "Pair", type: "code" },
  { key: "kind", label: "Kind" },
  { key: "min", label: "At least", type: "decimal" },
];
for (const s of schemes) {
  for (const mode of contract.modes) {
    pairColumns.push({
      key: `${s.id}-${mode}`,
      label: `${s.id} ${mode}`,
      type: "decimal",
      format: (v) => {
        const span = document.createElement("span");
        span.className = v && v.pass ? "good-ink" : "bad-ink";
        span.textContent = v ? `${v.ratio.toFixed(2)}${v.pass ? "" : " ✕"}` : "";
        return span;
      },
      compare: (a, b) => a.ratio - b.ratio,
    });
  }
}
const pairs = document.getElementById("pairs");
pairs.columns = pairColumns;
pairs.setRows(
  contract.pairs.map((p, i) => {
    const row = { id: String(i), pair: `--${p.fg} on --${p.bg}`, kind: p.kind, min: String(contract.thresholds[p.kind]) };
    for (const s of schemes) {
      for (const mode of contract.modes) {
        row[`${s.id}-${mode}`] = results[s.id].find((r) => r.mode === mode && r.fg === p.fg && r.bg === p.bg && r.kind === p.kind);
      }
    }
    return row;
  }),
);

const swatch = (value) => {
  const wrap = document.createElement("span");
  wrap.className = "row";
  wrap.style.gap = ".4rem";
  const sw = document.createElement("span");
  sw.className = "swatch";
  sw.style.background = value;
  const code = document.createElement("code");
  code.textContent = value;
  wrap.append(sw, code);
  return wrap;
};
const propColumns = [
  { key: "name", label: "Property", type: "code", format: (v) => `--${v}` },
  { key: "group", label: "Group" },
  { key: "meaning", label: "Meaning", sortable: false },
];
for (const s of schemes) {
  for (const mode of contract.modes) {
    propColumns.push({ key: `${s.id}-${mode}`, label: `${s.id} ${mode}`, sortable: false, format: (v) => (v ? swatch(v) : "") });
  }
}
const props = document.getElementById("props");
props.columns = propColumns;
props.setRows(
  contract.properties.map((p) => {
    const row = { name: p.name, group: p.group, meaning: p.meaning };
    for (const s of schemes) for (const mode of contract.modes) row[`${s.id}-${mode}`] = parsed[s.id][mode][p.name];
    return row;
  }),
);
