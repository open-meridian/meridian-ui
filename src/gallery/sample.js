// The sample page's own script: what a plugin writes to use the components.

await Promise.all(["om-grid", "om-chart", "om-live", "om-instrument-picker"].map((n) => customElements.whenDefined(n)));

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
