// The gallery: frames the sample page as the dashboard would, and shows the
// scheme contract with each shipped scheme's ratios.

import { checkScheme } from "../lib/contrast.js";
import { parseSchemeCss } from "../lib/scheme.js";

await Promise.all(["om-grid"].map((n) => customElements.whenDefined(n)));

const contract = await (await fetch("scheme-contract.json")).json();
const schemes = contract.schemes;
const select = document.getElementById("scheme");
const layout = document.getElementById("layout");
const direction = document.getElementById("direction");
const frames = document.getElementById("frames");
const framed = document.getElementById("framed-frames");
const accounts = document.getElementById("accounts");
const phone = document.getElementById("phone");
const many = document.getElementById("many");
const patterns = document.getElementById("patterns");
const sent = document.getElementById("sent");

for (const s of schemes) select.add(new Option(`${s.name} (${s.id})`, s.id));
const start = new URLSearchParams(location.search);
if (schemes.some((s) => s.id === start.get("scheme"))) select.value = start.get("scheme");
if (start.get("layout")) layout.value = start.get("layout");
if (start.get("direction")) direction.value = start.get("direction");

function modes() {
  return layout.value === "both" ? ["light", "dark"] : [layout.value];
}

/** A figure framing `page` in `mode`, with the theme as query parameters. */
function figure(title, page, mode, extra = "") {
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.innerHTML = `<strong>${title}</strong><span class="faint">?om-scheme=${select.value}&amp;om-mode=${mode}&amp;om-direction=${direction.value}</span>`;
  const frame = document.createElement("iframe");
  frame.title = `${title}: ${page}, ${mode}`;
  frame.dataset.mode = mode;
  frame.src = `gallery/${page}?${extra ? `${extra}&` : ""}om-scheme=${encodeURIComponent(select.value)}&om-mode=${mode}&om-direction=${direction.value}`;
  fig.append(cap, frame);
  return fig;
}

/** A figure at a phone's width, 390px wide. */
function phoneFigure(title, page, mode, extra = "") {
  const fig = figure(title, page, mode, extra);
  fig.classList.add("phone");
  return fig;
}

function build() {
  frames.replaceChildren();
  for (const mode of modes()) frames.append(figure(`${mode[0].toUpperCase()}${mode.slice(1)}`, "sample.html", mode));
  // The round trip: the stand-in host frames the page seamlessly, holding the
  // frame to its screen; beside it, the page as it is on its own.
  const mode = modes()[0];
  framed.replaceChildren(figure("Framed seamlessly by a host", "host.html", mode), figure("On its own", "sample.html", mode));
  // The account links page: in each mode on its own, and framed by the host;
  // then each at a phone's width.
  accounts.replaceChildren();
  for (const m of modes()) accounts.append(figure(`${m[0].toUpperCase()}${m.slice(1)}`, "accounts.html", m));
  accounts.append(figure(`Framed by the host, ${mode}`, "host.html", mode, "page=accounts.html"));
  phone.replaceChildren();
  for (const m of modes()) phone.append(phoneFigure(`390px, ${m}`, "accounts.html", m));
  for (const m of modes()) phone.append(phoneFigure(`390px, ${m}, framed`, "host.html", m, "page=accounts.html"));
  // Thousands of accounts: on its own and framed, then at a phone's width.
  many.replaceChildren(
    figure(`On its own, ${mode}`, "accounts-many.html", mode),
    figure(`Framed by the host, ${mode}`, "host.html", mode, "page=accounts-many.html"),
    phoneFigure(`390px, ${mode}`, "accounts-many.html", mode),
  );
  // The patterns: on its own, framed by the host, and at a phone's width.
  patterns.replaceChildren(
    figure(`On its own, ${mode}`, "patterns.html", mode),
    figure(`Framed by the host, ${mode}`, "host.html", mode, "page=patterns.html"),
    phoneFigure(`390px, ${mode}`, "patterns.html", mode),
  );
  sent.textContent = "Frames loaded with query parameters.";
}

// A scheme or direction change is the frame's theme message, as the dashboard sends it.
function send() {
  for (const frame of document.querySelectorAll(".frames iframe")) {
    frame.previousElementSibling.querySelector(".faint").textContent =
      `then the message: scheme "${select.value}", mode "${frame.dataset.mode}", direction "${direction.value}"`;
    frame.contentWindow.postMessage(
      { type: "meridian:theme", version: 2, scheme: select.value, mode: frame.dataset.mode, direction: direction.value },
      location.origin,
    );
  }
  sent.textContent = `Sent { type: "meridian:theme", version: 2, scheme: "${select.value}", direction: "${direction.value}" } to each frame.`;
}
select.addEventListener("change", send);
direction.addEventListener("change", send);
layout.addEventListener("change", build);
build();

// The contract, with every shipped scheme's ratio for every pair.
const parsed = {};
for (const s of schemes) {
  const css = await (await fetch(`schemes/${s.id}.css`)).text();
  parsed[s.id] = parseSchemeCss(css, contract).scheme;
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
        row[`${s.id}-${mode}`] = results[s.id].find((r) => r.mode === mode && r.fg === p.fg && r.bg === p.bg && r.kind === p.kind && r.convention === contract.direction.default);
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
