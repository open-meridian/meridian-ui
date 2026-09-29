// <om-chart>: line and bar charts of time series, drawn as SVG with no
// library. Colours are the scheme's (a series names one: accent, violet,
// warn, buy, sell, good, danger, soft), so a chart follows the theme with no
// code.
//
//   <om-chart type="line" height="240" label="Net asset value"></om-chart>
//   chart.series = [{ name: "NAV", color: "accent",
//                     points: [["2026-09-01", "1204.50"], ["2026-09-02", "1210.25"]] }];
//
// A point is [time, value] or { t, v }. A time is "YYYY-MM-DD", an ISO
// date-time or epoch milliseconds; a value is a number or a decimal string.
// Values are placed on the axis as numbers (a pixel is not money), and the
// tooltip shows each value exactly as given.

const NS = "http://www.w3.org/2000/svg";
const PALETTE = ["accent", "violet", "warn", "buy", "sell", "soft"];
const COLOURS = new Set(["accent", "violet", "warn", "buy", "sell", "good", "danger", "soft"]);
const PAD = { top: 12, right: 12, bottom: 26, left: 58 };

export function parseTime(t) {
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t === "string") {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
    const ms = Date.parse(t);
    if (!Number.isNaN(ms)) return ms;
  }
  return NaN;
}

/** Round, evenly spaced ticks covering [lo, hi]. */
export function niceTicks(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const d = Math.abs(lo) || 1;
    lo -= d / 2;
    hi += d / 2;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < hi) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

function tickLabel(v, ticks) {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const abs = Math.max(...ticks.map(Math.abs));
  if (abs >= 1e9) return `${+(v / 1e9).toFixed(step >= 1e9 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${+(v / 1e6).toFixed(step >= 1e6 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${+(v / 1e3).toFixed(step >= 1e3 ? 0 : 1)}k`;
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

export class OmChart extends HTMLElement {
  static get observedAttributes() {
    return ["type", "height", "label"];
  }

  #series = [];
  #observer = null;
  #width = 0;

  connectedCallback() {
    if (!this.#observer && globalThis.ResizeObserver) {
      this.#observer = new ResizeObserver(() => {
        if (Math.round(this.clientWidth) !== this.#width) this.render();
      });
      this.#observer.observe(this);
    }
    this.render();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  get series() {
    return this.#series;
  }

  set series(value) {
    this.#series = (value || []).map((s, i) => ({
      name: s.name ?? `Series ${i + 1}`,
      color: COLOURS.has(s.color) ? s.color : PALETTE[i % PALETTE.length],
      points: (s.points || [])
        .map((p) => (Array.isArray(p) ? { t: p[0], v: p[1] } : p))
        .map((p) => ({ t: parseTime(p.t), v: Number(p.v), shown: p.v }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t),
    }));
    if (this.isConnected) this.render();
  }

  get type() {
    return this.getAttribute("type") === "bar" ? "bar" : "line";
  }

  render() {
    const width = Math.round(this.clientWidth) || 640;
    this.#width = Math.round(this.clientWidth);
    const height = Math.max(80, parseInt(this.getAttribute("height") || "240", 10) || 240);
    const series = this.#series;
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img" });
    svg.setAttribute("aria-label", this.getAttribute("label") || `Chart of ${series.map((s) => s.name).join(", ") || "nothing"}`);

    const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
    const values = series.flatMap((s) => s.points.map((p) => p.v));
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;

    if (!times.length) {
      const t = el("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "om-tick" }, svg);
      t.textContent = "No data";
      this.replaceChildren(svg);
      return;
    }

    const bar = this.type === "bar";
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (bar) {
      lo = Math.min(0, lo);
      hi = Math.max(0, hi);
    }
    const ticks = niceTicks(lo, hi);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const y = (v) => PAD.top + plotH - ((v - y0) / (y1 - y0 || 1)) * plotH;

    // x: a time scale for lines; a band per time for bars.
    const t0 = times[0];
    const t1 = times[times.length - 1];
    const band = plotW / times.length;
    const x = bar
      ? (t) => PAD.left + band * times.indexOf(t) + band / 2
      : (t) => PAD.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);

    for (const v of ticks) {
      el("line", { x1: PAD.left, x2: width - PAD.right, y1: y(v), y2: y(v), class: "om-grid-line" }, svg);
      const label = el("text", { x: PAD.left - 8, y: y(v) + 4, "text-anchor": "end", class: "om-tick" }, svg);
      label.textContent = tickLabel(v, ticks);
    }
    el("line", { x1: PAD.left, x2: width - PAD.right, y1: y(bar ? 0 : y0), y2: y(bar ? 0 : y0), class: "om-axis" }, svg);

    const spanDays = (t1 - t0) / 864e5;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      ...(spanDays > 400 ? { month: "short", year: "numeric" } : spanDays >= 2 ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit", hour12: false }),
    });
    const every = Math.max(1, Math.ceil(times.length / Math.max(2, Math.floor(plotW / 90))));
    times.forEach((t, i) => {
      if (i % every) return;
      const label = el("text", { x: x(t), y: height - 8, "text-anchor": "middle", class: "om-tick" }, svg);
      label.textContent = fmt.format(t);
    });

    if (bar) {
      const inner = Math.max(2, (band * 0.72) / Math.max(1, series.length));
      series.forEach((s, si) => {
        for (const p of s.points) {
          const cx = x(p.t) - (inner * series.length) / 2 + inner * si;
          const top = Math.min(y(p.v), y(0));
          el("rect", { x: cx, y: top, width: Math.max(1, inner - 1), height: Math.max(1, Math.abs(y(p.v) - y(0))), rx: 2, class: `om-bar c-${s.color}` }, svg);
        }
      });
    } else {
      for (const s of series) {
        if (!s.points.length) continue;
        const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
        el("path", { d, class: `om-series c-${s.color}` }, svg);
      }
    }

    // Hover: the nearest time, its values exactly as given.
    const cross = el("line", { y1: PAD.top, y2: PAD.top + plotH, class: "om-cross", visibility: "hidden" }, svg);
    const dots = el("g", {}, svg);
    const hit = el("rect", { x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: "transparent" }, svg);
    const tip = document.createElement("div");
    tip.className = "om-tip";
    tip.hidden = true;
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      dots.replaceChildren();
      tip.hidden = true;
    };
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) / (box.width || width)) * width;
      let best = times[0];
      for (const t of times) if (Math.abs(x(t) - px) < Math.abs(x(best) - px)) best = t;
      cross.setAttribute("x1", x(best));
      cross.setAttribute("x2", x(best));
      cross.setAttribute("visibility", "visible");
      dots.replaceChildren();
      const when = document.createElement("div");
      when.className = "om-tip-when";
      when.textContent = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", ...(spanDays < 2 ? { timeStyle: "short" } : {}) }).format(best);
      const rows = [when];
      for (const s of series) {
        const p = s.points.find((q) => q.t === best);
        if (!p) continue;
        if (!bar) el("circle", { cx: x(p.t), cy: y(p.v), r: 4, class: `om-dot c-${s.color}` }, dots);
        const row = document.createElement("div");
        row.className = `om-tip-row c-${s.color}`;
        const sw = document.createElement("span");
        sw.className = "om-swatch";
        const name = document.createElement("span");
        name.textContent = s.name;
        const val = document.createElement("b");
        val.textContent = String(p.shown);
        row.append(sw, name, val);
        rows.push(row);
      }
      tip.replaceChildren(...rows);
      tip.hidden = false;
      const left = x(best) + 12;
      tip.style.left = `${Math.min(left, width - 150)}px`;
      tip.style.top = `${PAD.top}px`;
    });

    const parts = [svg, tip];
    if (series.length > 1 || this.hasAttribute("legend")) {
      const legend = document.createElement("div");
      legend.className = "om-legend";
      for (const s of series) {
        const item = document.createElement("span");
        item.className = `c-${s.color}`;
        const sw = document.createElement("i");
        sw.className = "om-swatch";
        const name = document.createElement("span");
        name.textContent = s.name;
        name.style.color = "var(--ink-soft)";
        item.append(sw, name);
        legend.append(item);
      }
      parts.push(legend);
    }
    this.replaceChildren(...parts);
  }
}

if (!customElements.get("om-chart")) customElements.define("om-chart", OmChart);
