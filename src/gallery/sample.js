// The sample page's own script: what a plugin writes to use the components.

await Promise.all(["om-grid", "om-chart", "om-live", "om-instrument-picker", "om-panels"].map((n) => customElements.whenDefined(n)));

const positions = document.getElementById("positions");
positions.columns = [
  { key: "symbol", label: "Instrument" },
  { key: "account", label: "Account" },
  { key: "state", label: "Side", type: "badge", tone: (v) => (v === "Short" ? "sell" : "buy") },
  { key: "quantity", label: "Quantity", type: "decimal", group: true },
  { key: "price", label: "Price", type: "decimal", group: true },
  { key: "market_value", label: "Market value", type: "decimal", group: true },
  { key: "day_pnl", label: "Day P&L", type: "decimal", group: true, tone: "sign" },
];

const orders = document.getElementById("orders");
orders.columns = [
  { key: "order_id", label: "Order", type: "code" },
  { key: "side", label: "Side", type: "badge", tone: (v) => (v === "Sell" ? "sell" : "buy") },
  { key: "symbol", label: "Instrument" },
  { key: "quantity", label: "Quantity", type: "decimal", group: true },
  { key: "limit", label: "Limit", type: "decimal" },
  { key: "filled", label: "Filled", type: "decimal", group: true },
  { key: "status", label: "Status", type: "badge", tone: (v) => ({ Working: "warn", Filled: "good", Rejected: "bad" })[v] || "" },
  { key: "sent", label: "Sent" },
];
orders.setRows([
  { order_id: "ORD-5521", side: "Buy", symbol: "AAPL", quantity: "500", limit: "228.00", filled: "500", status: "Filled", sent: "09:31:02" },
  { order_id: "ORD-5522", side: "Sell", symbol: "MSFT", quantity: "120", limit: "513.50", filled: "40", status: "Working", sent: "09:44:17" },
  { order_id: "ORD-5523", side: "Buy", symbol: "NVDA", quantity: "1000", limit: "178.10", filled: "0", status: "Working", sent: "10:02:55" },
  { order_id: "ORD-5524", side: "Sell", symbol: "ASML", quantity: "20", limit: "712.00", filled: "0", status: "Rejected", sent: "10:15:40" },
  { order_id: "ORD-5525", side: "Buy", symbol: "IVV", quantity: "75", limit: "660.00", filled: "75", status: "Filled", sent: "11:20:09" },
]);

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
