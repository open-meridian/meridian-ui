// The sample page's own script: what a plugin writes to use the components.

await Promise.all(["om-grid", "om-chart", "om-live", "om-instrument-picker", "om-panels"].map((n) => customElements.whenDefined(n)));

const positions = document.getElementById("positions");
// Priorities, so a phone shows fewer columns, each row still one line.
positions.columns = [
  { key: "symbol", label: "Instrument" },
  { key: "account", label: "Account", priority: 3 },
  { key: "state", label: "Side", type: "badge", tone: (v) => (v === "Short" ? "sell" : "buy"), priority: 2 },
  { key: "quantity", label: "Quantity", type: "decimal", group: true, priority: 3 },
  { key: "price", label: "Price", type: "decimal", group: true, priority: 3 },
  { key: "market_value", label: "Market value", type: "decimal", group: true },
  { key: "day_pnl", label: "Day P&L", type: "decimal", group: true, tone: "sign", priority: 2 },
];

const orders = document.getElementById("orders");
orders.columns = [
  { key: "order_id", label: "Order", type: "code" },
  { key: "side", label: "Side", type: "badge", tone: (v) => (v === "Sell" ? "sell" : "buy") },
  { key: "symbol", label: "Instrument" },
  { key: "quantity", label: "Quantity", type: "decimal", group: true, priority: 2 },
  { key: "limit", label: "Limit", type: "decimal", priority: 3 },
  { key: "filled", label: "Filled", type: "decimal", group: true, priority: 3 },
  { key: "status", label: "Status", type: "badge", tone: (v) => ({ Working: "warn", Filled: "good", Rejected: "bad" })[v] || "", priority: 2 },
  { key: "sent", label: "Sent", priority: 3 },
];
// Forty orders, so the pager has pages to turn.
const SYMBOLS = ["AAPL", "MSFT", "NVDA", "ASML", "IVV", "TSLA", "AMZN", "META"];
const STATUSES = ["Filled", "Working", "Working", "Rejected", "Filled"];
orders.setRows(
  Array.from({ length: 40 }, (_, i) => {
    const quantity = 20 + ((i * 137) % 980);
    const status = STATUSES[i % STATUSES.length];
    const minutes = 31 + i * 7;
    return {
      order_id: `ORD-${5521 + i}`,
      side: i % 3 === 1 ? "Sell" : "Buy",
      symbol: SYMBOLS[i % SYMBOLS.length],
      quantity: String(quantity),
      limit: `${100 + ((i * 53) % 600)}.${String((i * 17) % 100).padStart(2, "0")}`,
      filled: status === "Filled" ? String(quantity) : status === "Working" ? String(Math.floor(quantity / 3)) : "0",
      status,
      sent: `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}`,
    };
  }),
);

// Accounts as a server writes a one-line table: each row's cells, and its
// whole in a row-detail, a click away. Thirty, so it has pages.
const accountRows = document.getElementById("account-rows");
const NAMES = ["Main", "Retirement", "Family trust", "Growth book", "Income book", "Treasury", "Hedge sleeve", "Endowment", "Operating cash", "Escrow"];
const NOTES = [
  "Rebalanced at the close; the margin call of the 28th was met in full the next morning.",
  "Cash only. Contributions are matched quarterly and invested on the first business day.",
  "Held for the trust's beneficiaries; distributions need two trustees to sign.",
  "",
];
const text = (tag, value, className) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
};
for (let i = 0; i < 30; i++) {
  const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`;
  const id = `ACC-${(0x7b20c1e5 + i * 7919).toString(16).slice(-8)}`;
  const cash = `${(1204500 - i * 38211).toLocaleString("en-US")}.${String((i * 37) % 100).padStart(2, "0")}`;
  const asOf = `2026-09-${String(28 - (i % 20)).padStart(2, "0")}`;
  const note = NOTES[i % NOTES.length];
  const tr = document.createElement("tr");
  const first = document.createElement("td");
  first.append(text("strong", name), text("span", i % 2 ? "Cash" : "Margin", "hint"));
  const idCell = document.createElement("td");
  idCell.className = "wide-only";
  idCell.append(text("code", id));
  const more = document.createElement("td");
  more.className = "more";
  const details = document.createElement("details");
  details.className = "row-detail";
  details.name = "accounts";
  const summary = text("summary", "…");
  summary.setAttribute("aria-label", `Details of ${name}`);
  summary.title = "Details";
  const pop = document.createElement("div");
  pop.className = "row-detail-pop";
  const dl = document.createElement("dl");
  for (const [k, v] of [["ID", id], ["Kind", i % 2 ? "Cash" : "Margin"], ["Cash", cash], ["As of", asOf], ["Note", note || "None"]]) dl.append(text("dt", k), text("dd", v));
  pop.append(text("h3", name), dl);
  details.append(summary, pop);
  more.append(details);
  tr.append(first, idCell, text("td", cash, "num"), text("td", asOf, "wide-only"), text("td", note, "wide-only muted"), more);
  accountRows.append(tr);
}

// Thirty days of two books' values, as integer cents made into decimal strings.
const days = [];
for (let i = 0; i < 30; i++) days.push(new Date(Date.UTC(2026, 7, 30 + i)).toISOString().slice(0, 10));
const walk = (start, drift, seed) => {
  let cents = start;
  let s = seed;
  return days.map((d) => {
    s = (s * 9301 + 49297) % 233280;
    cents += Math.round(((s / 233280) - 0.5 + drift) * 12000000);
    return [d, `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`];
  });
};
document.getElementById("nav").series = [
  { name: "Growth book", color: "accent", points: walk(1200000000, 0.08, 7) },
  { name: "Income book", color: "violet", points: walk(900000000, 0.02, 3) },
];
document.getElementById("flows").series = [
  { name: "Buys", color: "buy", points: days.slice(-10).map((d, i) => [d, String(20 + ((i * 37) % 50))]) },
  { name: "Sells", color: "sell", points: days.slice(-10).map((d, i) => [d, String(10 + ((i * 53) % 45))]) },
];

const picked = document.getElementById("picked");
document.getElementById("picker").addEventListener("om-select", (e) => {
  const i = e.detail.instrument;
  picked.textContent = i ? `${i.instrument_id}: ${i.description}` : "No instrument chosen.";
});

// Panels, and a high-rate grid: two thousand quotes, a few dozen changes a
// second. Prices are integer cents made into decimal strings, never floats.
const cents = (c) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const quotes = document.getElementById("quotes");
quotes.columns = [
  { key: "symbol", label: "Symbol", type: "code" },
  { key: "bid", label: "Bid", type: "decimal", group: true },
  { key: "ask", label: "Ask", type: "decimal", group: true },
  { key: "last", label: "Last", type: "decimal", group: true },
  { key: "change", label: "Change", type: "decimal", tone: "sign" },
  { key: "volume", label: "Volume", type: "decimal", group: true },
];
const book = [];
let seed = 11;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
for (let i = 0; i < 2000; i++) {
  const symbol = `${letters[i % 26]}${letters[Math.floor(i / 26) % 26]}${letters[Math.floor(i / 676) % 26]}${i}`;
  const open = 1000 + rand(90000);
  book.push({ symbol, open, last: open, volume: rand(50000) });
}
const quoteRow = (q) => ({
  symbol: q.symbol, bid: cents(q.last - 1), ask: cents(q.last + 1), last: cents(q.last),
  change: cents(q.last - q.open), volume: String(q.volume),
});
quotes.setRows(book.map(quoteRow));
let sent = 0;
setInterval(() => {
  for (let n = 0; n < 2; n++) {
    const q = book[rand(book.length)];
    q.last = Math.max(1, q.last + rand(41) - 20);
    q.volume += 1 + rand(500);
    quotes.upsert(quoteRow(q));
    sent++;
  }
}, 50);
const rate = document.getElementById("rate");
setInterval(() => {
  rate.textContent = `${sent} updates a second`;
  sent = 0;
}, 1000);
document.getElementById("freeze").addEventListener("change", (e) => (quotes.freezeSort = e.target.checked));
document.getElementById("nav-small").series = [{ name: "Growth book", color: "accent", points: walk(1200000000, 0.08, 7) }];
document.getElementById("desk").defaultLayout = {
  version: 1,
  root: { split: "row", sizes: [0.62, 0.38], children: [
    { panel: "quotes" },
    { split: "column", sizes: [0.5, 0.5], children: [{ panel: "depth" }, { panel: "notes" }] },
  ] },
};
document.getElementById("desk-reset").addEventListener("click", () => document.getElementById("desk").reset());

// The header actions: the page's own buttons, whether pressed here or, framed,
// in the host's header (the kit clicks them). Refresh is a plain form, so the
// page it posts to says so.
const acted = document.getElementById("acted");
const said = (text) => {
  acted.textContent = text;
  acted.hidden = false;
};
if (new URLSearchParams(location.search).get("refreshed") === "1") said("Refreshed: the Refresh form was sent, and this is the page it answered with.");
document.querySelector('[data-om-action="new-order"]').addEventListener("click", () => said(`New order pressed at ${new Date().toLocaleTimeString()}.`));
